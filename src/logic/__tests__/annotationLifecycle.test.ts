import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChessEngine } from '../ChessEngine';
import { annotationsSurvive } from '../annotationLifecycle';
import {
  GIVEAWAY_RULES,
  addIncrement,
  chooseBotMove,
  chooseBotMoveFor,
  clockTick,
  createClock,
  findLegalMove,
  initialState,
  parseSquare,
  playMove,
  positionEpoch,
  resign,
  stateFromPieces,
  type FourPlayerState,
  type GameEvent,
  type Seat,
} from '../fourPlayer';

/**
 * THE ANNOTATION INVARIANT (logic/annotationLifecycle.ts): arrows and highlights are cleared when a MOVE is played, by anyone, and at no
 * other time — never because a turn started or passed. These tests pin it for every board's epoch, with the 4 Player engine's
 * no-move turn-advance paths spelled out one by one so a future mode (or Online) that adds a new path has an obvious pattern to copy.
 */

const RED = 0;
const BLUE = 1;
const YELLOW = 2;
const GREEN = 3;
const first = () => 0;
const sq = parseSquare;
const KINGS = ['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7'];
const moveEvents = (events: GameEvent[]) => events.filter((e) => e.kind === 'move' || e.kind === 'deadKingMove');
const survives = (before: FourPlayerState, after: FourPlayerState) => annotationsSurvive(positionEpoch(before), positionEpoch(after));

describe('the rule itself', () => {
  it('annotations survive exactly when the position epoch is unchanged (strings for FENs, numbers for plies)', () => {
    expect(annotationsSurvive('rnbqkbnr/8/8/8/8/8/8/RNBQKBNR w KQkq - 0 1', 'rnbqkbnr/8/8/8/8/8/8/RNBQKBNR w KQkq - 0 1')).toBe(true);
    expect(annotationsSurvive('a', 'b')).toBe(false);
    expect(annotationsSurvive(7, 7)).toBe(true);
    expect(annotationsSurvive(7, 8)).toBe(false);
    expect(annotationsSurvive(8, 7)).toBe(false); // Undo / stepping back replaces the position
  });
});

describe('4 Player Chess: a turn that advances WITHOUT a move never clears arrows', () => {
  it('a seat resigning when it is NOT its turn changes no move and no turn', () => {
    const before = stateFromPieces([...KINGS, 'rR@d1', 'bP@b6'], { turn: BLUE });
    const out = resign(before, YELLOW, first);
    expect(out.state.status[YELLOW]).toBe('dead-king'); // the position visibly changed (its pieces went dead) ...
    expect(out.state.turn).toBe(BLUE);
    expect(moveEvents(out.events)).toEqual([]); // ... but no move was played
    expect(survives(before, out.state)).toBe(true);
  });

  it('the seat to move resigns and the turn passes on: the NEXT seat\'s turn starts with no move, and the arrows survive', () => {
    // Green resigns on its turn -> Red's turn starts ("my turn starts") without any move having been played.
    const before = stateFromPieces([...KINGS, 'rR@d1', 'bP@b6'], { turn: GREEN });
    const out = resign(before, GREEN, first);
    expect(out.state.turn).toBe(RED);
    expect(moveEvents(out.events)).toEqual([]);
    expect(survives(before, out.state)).toBe(true);
  });

  it('a flag falling on the seat to move (the real clock path) hands the turn on with no move, and the arrows survive', () => {
    const before = stateFromPieces([...KINGS, 'rR@d1', 'bP@b6'], { turn: YELLOW });
    const clock = { ...createClock(600, 0, true), seconds: [600, 600, 0.5, 600] };
    const tick = clockTick(before, clock, 2, first);
    expect(tick.state.status[YELLOW]).toBe('dead-king');
    expect(tick.state.turn).toBe(GREEN);
    expect(moveEvents(tick.events)).toEqual([]);
    expect(survives(before, tick.state)).toBe(true);
  });

  it('a seat eliminated AT ITS TURN without a move (stalemated after the previous seat resigned): two turns pass, no move, arrows survive', () => {
    // Blue's king on a4 is boxed in by Yellow's guarded rook (b5, defended by the queen on e8): stalemate, found when Blue's turn comes.
    const before = stateFromPieces(['rK@h1', 'bK@a4', 'yR@b5', 'yQ@e8', 'yK@g14', 'gK@n7'], { turn: RED });
    const out = resign(before, RED, first);
    const eliminated = out.events.filter((e) => e.kind === 'eliminated');
    expect(eliminated.map((e) => e.kind === 'eliminated' && [e.seat, e.reason])).toEqual([[RED, 'resign'], [BLUE, 'stalemate']]);
    expect(out.state.turn).toBe(YELLOW); // Red out, Blue eliminated at its turn, Yellow's turn starts
    expect(moveEvents(out.events)).toEqual([]);
    expect(survives(before, out.state)).toBe(true);
  });

  it('a frozen seat is skipped without a move', () => {
    const before = stateFromPieces([...KINGS, 'rR@d1', 'yP@j8'], { turn: RED, status: ['active', 'frozen', 'active', 'active'] });
    const out = resign(before, RED, first);
    expect(out.state.turn).toBe(YELLOW); // Blue was skipped
    expect(moveEvents(out.events)).toEqual([]);
    expect(survives(before, out.state)).toBe(true);
  });

  it('the clock giving a move\'s increment, and anything else that returns the same state, is not a move either', () => {
    const state = stateFromPieces([...KINGS, 'rR@d1', 'bP@b6'], { turn: BLUE });
    const clock = createClock(60, 3, true);
    expect(addIncrement(clock, RED, state)).not.toBe(state); // (a clock object, not a position)
    expect(survives(state, { ...state })).toBe(true); // an identical position, however it was re-created
    expect(survives(state, { ...state, turn: YELLOW })).toBe(true); // even a bare turn change leaves the epoch alone
  });
});

describe('4 Player Chess: every MOVE clears, whoever makes it and however it comes about', () => {
  it('a move by each of the four seats changes the epoch', () => {
    let state = initialState();
    const openers: [string, string][] = [['e2', 'e3'], ['b5', 'c5'], ['h13', 'h12'], ['m6', 'l6']];
    for (const [from, to] of openers) {
      const before = state;
      state = playMove(state, findLegalMove(state, state.turn, sq(from), sq(to))!, first).state;
      expect(survives(before, state), `${from}-${to} by seat ${before.turn}`).toBe(false);
    }
  });

  it('an eliminated king\'s random walk IS a move (it changes the position): arrows clear when it is played', () => {
    // Red resigns on its turn and the next seat, Blue, is an already-eliminated king: advance plays its walk.
    const before = stateFromPieces([...KINGS, 'rR@d1', 'yP@j8'], { turn: RED, status: ['active', 'dead-king', 'active', 'active'] });
    const out = resign(before, RED, first);
    expect(out.events.some((e) => e.kind === 'deadKingMove')).toBe(true);
    expect(positionEpoch(out.state)).toBe(positionEpoch(before) + 1);
    expect(survives(before, out.state)).toBe(false);
  });

  it('a move that ends with seats eliminated / skipped still clears, once or more, and never goes backwards', () => {
    let state = initialState();
    let epoch = positionEpoch(state);
    for (let i = 0; i < 120 && !state.result; i++) {
      const move = chooseBotMove(state, 1500, () => 0.5)!;
      const before = state;
      const out = playMove(state, move, first);
      state = out.state;
      expect(positionEpoch(state), `step ${i}`).toBeGreaterThan(epoch);
      expect(survives(before, state)).toBe(false);
      epoch = positionEpoch(state);
    }
  });

  it('Undo (a replaced position) clears too: the epoch goes down', () => {
    const start = initialState();
    const moved = playMove(start, findLegalMove(start, RED, sq('e2'), sq('e3'))!, first).state;
    expect(survives(moved, start)).toBe(false);
  });
});

describe('classic chess: the FEN is the epoch, and the engine has no way to advance a turn without a move', () => {
  const pick = (engine: ChessEngine, salt: number): [string, string] => {
    const turn = engine.getTurn();
    const mine = engine.getBoard().flat().filter((s) => s.piece && s.piece.color === turn);
    for (let k = 0; k < mine.length; k++) {
      const from = mine[(k + salt) % mine.length].square;
      const targets = engine.getLegalMoves(from);
      if (targets.length) return [from, targets[salt % targets.length]];
    }
    throw new Error('no moves');
  };

  it('every move changes the FEN (and the turn); reading the position never does', () => {
    const engine = new ChessEngine();
    let fen = engine.getFen();
    let moves = 0;
    for (let i = 0; i < 60 && engine.getLegalMoveCount() > 0; i++) {
      const turn = engine.getTurn();
      for (const s of ['e2', 'e7', 'a1']) engine.getLegalMoves(s);
      engine.getBoard();
      engine.getStatus();
      engine.getHistory();
      expect(engine.getFen(), 'reading must not change the epoch').toBe(fen);
      const [from, to] = pick(engine, i);
      expect(engine.move(from, to, 'q')).not.toBeNull();
      expect(engine.getTurn()).not.toBe(turn);
      expect(annotationsSurvive(fen, engine.getFen()), `move ${i}`).toBe(false);
      fen = engine.getFen();
      moves++;
    }
    expect(moves).toBeGreaterThan(20);
  });

  it('undo and reset replace the position, so they clear; an engine rebuilt from the same FEN does not', () => {
    const engine = new ChessEngine();
    const start = engine.getFen();
    const [from, to] = pick(engine, 3);
    engine.move(from, to, 'q');
    const afterMove = engine.getFen();
    expect(annotationsSurvive(start, afterMove)).toBe(false);
    expect(annotationsSurvive(afterMove, new ChessEngine(afterMove).getFen())).toBe(true); // a re-created identical position is not a move
    engine.undo();
    expect(annotationsSurvive(afterMove, engine.getFen())).toBe(false);
    engine.move(from, to, 'q');
    engine.reset();
    expect(annotationsSurvive(afterMove, engine.getFen())).toBe(false);
  });
});

describe('wiring: every board clears through the ONE shared mechanism, keyed to a position epoch and nothing turn-based', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '../..', rel), 'utf8').replace(/\r\n/g, '\n');

  it('the hook uses the pure rule and is the only place that decides', () => {
    const hook = read('components/useClearAnnotationsOnMove.ts');
    expect(hook).toContain('if (!annotationsSurvive(previous.current, epoch)) latestClear.current();');
    // The previous epoch must follow every change, or going back to the very first position (Undo to the start) would look unchanged and
    // keep stale arrows. No React renderer here, so this is pinned at source level rather than exercised.
    expect(hook).toContain('    previous.current = epoch;\n  }, [epoch]);');
    expect(hook).toContain("import { annotationsSurvive, type PositionEpoch } from '../logic/annotationLifecycle';");
  });

  it('classic: the epoch is the FEN; 4 Player: the epoch is positionEpoch(state) (the ply); each board clears in exactly one place', () => {
    const classic = read('components/ChessBoard.tsx');
    expect(classic).toContain('useClearAnnotationsOnMove(fen, () => {');
    expect(classic.match(/setArrows\(\[\]\)/g)).toHaveLength(1);
    expect(classic.match(/setHighlights\(\[\]\)/g)).toHaveLength(1);
    const four = read('components/FourPlayerBoard.tsx');
    expect(four).toContain('useClearAnnotationsOnMove(positionEpoch(state), () => {');
    expect(four.match(/setArrows\(\[\]\)/g)).toHaveLength(1);
    expect(four.match(/setHighlights\(\[\]\)/g)).toHaveLength(1);
    // Nothing turn-based anywhere near the clearing code.
    expect(four).not.toMatch(/keepAnnotations|previousMover|waitingSeat/);
    expect(read('logic/fourPlayer/annotations.ts')).toContain('export function positionEpoch(state: Pick<FourPlayerState, \'ply\'>): number {\n  return state.ply;\n}');
  });

  it('the invariant is written down where a new mode will look for it', () => {
    const doc = read('logic/annotationLifecycle.ts');
    expect(doc).toContain('THE ANNOTATION INVARIANT');
    expect(doc).toContain('cleared at exactly one');
    expect(doc).toContain('never key annotations to');
    expect(read('../CHECKLIST.md')).toContain('annotationLifecycle');
  });

  it('ply goes up in exactly one place in the 4 Player engine (a move being applied)', () => {
    const moves = read('logic/fourPlayer/moves.ts');
    expect(moves.match(/ply: state\.ply \+ 1/g)).toHaveLength(1);
    for (const file of ['elimination.ts', 'clock.ts', 'setup.ts', 'presentation.ts', 'premove.ts', 'annotations.ts', 'bot.ts', 'board.ts']) {
      expect(read(`logic/fourPlayer/${file}`), file).not.toMatch(/ply: [^\n]*\+ ?1|ply\+\+|ply \+= /);
    }
  });
});

/**
 * 4 PLAYER GIVEAWAY (FOUR_PLAYER_GIVEAWAY_SPEC.md section 8, CHECKLIST "Extra" box): the mode's position epoch is the same `state.ply`, so the rule is the same - and these
 * are the Giveaway engine's own no-move turn advances, spelled out like the Chess ones above. Giveaway has FEWER of them (no dead king walks, no elimination by mate or
 * stalemate) and one new one: a resignation / flag fall can leave the seat already to move STUCK, which ends the game without any move being played.
 */
describe('4 Player Giveaway: a turn that advances (or a game that ends) WITHOUT a move never clears arrows', () => {
  const ga = (pieces: string[], options: Parameters<typeof stateFromPieces>[1] = {}) => stateFromPieces(pieces, { rules: GIVEAWAY_RULES, ...options });

  it('a seat resigning when it is NOT its turn changes no move and no turn (the seat is frozen; its pieces become walls)', () => {
    const before = ga([...KINGS, 'rR@d1', 'bP@b6'], { turn: BLUE });
    const out = resign(before, YELLOW, first);
    expect(out.state.status[YELLOW]).toBe('frozen'); // never 'dead-king': nothing walks in Giveaway
    expect(out.state.turn).toBe(BLUE);
    expect(moveEvents(out.events)).toEqual([]);
    expect(survives(before, out.state)).toBe(true);
  });

  it('the seat to move resigns and the turn passes on: the NEXT seat\'s turn starts with no move, and the arrows survive', () => {
    const before = ga([...KINGS, 'rR@d1', 'bP@b6'], { turn: GREEN });
    const out = resign(before, GREEN, first);
    expect(out.state.turn).toBe(RED);
    expect(moveEvents(out.events)).toEqual([]);
    expect(survives(before, out.state)).toBe(true);
  });

  it('a flag falling on the seat to move hands the turn on with no move, and the arrows survive', () => {
    const before = ga([...KINGS, 'rR@d1', 'bP@b6'], { turn: YELLOW });
    const clock = { ...createClock(600, 0, true), seconds: [600, 600, 0.5, 600] };
    const tick = clockTick(before, clock, 2, first);
    expect(tick.state.status[YELLOW]).toBe('frozen');
    expect(tick.state.turn).toBe(GREEN);
    expect(moveEvents(tick.events)).toEqual([]);
    expect(survives(before, tick.state)).toBe(true);
  });

  it('a frozen (eliminated) seat is skipped without a move', () => {
    const before = ga([...KINGS, 'rR@d1', 'yP@j8'], { turn: RED, status: ['active', 'frozen', 'active', 'active'] });
    const out = resign(before, RED, first);
    expect(out.state.turn).toBe(YELLOW); // Blue was skipped
    expect(moveEvents(out.events)).toEqual([]);
    expect(survives(before, out.state)).toBe(true);
  });

  it('a resignation that leaves the seat to move STUCK ends the game with no move played (the "stuck" win): the arrows survive', () => {
    // Blue's only legal move is the forced capture of Yellow's knight; Yellow resigns, the knight becomes an uncapturable wall, Blue is left with none.
    const before = ga(['bP@e5', 'rP@f5', 'yN@f6', 'rK@h1', 'yK@g14', 'gK@n7'], { turn: BLUE });
    const out = resign(before, YELLOW, first);
    expect(out.state.result).toEqual({ winners: [BLUE], reason: 'stuck' });
    expect(moveEvents(out.events)).toEqual([]);
    expect(survives(before, out.state)).toBe(true);
  });

  it('the last-standing end of a game by resignation / flag fall is no move either', () => {
    const before = ga(KINGS, { turn: RED, status: ['active', 'frozen', 'frozen', 'active'] });
    const out = resign(before, GREEN, first, 'timeout');
    expect(out.state.result).toEqual({ winners: [RED], reason: 'lastStanding' });
    expect(moveEvents(out.events)).toEqual([]);
    expect(survives(before, out.state)).toBe(true);
  });

  it('the game ending ON a move (a seat\'s last piece captured, a stuck seat reached) is a move: the arrows clear with it', () => {
    const outOfPieces = ga(['rR@e5', 'gP@m5', 'rK@h1', 'bK@a8', 'yK@g14'], { turn: RED });
    const done = playMove(outOfPieces, findLegalMove(outOfPieces, RED, sq('e5'), sq('m5'))!, first).state;
    expect(done.result?.reason).toBe('outOfPieces');
    expect(survives(outOfPieces, done)).toBe(false);
    const stuckStart = ga(['rP@g5', 'bP@f5', 'rK@h1', 'yK@g14', 'gK@n7'], { turn: RED });
    const stuckDone = playMove(stuckStart, findLegalMove(stuckStart, RED, sq('h1'), sq('h2'))!, first).state;
    expect(stuckDone.result?.reason).toBe('stuck');
    expect(survives(stuckStart, stuckDone)).toBe(false);
  });
});

describe('4 Player Giveaway: every MOVE clears, and nothing moves unseen', () => {
  it('a move by each of the four seats changes the epoch (the openers are identical to Chess: no capture exists yet)', () => {
    let state = initialState(GIVEAWAY_RULES);
    for (const [from, to] of [['e2', 'e3'], ['b5', 'c5'], ['h13', 'h12'], ['m6', 'l6']]) {
      const before = state;
      state = playMove(state, findLegalMove(state, state.turn, sq(from), sq(to))!, first).state;
      expect(survives(before, state), `${from}-${to} by seat ${before.turn}`).toBe(false);
    }
  });

  it('a forced capture is a move like any other', () => {
    const before = stateFromPieces(['rR@d5', 'bP@d9', ...KINGS], { rules: GIVEAWAY_RULES, turn: RED });
    const out = playMove(before, findLegalMove(before, RED, sq('d5'), sq('d9'))!, first);
    expect(positionEpoch(out.state)).toBe(positionEpoch(before) + 1);
    expect(survives(before, out.state)).toBe(false);
  });

  it('over a whole bot-played game: the epoch rises by exactly one per move, no walking king ever moves a piece behind the arrows, and a resignation changes nothing', () => {
    let state = initialState(GIVEAWAY_RULES);
    let moves = 0;
    for (let i = 0; i < 400 && !state.result; i++) {
      const before = state;
      const out = playMove(state, chooseBotMoveFor(state, 1500, () => 0.5)!, first);
      state = out.state;
      moves++;
      expect(out.events.filter((e) => e.kind === 'deadKingMove' || e.kind === 'frozen'), `step ${i}`).toEqual([]); // nothing but the mover's own move changes the board
      expect(positionEpoch(state) - positionEpoch(before), `step ${i}`).toBe(1);
    }
    expect(positionEpoch(state)).toBe(moves);
  });
});

describe('4 Player Giveaway: wiring', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '../..', rel), 'utf8').replace(/\r\n/g, '\n');

  it('the Giveaway modules never touch the ply (it goes up in applyMoveRaw only), and the board still clears through its one shared mechanism', () => {
    expect(read('logic/fourPlayer/moves.ts').match(/ply: state\.ply \+ 1/g)).toHaveLength(1);
    for (const file of ['giveaway.ts', 'giveawayBot.ts']) expect(read(`logic/fourPlayer/${file}`), file).not.toMatch(/ply: [^\n]*\+ ?1|ply\+\+|ply \+= /);
    expect(read('logic/fourPlayerVariant.ts')).not.toMatch(/ply: [^\n]*\+ ?1|ply\+\+|ply \+= /);
    const four = read('components/FourPlayerBoard.tsx');
    expect(four).toContain('useClearAnnotationsOnMove(positionEpoch(state), () => {'); // the same board, the same epoch, in both variants
    expect(four).not.toMatch(/keepAnnotations|previousMover|waitingSeat/);
  });
});

// A seat type used above only for readability of the scenarios.
export type { Seat };
