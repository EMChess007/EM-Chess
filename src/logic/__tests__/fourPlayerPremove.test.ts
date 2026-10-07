import { describe, expect, it } from 'vitest';
import {
  BISHOP,
  KNIGHT,
  QUEEN,
  ROOK,
  canPremove,
  defaultSeatConfig,
  describePremove,
  findLegalMove,
  isPromotionPremove,
  parseSquare,
  playMove,
  premoveSeat,
  promotionOf,
  resign,
  resolvePremove,
  stateFromPieces,
  withController,
  type FourPlayerPremove,
  type FourPlayerState,
  type Seat,
} from '../fourPlayer';
import { PREMOVE_ELIMINATED_MESSAGE, PREMOVE_ILLEGAL_MESSAGE, describePremoveCancel, noticeAfterTurnChange, stepPremove } from '../premove';

const RED = 0;
const BLUE = 1;
const YELLOW = 2;
const GREEN = 3;
const first = () => 0;
const KINGS = ['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7'];
const sq = parseSquare;

/** The seat to move plays from -> to (which must be legal). */
function play(state: FourPlayerState, from: string, to: string): FourPlayerState {
  const move = findLegalMove(state, state.turn, sq(from), sq(to));
  if (!move) throw new Error(`illegal in this position: ${from}-${to} for seat ${state.turn}`);
  return playMove(state, move, first).state;
}

/** What the screen's usePremove effect decides for Red's premove in `state`. */
const stepFor = (state: FourPlayerState, premove: FourPlayerPremove) =>
  stepPremove({
    intent: premove,
    isMyTurn: state.turn === RED,
    canStillPlay: state.status[RED] === 'active',
    gameOver: !!state.result,
    resolve: (intent) => resolvePremove(state, RED, intent),
  });

/**
 * Red queues `premove` while it is Blue's turn, then Blue, Yellow and Green move (`rounds` = their three moves), and the turn is
 * back with Red. Returns the position at each step so the test can see what the premove does after each of the three other moves.
 */
function threeMoves(start: FourPlayerState, rounds: [string, string][]): FourPlayerState[] {
  const states = [start];
  for (const [from, to] of rounds) states.push(play(states[states.length - 1], from, to));
  return states;
}

describe('a premove waits through the three other seats and is only judged when the turn is back', () => {
  const premove = { from: sq('d1'), to: sq('d8') };

  it('while Blue, Yellow and Green are still to move it just waits; when Red is up and the premove is legal it is played', () => {
    const start = stateFromPieces([...KINGS, 'rR@d1'], { turn: BLUE });
    const states = threeMoves(start, [['a8', 'a9'], ['g14', 'f14'], ['n7', 'n8']]);
    expect(states.map((s) => s.turn)).toEqual([BLUE, YELLOW, GREEN, RED]);
    for (const state of states.slice(0, 3)) expect(stepFor(state, premove)).toEqual({ kind: 'wait' }); // not Red's turn: no judgement yet
    const step = stepFor(states[3], premove);
    expect(step.kind).toBe('play');
    if (step.kind === 'play') expect([step.move.from, step.move.to]).toEqual([sq('d1'), sq('d8')]);
  });

  it('is cancelled as illegal when another seat has put a piece in the way', () => {
    const start = stateFromPieces([...KINGS, 'rR@d1', 'bR@b5'], { turn: BLUE });
    const states = threeMoves(start, [['b5', 'd5'], ['g14', 'f14'], ['n7', 'n8']]);
    expect(stepFor(states[3], premove)).toEqual({ kind: 'cancel', reason: 'illegal' }); // the rook is blocked on d5; d8 is beyond it
    // ...but the same piece could still capture the blocker, which is a different premove.
    expect(stepFor(states[3], { from: sq('d1'), to: sq('d5') }).kind).toBe('play');
  });

  it('is cancelled as illegal when the premoving piece was captured meanwhile', () => {
    const start = stateFromPieces([...KINGS, 'rR@d1', 'bR@d6'], { turn: BLUE });
    const states = threeMoves(start, [['d6', 'd1'], ['g14', 'f14'], ['n7', 'n8']]); // Blue takes the rook on d1
    expect(states[3].cells[sq('d1')]).not.toBe(start.cells[sq('d1')]);
    expect(stepFor(states[3], premove)).toEqual({ kind: 'cancel', reason: 'illegal' });
  });

  it('is cancelled as illegal when the piece has become pinned to the king by another seat', () => {
    // Red rook e1 and king h1 on the first rank; Yellow's rook lands on d1: the rook is pinned and may only slide along the rank.
    const start = stateFromPieces([...KINGS, 'rR@e1', 'yR@d14'], { turn: BLUE });
    const states = threeMoves(start, [['a8', 'a9'], ['d14', 'd1'], ['n7', 'n8']]);
    expect(stepFor(states[3], { from: sq('e1'), to: sq('e3') })).toEqual({ kind: 'cancel', reason: 'illegal' });
    expect(stepFor(states[3], { from: sq('e1'), to: sq('f1') }).kind).toBe('play'); // staying on the pin line is still fine
    // Control: before the pin the same premove would have been legal.
    expect(resolvePremove(states[0], RED, { from: sq('e1'), to: sq('e3') })).not.toBeNull();
  });

  it('is cancelled as illegal when another seat gives check and the premove does not answer it', () => {
    const start = stateFromPieces([...KINGS, 'rP@e2', 'gR@k5'], { turn: BLUE });
    const states = threeMoves(start, [['a8', 'a9'], ['g14', 'f14'], ['k5', 'k1']]); // Green's rook checks along the first rank
    expect(stepFor(states[3], { from: sq('e2'), to: sq('e3') })).toEqual({ kind: 'cancel', reason: 'illegal' });
  });

  it('a premove whose target was occupied when queued is still just a position: it fires as a quiet move once the piece has left', () => {
    const start = stateFromPieces([...KINGS, 'rR@d1', 'bN@d5'], { turn: BLUE });
    const states = threeMoves(start, [['d5', 'f6'], ['g14', 'f14'], ['n7', 'n8']]);
    const step = stepFor(states[3], { from: sq('d1'), to: sq('d5') });
    expect(step.kind).toBe('play');
    if (step.kind === 'play') expect(step.move.captured).toBe(0);
  });

  it('is cancelled with the ELIMINATED notice when the seat is checkmated while waiting (its turn never comes)', () => {
    const start = stateFromPieces([...KINGS, 'rP@g2', 'rP@h2', 'rP@i2', 'yR@d14'], { turn: BLUE });
    const states = threeMoves(start, [['a8', 'a9'], ['d14', 'd1'], ['n7', 'n8']]); // Yellow mates Red on the first rank
    const last = states[3];
    expect(last.status[RED]).toBe('dead-king');
    expect(last.turn).not.toBe(RED); // Red's turn was consumed by the elimination
    expect(stepFor(last, { from: sq('g2'), to: sq('g3') })).toEqual({ kind: 'cancel', reason: 'eliminated' });
  });

  it('is cancelled with the ELIMINATED notice after a resignation / timeout, and silently when the game is over', () => {
    const start = stateFromPieces([...KINGS, 'rR@d1', 'bP@b6'], { turn: BLUE }); // Blue keeps a pawn, so Red going out is not a dead position
    const out = resign(start, RED, first, 'timeout').state;
    expect(stepFor(out, premove)).toEqual({ kind: 'cancel', reason: 'eliminated' });
    const over: FourPlayerState = { ...start, result: { winners: [BLUE as Seat], reason: 'cap' } };
    expect(stepFor(over, premove)).toEqual({ kind: 'cancel', reason: null });
    expect(stepFor({ ...over, turn: RED }, premove)).toEqual({ kind: 'cancel', reason: null }); // game over wins over "my turn"
  });

  it('a promotion premove carries its piece; it is cancelled if another seat blocked the square, and plays as the chosen piece otherwise', () => {
    const start = stateFromPieces([...KINGS, 'rP@e7', 'yN@f10'], { turn: BLUE });
    const knightPremove = { from: sq('e7'), to: sq('e8'), promotion: KNIGHT };
    const clear = threeMoves(start, [['a8', 'a9'], ['g14', 'f14'], ['n7', 'n8']]);
    const step = stepFor(clear[3], knightPremove);
    expect(step.kind).toBe('play');
    if (step.kind === 'play') expect(promotionOf(step.move)).toBe(KNIGHT);
    // Yellow's knight jumps onto e8 in front of the pawn: the push is blocked.
    const blocked = threeMoves(start, [['a8', 'a9'], ['f10', 'e8'], ['n7', 'n8']]);
    expect(stepFor(blocked[3], knightPremove)).toEqual({ kind: 'cancel', reason: 'illegal' });
  });
});

describe('the pieces of a premove', () => {
  it('stepPremove: nothing queued is idle, and the order is game over > eliminated > not my turn > legality', () => {
    const resolve = () => ({ id: 'm' });
    const base = { intent: 'x', isMyTurn: true, canStillPlay: true, gameOver: false, resolve };
    expect(stepPremove({ ...base, intent: null })).toEqual({ kind: 'idle' });
    expect(stepPremove(base)).toEqual({ kind: 'play', move: { id: 'm' } });
    expect(stepPremove({ ...base, isMyTurn: false })).toEqual({ kind: 'wait' });
    expect(stepPremove({ ...base, resolve: () => null })).toEqual({ kind: 'cancel', reason: 'illegal' });
    expect(stepPremove({ ...base, isMyTurn: false, canStillPlay: false })).toEqual({ kind: 'cancel', reason: 'eliminated' });
    expect(stepPremove({ ...base, canStillPlay: false, gameOver: true })).toEqual({ kind: 'cancel', reason: null });
    // The engine is never even asked when it is not the player's turn or the player is out.
    let asked = 0;
    const counting = () => (asked++, { id: 'm' });
    stepPremove({ ...base, isMyTurn: false, resolve: counting });
    stepPremove({ ...base, canStillPlay: false, resolve: counting });
    stepPremove({ ...base, gameOver: true, resolve: counting });
    expect(asked).toBe(0);
  });

  it('the notices say what happened (the illegal one is the 2-player screens\' wording)', () => {
    expect(PREMOVE_ILLEGAL_MESSAGE).toBe('Premove was no longer legal — cancelled.');
    expect(describePremoveCancel('illegal')).toBe(PREMOVE_ILLEGAL_MESSAGE);
    expect(describePremoveCancel('eliminated')).toBe(PREMOVE_ELIMINATED_MESSAGE);
    expect(PREMOVE_ELIMINATED_MESSAGE).not.toBe(PREMOVE_ILLEGAL_MESSAGE);
  });

  it('the cancellation notice: an illegal-premove notice goes once the player has moved on, an eliminated one stays, nothing is invented', () => {
    expect(noticeAfterTurnChange('illegal', true)).toBe('illegal'); // still the turn it was about
    expect(noticeAfterTurnChange('illegal', false)).toBeNull(); // the player has moved: stale
    expect(noticeAfterTurnChange('eliminated', false)).toBe('eliminated'); // out for good
    expect(noticeAfterTurnChange('eliminated', true)).toBe('eliminated');
    expect(noticeAfterTurnChange(null, true)).toBeNull();
    expect(noticeAfterTurnChange(null, false)).toBeNull();
  });

  it('canPremove: only a still-active seat, while the game is on and it is NOT that seat\'s turn', () => {
    const state = stateFromPieces([...KINGS, 'rR@d1'], { turn: BLUE });
    expect(canPremove(state, RED)).toBe(true);
    expect(canPremove({ ...state, turn: RED }, RED)).toBe(false); // on your own turn you simply move
    const withMaterial = stateFromPieces([...KINGS, 'rR@d1', 'bP@b6'], { turn: BLUE });
    const eliminated = resign(withMaterial, RED, first).state;
    expect(eliminated.result).toBeNull(); // the game goes on without Red
    expect(eliminated.status[RED]).toBe('dead-king');
    expect(canPremove(eliminated, RED)).toBe(false); // an eliminated seat may not queue one
    expect(canPremove({ ...state, result: { winners: [RED as Seat], reason: 'cap' } }, RED)).toBe(false);
    for (const seat of [RED, YELLOW, GREEN] as Seat[]) expect(canPremove(state, seat)).toBe(true);
  });

  it('isPromotionPremove: a pawn one step from its own last line, for every seat\'s direction; nothing else', () => {
    const cases: [string, Seat, string, string][] = [
      ['rP@e7', RED, 'e7', 'e8'],
      ['yP@j8', YELLOW, 'j8', 'j7'],
      ['bP@g5', BLUE, 'g5', 'h5'],
      ['gP@h6', GREEN, 'h6', 'g6'],
    ];
    for (const [piece, seat, from, to] of cases) {
      const state = stateFromPieces([...KINGS, piece]);
      expect(isPromotionPremove(state, seat, sq(from), sq(to)), piece).toBe(true);
    }
    const state = stateFromPieces([...KINGS, 'rP@e7', 'rP@e5', 'rR@d7', 'bP@c9']);
    expect(isPromotionPremove(state, RED, sq('e5'), sq('e6'))).toBe(false); // not reaching the last line
    expect(isPromotionPremove(state, RED, sq('e5'), sq('e8'))).toBe(false); // too far for a pawn to be a promotion premove
    expect(isPromotionPremove(stateFromPieces([...KINGS, 'rP@e6']), RED, sq('e6'), sq('e8'))).toBe(false); // two steps from the line: not a promotion
    expect(isPromotionPremove(stateFromPieces([...KINGS, 'bP@c7']), RED, sq('c7'), sq('c8'))).toBe(false); // Blue's pawn is not Red's to premove, even on a square that looks like a promotion
    expect(isPromotionPremove(state, RED, sq('d7'), sq('d8'))).toBe(false); // a rook
    expect(isPromotionPremove(state, RED, sq('c9'), sq('d9'))).toBe(false); // someone else's pawn
    expect(isPromotionPremove(state, RED, sq('f7'), sq('f8'))).toBe(false); // an empty square
  });

  it('resolvePremove defaults a promotion to a queen, honours the chosen piece and ignores it for ordinary moves', () => {
    const state = stateFromPieces([...KINGS, 'rP@e7', 'rR@d1']);
    expect(promotionOf(resolvePremove(state, RED, { from: sq('e7'), to: sq('e8') })!)).toBe(QUEEN);
    for (const pick of [QUEEN, ROOK, BISHOP, KNIGHT]) expect(promotionOf(resolvePremove(state, RED, { from: sq('e7'), to: sq('e8'), promotion: pick })!)).toBe(pick);
    const quiet = resolvePremove(state, RED, { from: sq('d1'), to: sq('d4'), promotion: KNIGHT });
    expect(quiet && promotionOf(quiet)).toBe(0);
    expect(resolvePremove(state, RED, { from: sq('d1'), to: sq('e4') })).toBeNull(); // not a rook move
    expect(resolvePremove(state, RED, { from: sq('a8'), to: sq('a9') })).toBeNull(); // Blue's king: never Red's move
  });

  it('describePremove', () => {
    expect(describePremove({ from: sq('e2'), to: sq('e4') })).toBe('e2-e4');
    expect(describePremove({ from: sq('e7'), to: sq('e8'), promotion: KNIGHT })).toBe('e7-e8=N');
    expect(describePremove({ from: sq('e7'), to: sq('e8'), promotion: QUEEN })).toBe('e7-e8=Q');
  });

  it('only the single human of a vs-bots game may premove (several humans sharing the device: nobody)', () => {
    const config = defaultSeatConfig();
    expect(premoveSeat(config)).toBe(RED);
    expect(premoveSeat(withController(withController(config, RED, { kind: 'bot', elo: 1200 }), GREEN, { kind: 'human' }))).toBe(GREEN);
    expect(premoveSeat(withController(config, BLUE, { kind: 'human' }))).toBeUndefined();
    expect(premoveSeat(withController(config, RED, { kind: 'bot', elo: 1200 }))).toBeUndefined();
  });
});
