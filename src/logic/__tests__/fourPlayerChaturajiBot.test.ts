import { describe, expect, it } from 'vitest';
import {
  CAPTURE_POINTS,
  CHATURAJI_RULES,
  FFA_RULES,
  FLAG_PROMOTION,
  GIVEAWAY_RULES,
  KING,
  KING_LOSS,
  SQUARE8,
  activeSeats,
  applyMoveRaw,
  botStrength,
  chooseBotMove,
  chooseBotMoveFor,
  chooseChaturajiBotMove,
  chooseGiveawayFourBotMove,
  currentMoves,
  initialState,
  isInCheck,
  kingsAttackedBy,
  legalMoves,
  moveLabelOn,
  playMove,
  resign,
  scoreMoves,
  seatOf,
  stateFromPieces,
  typeOf,
  worstReplyLoss,
  type FourPlayerState,
  type GameEvent,
  type Move,
  type PositionOptions,
  type Seat,
} from '../fourPlayer';
import { mulberry32 } from './fourPlayerGoldenKit';

/**
 * CHATURAJI W2 - the bot (CHATURAJI_SPEC.md section 7; fourPlayer/chaturajiBot.ts). Hand-built positions where one rule of the bot is the whole point, the
 * dial (greedy vs careful, ELO as the strength), determinism with an injected rng, "never an illegal move", an arena of bot-vs-bot games, and the
 * latency budget. The bots' strength is a heuristic dial, not a calibrated rating (4-seat games are never rated), so the assertions are about behaviour
 * a player would notice, not about a number.
 */
const RED: Seat = 0;
const BLUE: Seat = 1;
const YELLOW: Seat = 2;
const GREEN: Seat = 3;
const sq = (name: string): number => SQUARE8.parseSquare(name);
const KINGS = ['rK@a1', 'bK@a8', 'yK@h8', 'gK@h1'];
const cp = (pieces: string[], options: PositionOptions = {}): FourPlayerState => stateFromPieces(pieces, { rules: CHATURAJI_RULES, ...options });
const label = (move: Move | null): string => (move ? moveLabelOn(move, SQUARE8) : '-');

/** An rng whose FIRST draw takes the scored branch (it is below `bestChance`), then a seeded stream (the wobble). */
const scored = (seed: number) => {
  const rest = mulberry32(seed);
  let first = true;
  return () => {
    if (first) {
      first = false;
      return 0;
    }
    return rest();
  };
};
/** With a constant 0 rng the wobble is nil too: the pure scored choice. */
const pure = () => 0;
const strengthNoise = (elo: number): number => botStrength(elo).noise + 0.05;
const GREEDY = 600;
const CAREFUL = 1500;
const TOP = 3000;

describe('the dial: the same ELO roster, three tiers that collapse to two', () => {
  it('greedy below 1000, careful from 1000, and "deep" plays as careful (there is no deep tier in v1)', () => {
    expect(botStrength(GREEDY).tier).toBe('greedy');
    expect(botStrength(CAREFUL).tier).toBe('careful');
    expect(botStrength(TOP).tier).toBe('deep');
    // a deep-ELO bot makes exactly the decisions a careful one makes, given the same rng and the same wobble amplitude... which differs with ELO, so compare at the same noise:
    const position = cp([...KINGS, 'rR@d4', 'bN@d6', 'yP@g4'], { turn: RED });
    expect(label(chooseChaturajiBotMove(position, 1800, pure))).toBe(label(chooseChaturajiBotMove(position, 1799, pure)));
  });

  it('chooseBotMoveFor dispatches on the position: Chaturaji gets the Chaturaji bot, the other two games keep theirs', () => {
    // along a seeded Chaturaji game the dispatcher always returns the Chaturaji bot's move - and the Chess bot would have played something else somewhere (not vacuous)
    let state = initialState(CHATURAJI_RULES);
    let differs = 0;
    for (let ply = 0; ply < 80 && !state.result; ply++) {
      const mine = chooseChaturajiBotMove(state, CAREFUL, scored(ply))!;
      expect(label(chooseBotMoveFor(state, CAREFUL, scored(ply))), `ply ${ply}`).toBe(label(mine));
      if (label(chooseBotMove(state, CAREFUL, scored(ply))) !== label(mine)) differs++;
      state = playMove(state, mine, pure).state;
    }
    expect(differs).toBeGreaterThan(0);
    const ffa = initialState(FFA_RULES);
    expect(chooseBotMoveFor(ffa, CAREFUL, scored(5))).toEqual(chooseBotMove(ffa, CAREFUL, scored(5)));
    const giveaway = initialState(GIVEAWAY_RULES);
    expect(chooseBotMoveFor(giveaway, CAREFUL, scored(5))).toEqual(chooseGiveawayFourBotMove(giveaway, CAREFUL, scored(5)));
  });
});

describe('what it wants: points', () => {
  it('takes the higher-value capture: a boat (5) over a knight (3) over a pawn (1) when all are free', () => {
    const state = cp([...KINGS, 'rR@d4', 'bP@d6', 'yN@f4', 'gR@d2'], { turn: RED });
    // the rook can take the pawn on d6 (1), the knight on f4 (3) or the boat on d2 (5): nothing is defended
    for (const elo of [GREEDY, CAREFUL, TOP]) expect(label(chooseChaturajiBotMove(state, elo, pure)), `ELO ${elo}`).toBe('d4xd2');
    const noBoat = cp([...KINGS, 'rR@d4', 'bP@d6', 'yN@f4'], { turn: RED });
    for (const elo of [GREEDY, CAREFUL, TOP]) expect(label(chooseChaturajiBotMove(noBoat, elo, pure)), `ELO ${elo}`).toBe('d4xf4');
  });

  it('prefers capturing a KING (+3 and a rival eliminated) to a pawn or a knight', () => {
    const state = cp(['rK@a1', 'rR@d4', 'bK@d8', 'yK@h8', 'gK@h1', 'bN@g4', 'yP@d2'], { turn: RED });
    for (const elo of [GREEDY, CAREFUL, TOP]) expect(label(chooseChaturajiBotMove(state, elo, pure)), `ELO ${elo}`).toBe('d4xd8');
  });

  it('captures a walking king (+3) too, and does not bother with dead pieces (0 points) when a live one is on offer', () => {
    const walking = cp(['rK@a1', 'rR@d4', 'bK@a8', 'yK@h8', 'gK@d7', 'bP@g4'], { turn: RED, status: ['active', 'active', 'active', 'dead-king'] });
    expect(label(chooseChaturajiBotMove(walking, CAREFUL, pure))).toBe('d4xd7');
    const dead = cp([...KINGS, 'rR@d4', 'bP@d7', 'yP@g4'], { turn: RED, status: ['active', 'frozen', 'active', 'active'] }); // Blue's pawn is dead: worth 0
    const taken = chooseChaturajiBotMove(dead, CAREFUL, pure)!;
    expect(label(taken)).toBe('d4xg4'); // Yellow's LIVE pawn (1 point), not Blue's dead one on d7 (0)
    expect(seatOf(taken.captured)).toBe(YELLOW);
  });

  it('scores a check fork: a knight move that attacks two kings beats a quiet move of the same material', () => {
    const state = cp(['rK@a1', 'rN@c5', 'bK@d6', 'yK@f6', 'gK@h1', 'rP@a2'], { turn: RED });
    for (const elo of [GREEDY, CAREFUL]) expect(label(chooseChaturajiBotMove(state, elo, pure)), `ELO ${elo}`).toBe('c5-e4');
  });

  it('promotes: a pawn that can step onto the far edge becomes a boat (the careful tier)', () => {
    const state = cp([...KINGS, 'rP@c7', 'rR@e3'], { turn: RED });
    const move = chooseChaturajiBotMove(state, CAREFUL, pure)!;
    expect(move.flags & FLAG_PROMOTION).toBeTruthy();
    expect(label(move)).toBe('c7-c8=R');
  });
});

describe('what it fears: a king that can be captured, a piece that is hanging', () => {
  it('the careful bot does not leave its king for the next seat to take; the greedy one does (position: Blue\'s boat attacks the Red king down the d-file)', () => {
    // Red to move; the king on d1 is attacked by Blue's boat on d8 (Blue is the next seat). A quiet pawn move leaves it; the king moving off the file saves it.
    const state = cp(['rK@d1', 'rP@a2', 'bR@d8', 'bK@a8', 'yK@h8', 'gK@h1'], { turn: RED });
    const safe = (move: Move | null): boolean => {
      const after = playMove(state, move!, pure).state;
      return !legalMoves(after, BLUE).some((m) => m.captured !== 0 && typeOf(m.captured) === KING && seatOf(m.captured) === RED);
    };
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) expect(safe(chooseChaturajiBotMove(state, TOP, scored(seed))), `top, seed ${seed}`).toBe(true);
    for (const seed of [1, 2, 3, 4]) expect(safe(chooseChaturajiBotMove(state, CAREFUL, scored(seed))), `careful, seed ${seed}`).toBe(true);
    // the greedy tier sees points and material only: over a handful of wobbles it sometimes plays a move that leaves the king to be taken
    let hangs = 0;
    for (let seed = 1; seed <= 60; seed++) if (!safe(chooseChaturajiBotMove(state, GREEDY, scored(seed)))) hangs++;
    expect(hangs).toBeGreaterThan(0);
  });

  it('an attack that costs nothing is not "answered": its own capture of a free boat beats a defensive shuffle when no seat before it can take the king', () => {
    // Yellow (NOT the next seat: Blue is) attacks Red's king; Red can take a free Blue boat now. Blue cannot touch the king, so the careful bot takes the points.
    const state = cp(['rK@d1', 'rR@a4', 'bR@h4', 'bK@a8', 'yR@d8', 'yK@h5', 'gK@h1'], { turn: RED });
    expect(isInCheck(state, RED)).toBe(true); // Yellow's boat on d8 attacks the king
    const move = chooseChaturajiBotMove(state, TOP, pure)!;
    expect(label(move)).toBe('a4xh4'); // a check needs no answer: Blue, the next seat, cannot take the king, so the boat (5) is simply taken
  });

  it('a piece the next seat can take for free is not left hanging, but a DEFENDED one is traded off only when worthwhile (the careful bot looks at the recapture)', () => {
    // Red boat on d4 can take a pawn on d6, but Blue's boat on h6 takes the boat back and nothing defends it: net -4. The careful bot declines; the greedy one grabs.
    const poisoned = cp(['rK@a1', 'rR@d4', 'bP@d6', 'bR@h6', 'bK@a7', 'yK@h8', 'gK@h1'], { turn: RED });
    expect(label(chooseChaturajiBotMove(poisoned, GREEDY, pure))).toBe('d4xd6');
    expect(label(chooseChaturajiBotMove(poisoned, CAREFUL, pure))).not.toBe('d4xd6');
    // the same capture of a BISHOP (5) with a second Red boat guarding d6 is an even exchange (the boat that takes is taken back and retaken): taken
    const even = cp(['rK@a2', 'rR@d4', 'rR@d1', 'bB@d6', 'bR@h6', 'bK@a8', 'yK@h8', 'gK@h1'], { turn: RED });
    expect(label(chooseChaturajiBotMove(even, CAREFUL, pure))).toBe('d4xd6');
  });
});

describe('the end of the game is priced by who wins it', () => {
  it('capturing the last rival\'s king when that LOSES on points is declined (a quiet move is better); when it wins, it is taken', () => {
    const behind = cp(['rK@a1', 'rR@d4', 'rP@a2', 'gK@d8'], { turn: RED, status: ['active', 'frozen', 'frozen', 'active'], score: [0, 0, 0, 20] });
    expect(playMove(behind, legalMoves(behind, RED).find((m) => label(m) === 'd4xd8')!, pure).state.result).toEqual({ winners: [GREEN], reason: 'elimination' }); // the capture hands Green the game
    expect(label(chooseChaturajiBotMove(behind, CAREFUL, pure))).not.toBe('d4xd8');
    const ahead = cp(['rK@a1', 'rR@d4', 'rP@a2', 'gK@d8'], { turn: RED, status: ['active', 'frozen', 'frozen', 'active'], score: [25, 0, 0, 20] });
    expect(label(chooseChaturajiBotMove(ahead, CAREFUL, pure))).toBe('d4xd8');
  });

  it('knows the +3 per surviving king for the last seat: behind by 5 it still ends the game, because 3 + 2 x 3 beats 5', () => {
    const state = cp(['rK@a1', 'rR@d4', 'rP@a2', 'gK@d8', 'bK@a8', 'yK@h8'], { turn: RED, status: ['active', 'dead-king', 'dead-king', 'active'], score: [0, 0, 0, 5] });
    const capture = legalMoves(state, RED).find((m) => label(m) === 'd4xd8')!;
    expect(playMove(state, capture, pure).state.result).toEqual({ winners: [RED], reason: 'elimination' }); // 3 + 6 = 9 against 5
    expect(label(chooseChaturajiBotMove(state, CAREFUL, pure))).toBe('d4xd8');
  });
});

/**
 * The weights of the scoring, pinned by what a player would see (found by the mutation run: a weight pushed to an extreme must change a decision somewhere).
 * Each position is built so that the term under test is the ONLY thing separating the right move from the next best one.
 */
describe('the weights, pinned by outcome', () => {
  it('a reply is weighed, but not feared out of proportion: an even exchange of boats for bishops is taken, and so is a trade that wins points first', () => {
    // Red's boat takes Blue's bishop (5 points) and Blue's boat takes it back (5): the first capture is Red's, so the careful bot takes it.
    const trade = cp(['rK@a1', 'rR@d4', 'bB@d6', 'bR@h6', 'bK@a8', 'yK@h8', 'gK@h1'], { turn: RED });
    for (const elo of [CAREFUL, TOP]) expect(label(chooseChaturajiBotMove(trade, elo, pure)), `ELO ${elo}`).toBe('d4xd6');
  });

  it('ending the game as the winner is worth far more than a free boat; ending it as the loser is not (END_WIN against the same alternative)', () => {
    // Red leads 25-20. Taking Green's last king ends the game in Red's favour; Red's bishop could take Green's free boat on g1 instead (worth more points and material on its own).
    const ahead = cp(['rK@a1', 'rR@d4', 'rB@e3', 'gK@d8', 'gR@g1'], { turn: RED, status: ['active', 'frozen', 'frozen', 'active'], score: [25, 0, 0, 20] });
    expect(playMove(ahead, legalMoves(ahead, RED).find((m) => label(m) === 'd4xd8')!, pure).state.result).toEqual({ winners: [RED], reason: 'elimination' });
    expect(label(chooseChaturajiBotMove(ahead, CAREFUL, pure))).toBe('d4xd8');
    // ...and the same position with Red BEHIND by enough that the capture would hand Green the game: the boat is taken instead
    const behind = cp(['rK@a1', 'rR@d4', 'rB@e3', 'gK@d8', 'gR@g1'], { turn: RED, status: ['active', 'frozen', 'frozen', 'active'], score: [0, 0, 0, 40] });
    expect(label(chooseChaturajiBotMove(behind, CAREFUL, pure))).toBe('e3xg1');
  });

  describe('KING_LOSS: how dear a king is, from both sides (a raised value survived the mutation set until these)', () => {
    // Red's knight on d3 is the only thing between Blue's boat on d8 and the Red king on d1. It can jump to e5 and take Yellow's free boat, which lets Blue take the KING (the reply term).
    // On e5 the knight attacks c6, f7 and g4: with all three rival kings there the capture also scores a triple fork (5 points). All numbers below are written as literals.
    const kings = ['rK@d1', 'bK@c6', 'yK@f7'];
    const forking = cp([...kings, 'gK@g4', 'rN@d3', 'bR@d8', 'yR@e5'], { turn: RED });
    const single = cp([...kings, 'gK@g2', 'rN@d3', 'bR@d8', 'yR@e5'], { turn: RED }); // the Green king out of reach: a double fork only
    const scoreOf = (state: FourPlayerState, text: string, careful: boolean): number => {
      const moves = legalMoves(state, RED);
      const move = moves.find((m) => label(m) === text)!;
      return scoreMoves(state, moves, careful, 0, pure).find((s) => s.move === move)!.score;
    };

    it('the price of the king in the reply term is exactly 0.85 x 14, whatever else the move is worth', () => {
      // the careful score is the greedy one plus the king threat (3 kings x 0.3) less the reply term (the worst reply is Blue's boat taking the king)
      expect(worstReplyLoss(applyMoveRaw(forking, legalMoves(forking, RED).find((m) => label(m) === 'd3xe5')!), RED, BLUE)).toBe(14);
      expect(scoreOf(forking, 'd3xe5', false)).toBeCloseTo(16.3333, 3); // 5 x 1.5 (the boat) + 5 x 1.5 (the triple fork) + 4/3 (material)
      expect(scoreOf(forking, 'd3xe5', true)).toBeCloseTo(5.3333, 3); // 16.3333 + 0.9 - 11.9
    });

    it('a capture worth about 17 points is taken even though it hands over the king; one worth about 10 is not', () => {
      expect(label(chooseChaturajiBotMove(forking, TOP, pure))).toBe('d3xe5'); // 5.33 against -0.33 for the best quiet move: a king is NOT dearer than 20 points
      expect(scoreOf(single, 'd3xe5', true)).toBeCloseTo(-0.9667, 3);
      expect(label(chooseChaturajiBotMove(single, TOP, pure))).not.toBe('d3xe5'); // -0.97 against -0.33: the king is dearer than a boat and a double fork
    });
  });

  it('points count for more than material: a free knight (3) is taken before promoting a pawn (+4 material)', () => {
    // (the kings stand off the far rank so that the promoted boat forks nobody and the comparison is points against material alone)
    const state = cp(['rK@a1', 'bK@a5', 'yK@h5', 'gK@h1', 'rP@c7', 'rR@e3', 'bN@e6'], { turn: RED });
    expect(label(chooseChaturajiBotMove(state, CAREFUL, pure))).toBe('e3xe6');
  });

  it('material counts at every tier, not only points: the greedy bot promotes a pawn and otherwise pushes pawns forward', () => {
    const promote = cp([...KINGS, 'rP@c7'], { turn: RED });
    expect(label(chooseChaturajiBotMove(promote, GREEDY, pure))).toBe('c7-c8=R');
    const push = cp(['rK@a1', 'rP@e2', 'bK@a8', 'yK@h8', 'gK@h1'], { turn: RED });
    const moves = legalMoves(push, RED);
    expect(label(moves[0])).not.toBe('e2-e3'); // the pawn step is not simply the first move in the list
    for (const elo of [GREEDY, CAREFUL]) expect(label(chooseChaturajiBotMove(push, elo, pure)), `ELO ${elo}`).toBe('e2-e3');
  });

  it('a double fork is worth 1 point, not a triple fork\'s 5: a free knight (3) is taken before forking two kings', () => {
    const state = cp(['rK@a1', 'rN@c5', 'bK@d6', 'yK@f6', 'gK@h1', 'rR@a4', 'bN@h4'], { turn: RED });
    const fork = legalMoves(state, RED).find((m) => label(m) === 'c5-e4')!;
    expect(kingsAttackedBy(applyMoveRaw(state, fork), fork.to)).toBe(2); // the fork is real: the knight on e4 attacks Blue's and Yellow's kings
    expect(label(chooseChaturajiBotMove(state, CAREFUL, pure))).toBe('a4xh4');
  });

  it('the wobble is the dial: around 1000 the bot sometimes picks the slightly worse of two good captures, at the top it never does', () => {
    // A free boat (5 points, 5 material) or a free bishop (5 points, 3.25 material): the gap is under a point, inside the wobble of a 1000 bot, far outside a 3000 one's.
    // (Yellow is out and the kings stand off the lines, so nothing else scores.)
    const state = cp(['rK@a1', 'bK@a7', 'yK@h8', 'gK@h2', 'rR@d4', 'bR@d2', 'gB@f4'], { turn: RED, status: ['active', 'active', 'frozen', 'active'] });
    const chosen = (elo: number) => {
      const seen = new Map<string, number>();
      for (let seed = 1; seed <= 80; seed++) {
        const move = label(chooseChaturajiBotMove(state, elo, scored(seed)));
        seen.set(move, (seen.get(move) ?? 0) + 1);
      }
      return seen;
    };
    const atTop = chosen(TOP);
    expect([...atTop.keys()]).toEqual(['d4xd2']);
    const around1000 = chosen(1000);
    expect(around1000.get('d4xd2') ?? 0).toBeGreaterThan(0);
    expect(around1000.get('d4xf4') ?? 0).toBeGreaterThan(0);
    for (const move of around1000.keys()) expect(['d4xd2', 'd4xf4']).toContain(move); // a wobble, not a blunder: only the two good captures
  });

  it('an eliminated seat is not the one that answers: a dead boat aimed at the king is no reason to run, a live one is', () => {
    // Blue is next to move... but Blue is out (frozen): its boat on d8 is a wall. The next seat that can answer is Yellow, who cannot touch the king.
    const dead = cp(['rK@d1', 'rR@a4', 'bR@d8', 'bK@a6', 'yK@h5', 'yR@h4', 'gK@h2'], { turn: RED, status: ['active', 'frozen', 'active', 'active'] });
    expect(label(chooseChaturajiBotMove(dead, CAREFUL, pure))).toBe('a4xh4');
    const live = cp(['rK@d1', 'rR@a4', 'bR@d8', 'bK@a6', 'yK@h5', 'yR@h4', 'gK@h2'], { turn: RED });
    expect(label(chooseChaturajiBotMove(live, CAREFUL, pure))).not.toBe('a4xh4'); // Blue is live and takes the king: the free boat is not worth it
  });

  it('a recapture is priced as what it is: a pawn grab defended by a bishop is taken, an undefended or third-party-covered one is not', () => {
    // Whoever takes the pawn on e6 is taken back by Blue's boat on h6. With Red's bishop covering e6 the taker is "defended", and the boat that recaptures is dearer than the knight: taken.
    // (Yellow is out and the kings stand off every line, so no fork or threat scores here.)
    const live: Partial<PositionOptions> = { turn: RED, status: ['active', 'active', 'frozen', 'active'] };
    const defended = cp(['rK@a1', 'rN@d4', 'rB@a2', 'bP@e6', 'bR@h6', 'bK@a7', 'yK@h8', 'gK@h2'], live);
    expect(label(chooseChaturajiBotMove(defended, CAREFUL, pure))).toMatch(/xe6$/);
    const alone = cp(['rK@a1', 'rN@d4', 'bP@e6', 'bR@h6', 'bK@a7', 'yK@h8', 'gK@h2'], live);
    expect(label(chooseChaturajiBotMove(alone, CAREFUL, pure))).not.toMatch(/xe6$/);
    expect(label(chooseChaturajiBotMove(alone, GREEDY, pure))).toBe('d4xe6'); // the greedy bot does not look
    // a piece of ANOTHER rival covering the square is no defence of mine
    const covered = cp(['rK@a1', 'rN@d4', 'bP@e6', 'bR@h6', 'bK@a7', 'yK@h8', 'gK@h2', 'gB@c8'], live);
    expect(label(chooseChaturajiBotMove(covered, CAREFUL, pure))).not.toMatch(/xe6$/);
  });

  it('a defended piece still costs the difference: a boat that takes a pawn a pawn can take back is not worth it, even with a bishop behind it', () => {
    const live: Partial<PositionOptions> = { turn: RED, status: ['active', 'active', 'frozen', 'active'] };
    const state = cp(['rK@a1', 'rR@d4', 'rB@a3', 'bP@d6', 'bP@c7', 'bK@a8', 'yK@h8', 'gK@h2'], live);
    expect(label(chooseChaturajiBotMove(state, CAREFUL, pure))).not.toMatch(/xd6$/); // the boat (5) or the bishop (5) taken by a pawn (1) is a loss of 4
    expect(label(chooseChaturajiBotMove(state, GREEDY, pure))).toMatch(/xd6$/);
  });

  it('a king is never "defended": a defended king under attack is still saved before a free boat is taken', () => {
    // Blue's boat on d8 attacks the king on d1, which Red's boat on a1 "covers". Taking Yellow's free boat on h4 would lose the king (a king is gone, not traded).
    const state = cp(['rK@d1', 'rR@a1', 'rR@a4', 'bR@d8', 'bK@b7', 'yK@h5', 'yR@h4', 'gK@h2'], { turn: RED });
    expect(label(chooseChaturajiBotMove(state, CAREFUL, pure))).not.toBe('a4xh4');
    expect(label(chooseChaturajiBotMove(state, GREEDY, pure))).toBe('a4xh4');
  });

  it('the seat that answers is the next LIVE one: past an eliminated Blue it is Yellow\'s boat that makes the free boat on h4 a poisoned gift', () => {
    const state = cp(['rK@d1', 'rR@a4', 'bR@d8', 'bK@b7', 'yK@h8', 'yR@g1', 'gR@h4', 'gK@g6'], { turn: RED, status: ['active', 'frozen', 'active', 'active'] });
    expect(label(chooseChaturajiBotMove(state, CAREFUL, pure))).not.toBe('a4xh4'); // Yellow's boat on g1 takes the king along the first rank
    expect(label(chooseChaturajiBotMove(state, GREEDY, pure))).toBe('a4xh4');
  });

  it('the WORST reply counts, not the first or the cheapest: of two pieces that hang, the dearer one is saved', () => {
    // Blue can take Red's pawn on c6 (a Blue pawn on b5, found FIRST in the list) or Red's boat on f7 (Blue's bishop on e8, found second). The first legal move leaves both.
    const state = cp(['rK@a1', 'rP@c6', 'rR@f7', 'bP@b5', 'bB@e8', 'bK@a8', 'yK@h5', 'gK@h2'], { turn: RED });
    const hanging = (move: Move): number[] => {
      const after = applyMoveRaw(state, move);
      return legalMoves(after, BLUE).filter((m) => m.captured !== 0 && seatOf(m.captured) === RED).map((m) => typeOf(m.captured));
    };
    const first = legalMoves(state, RED)[0];
    const pawn = typeOf(state.cells[sq('c6')]);
    const boat = typeOf(state.cells[sq('f7')]);
    expect(new Set(hanging(first))).toEqual(new Set([pawn, boat])); // doing nothing leaves the pawn AND the boat to be taken...
    expect(hanging(first)[0]).toBe(pawn); // ...and the cheap capture is the first one in the list
    const chosen = chooseChaturajiBotMove(state, CAREFUL, pure)!;
    expect(hanging(chosen)).not.toContain(typeOf(state.cells[sq('f7')])); // the boat is not left to be taken, whatever happens to the pawn
    // the term itself: after doing nothing, the worst the next seat can win is the boat (5), not the pawn found first (1)
    expect(worstReplyLoss(applyMoveRaw(state, first), RED, BLUE)).toBe(5);
  });

  it('worstReplyLoss prices a reply exactly: a piece by its capture value, a king at KING_LOSS, a defended piece by the difference, nothing when nothing hangs', () => {
    const base = ['bK@a8', 'yK@h8', 'gK@h2'];
    const loss = (pieces: string[], next: Seat = BLUE) => worstReplyLoss(cp([...pieces, ...base], { turn: RED }), RED, next);
    expect(loss(['rK@a1', 'rP@c6', 'bP@b5'])).toBe(1); // a pawn taken by a pawn
    expect(loss(['rK@a1', 'rN@c6', 'bP@b5'])).toBe(3); // a knight taken by a pawn
    expect(loss(['rK@a1', 'rR@c6', 'bP@b5'])).toBe(5); // a boat taken by a pawn
    expect(loss(['rK@a1', 'rB@c6', 'bP@b5'])).toBe(CAPTURE_POINTS[typeOf(stateFromPieces(['rB@c6'], { rules: CHATURAJI_RULES }).cells[sq('c6')])]); // a bishop at its capture value
    expect(loss(['rK@a1', 'rR@c6', 'bP@b5', 'rB@e8'])).toBe(4); // the same boat with a bishop covering c6: only the difference to the pawn that took it (5 - 1)
    expect(loss(['rK@a1', 'rN@h4', 'bP@b5'])).toBe(0); // nothing hangs
    expect(loss(['rK@d1', 'bR@d6'])).toBe(KING_LOSS); // a king is lost whole ...
    expect(loss(['rK@d1', 'bR@d6', 'rR@a1'])).toBe(KING_LOSS); // ... even when a boat of mine covers its square (nothing is "recaptured" after a king)
    expect(loss(['rK@a1', 'rN@c6', 'bP@b5'], YELLOW)).toBe(0); // a seat that cannot reach the piece wins nothing
  });

  it('the careful tier adds EXACTLY its terms to a move: the promotion bonus on a promotion, nothing on a quiet move, the end of the game and no reply term once it is over', () => {
    const exact = (state: FourPlayerState, label: string, careful: boolean): number => {
      const moves = legalMoves(state, state.turn);
      const scoredMoves = scoreMoves(state, moves, careful, 0, pure);
      const index = moves.findIndex((m) => moveLabelOn(m, SQUARE8) === label);
      expect(index, `${label} is a legal move`).toBeGreaterThanOrEqual(0);
      return scoredMoves[index].score;
    };
    const diff = (state: FourPlayerState, label: string) => exact(state, label, true) - exact(state, label, false);
    // a promotion with nothing hanging and no king in sight: careful = greedy + PROMOTION_BONUS, and a quiet king step = greedy + 0
    const promoting = cp(['rK@a1', 'bK@a5', 'yK@h5', 'gK@h1', 'rP@c7'], { turn: RED });
    expect(diff(promoting, 'c7-c8=R')).toBeCloseTo(0.5, 9);
    expect(diff(promoting, 'a1-b1')).toBeCloseTo(0, 9);
    // a king capture that leaves the game on: the capturing boat now attacks a second king (Green's, down the d-file) but nothing is added for it, and nothing hangs
    const capture = cp(['rK@a1', 'rR@d4', 'bK@d8', 'yK@h5', 'gK@d1'], { turn: RED });
    expect(diff(capture, 'd4xd8')).toBeCloseTo(0, 9);
    // a king capture that ends the game (the ply cap, with Yellow's boat still able to take the capturing boat back): exactly +END_WIN when Red leads, -END_LOSS when not -
    // and NO reply term on top, although the boat would hang (the precondition below)
    const capEnds = (score: number[]) => cp(['rK@a1', 'rR@d4', 'bK@d8', 'yK@h7', 'yR@h8', 'gK@h1'], { turn: RED, ply: 999, score });
    const ending = capEnds([0, 0, 0, 0]);
    const endingMove = legalMoves(ending, RED).find((m) => label(m) === 'd4xd8')!;
    const over = playMove(ending, endingMove, pure).state;
    expect(over.result?.reason).toBe('cap');
    expect(worstReplyLoss(over, RED, YELLOW)).toBe(5); // the boat on d8 WOULD be lost: the reply term would subtract 4.25 if it were applied after the end
    expect(diff(capEnds([0, 0, 0, 0]), 'd4xd8')).toBeCloseTo(25, 9);
    expect(diff(capEnds([0, 0, 9, 0]), 'd4xd8')).toBeCloseTo(-25, 9);
    // the one king threat a quiet move makes is worth exactly 0.3 (Blue's king on h5 is attacked down the fifth rank; Yellow and Green are out, nothing hangs)
    const threat = cp(['rK@a1', 'rR@d4', 'bK@h5', 'yK@h8', 'gK@h1'], { turn: RED, status: ['active', 'active', 'frozen', 'frozen'] });
    expect(diff(threat, 'd4-d5')).toBeCloseTo(0.3, 9);
  });

  it('a tie among the best moves is broken by the rng, not by list order; and an rng that returns exactly 1 still gives a legal move', () => {
    // (the other three seats are out, so no king can be threatened and every boat move scores the same)
    const state = cp(['rK@a1', 'rR@d4', 'bK@a7', 'yK@h6', 'gK@h2'], { turn: RED, status: ['active', 'frozen', 'frozen', 'frozen'] });
    const half = () => 0.5; // every wobble draw is equal, so equal scores stay exactly equal
    const moves = legalMoves(state, RED);
    const scoredMoves = scoreMoves(state, moves, true, strengthNoise(TOP), half);
    const best = Math.max(...scoredMoves.map((s) => s.score));
    const ties = scoredMoves.filter((s) => s.score >= best - 1e-9);
    expect(ties.length).toBeGreaterThanOrEqual(3);
    const chosen = chooseChaturajiBotMove(state, TOP, half)!;
    expect(label(chosen)).toBe(label(ties[Math.floor(0.5 * ties.length)].move));
    expect(label(chosen)).not.toBe(label(ties[0].move));
    for (const elo of [GREEDY, TOP]) {
      const edge = chooseChaturajiBotMove(state, elo, () => 1)!;
      expect(moves.some((m) => m.from === edge.from && m.to === edge.to)).toBe(true);
    }
  });

  it('the careful bot, all else equal, makes the move that attacks a king (a threat the next seat has to notice); the greedy one has no such preference', () => {
    // A lone Red boat: every boat move is worth the same in points and material; some of them attack a rival king.
    const state = cp(['rK@a1', 'rR@d4', 'bK@h5', 'yK@h8', 'gK@h2'], { turn: RED });
    const attacking = (move: Move): boolean => kingsAttackedBy(applyMoveRaw(state, move), move.to) > 0;
    const moves = legalMoves(state, RED).filter((m) => typeOf(state.cells[m.from]) !== KING);
    expect(attacking(moves[0])).toBe(false); // so that a tie broken by list order would NOT pick an attacking move
    expect(attacking(chooseChaturajiBotMove(state, CAREFUL, pure)!)).toBe(true);
  });
});

describe('determinism, legality and the weak moments', () => {
  it('the same rng gives the same move; the rng is the only randomness', () => {
    const state = initialState(CHATURAJI_RULES);
    for (const elo of [400, GREEDY, CAREFUL, TOP]) {
      for (let seed = 1; seed <= 5; seed++) expect(label(chooseChaturajiBotMove(state, elo, mulberry32(seed)))).toBe(label(chooseChaturajiBotMove(state, elo, mulberry32(seed))));
    }
    const moves = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) moves.add(label(chooseChaturajiBotMove(state, 400, mulberry32(seed))));
    expect(moves.size).toBeGreaterThan(3); // a 400 bot varies (mostly random moves)
  });

  it('a weak bot makes mistakes and a strong one does not: over many seeds the careful tier at 3000 takes the free boat far more often than at 400', () => {
    const state = cp([...KINGS, 'rR@d4', 'gR@d2', 'bP@g4'], { turn: RED });
    const rate = (elo: number) => {
      let hit = 0;
      for (let seed = 1; seed <= 200; seed++) if (label(chooseChaturajiBotMove(state, elo, mulberry32(seed * 13 + elo))) === 'd4xd2') hit++;
      return hit / 200;
    };
    expect(rate(TOP)).toBeGreaterThan(rate(400) + 0.3);
  });

  it('there is no move for a seat with none: null (the engine never hands a seat the turn without a move)', () => {
    const last = cp(['rK@a1', 'rR@d4', 'gK@d8'], { turn: RED, status: ['active', 'frozen', 'frozen', 'active'] });
    const finished = playMove(last, legalMoves(last, RED).find((m) => label(m) === 'd4xd8')!, pure).state;
    expect(finished.result).not.toBeNull();
    expect(currentMoves(finished)).toEqual([]);
    expect(chooseChaturajiBotMove(finished, CAREFUL, pure)).toBeNull();
    // and a position (not a finished game) in which the seat to move has no move at all: Blue's king is boxed in by its own pawns
    const boxed = cp(['bK@h1', 'bP@g1', 'bP@g2', 'bP@h2', 'rK@a1', 'rN@f2', 'yK@h8', 'gK@a8'], { turn: BLUE });
    expect(legalMoves(boxed, BLUE)).toEqual([]);
    for (const elo of [GREEDY, CAREFUL]) expect(chooseChaturajiBotMove(boxed, elo, pure), `ELO ${elo}`).toBeNull();
  });

  it('property: over seeded games and every ELO of the roster the bot only ever plays a legal move (never null mid-game, never a move outside legalMoves)', () => {
    const elos = [400, 600, 800, 1000, 1200, 1500, 1800, 2200, 3000];
    let decisions = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const rng = mulberry32(seed * 101);
      let state = initialState({ ...CHATURAJI_RULES, maxPlies: 200 });
      for (let step = 0; step < 400 && !state.result; step++) {
        const elo = elos[(seed + step) % elos.length];
        const move = chooseChaturajiBotMove(state, elo, mulberry32(seed * 7919 + step));
        expect(move, `seed ${seed} step ${step}: a seat on move has a move`).not.toBeNull();
        expect(legalMoves(state, state.turn).some((m) => m.from === move!.from && m.to === move!.to && m.flags === move!.flags), `seed ${seed} step ${step}: ${label(move)} is legal`).toBe(true);
        decisions++;
        if (rng() < 0.01) state = resign(state, activeSeats(state)[Math.floor(rng() * activeSeats(state).length)], mulberry32(step)).state;
        else state = playMove(state, move!, mulberry32(seed * 17 + step)).state;
      }
    }
    expect(decisions).toBeGreaterThan(500);
  });
});

// --- the arena ---------------------------------------------------------------------------------------------------------------------------

interface Arena {
  games: number;
  plies: number;
  endings: Record<string, number>;
  kingCaptures: number;
  forks: number;
  promotions: number;
  wins: Record<number, number>;
  shares: Record<number, number>;
}

/** Bot-vs-bot games with the ELOs given per seat; checks scores against an independent tally and that every game terminates. */
function arena(elos: readonly number[][], gamesPerLineup: number, maxPlies = 300): Arena {
  const out: Arena = { games: 0, plies: 0, endings: {}, kingCaptures: 0, forks: 0, promotions: 0, wins: {}, shares: {} };
  for (const lineup of elos) {
    for (let g = 0; g < gamesPerLineup; g++) {
      const seed = out.games * 31 + 7;
      let state = initialState({ ...CHATURAJI_RULES, maxPlies });
      const shadow = [0, 0, 0, 0];
      for (let step = 0; step < maxPlies * 2 && !state.result; step++) {
        const seat = state.turn;
        const move = chooseChaturajiBotMove(state, lineup[seat], mulberry32(seed * 13 + step));
        expect(move, `game ${out.games} step ${step}`).not.toBeNull();
        if (move!.captured) {
          const victim = seatOf(move!.captured);
          if (typeOf(move!.captured) === KING) {
            shadow[seat] += 3;
            out.kingCaptures++;
          } else if (state.status[victim] === 'active') shadow[seat] += CAPTURE_POINTS[typeOf(move!.captured)];
        }
        if (move!.flags & FLAG_PROMOTION) out.promotions++;
        const applied = playMove(state, move!, mulberry32(seed * 17 + step));
        for (const e of applied.events as GameEvent[]) {
          if (e.kind === 'fork') {
            shadow[e.seat] += e.points;
            out.forks++;
          }
        }
        state = applied.state;
        if (!state.result) expect(state.score, `game ${out.games} step ${step}: scores match an independent tally`).toEqual(shadow);
      }
      expect(state.result, `game ${out.games} terminates`).not.toBeNull();
      out.games++;
      out.plies += state.ply;
      out.endings[state.result!.reason] = (out.endings[state.result!.reason] ?? 0) + 1;
      for (const w of state.result!.winners) {
        out.wins[w] = (out.wins[w] ?? 0) + 1;
        out.shares[w] = (out.shares[w] ?? 0) + 1 / state.result!.winners.length;
      }
    }
  }
  return out;
}

describe('arena: bots play whole games', () => {
  it('24 mixed-ELO games: every game terminates with a result, scores always equal an independent tally, and kings fall, forks score and pawns promote', { timeout: 240_000 }, () => {
    const lineups = [
      [1200, 1500, 800, 3000],
      [3000, 600, 1500, 1000],
      [400, 1800, 1200, 1500],
      [1500, 1500, 1500, 1500],
    ];
    const result = arena(lineups, 6);
    // eslint-disable-next-line no-console
    console.info('Chaturaji bot arena (24 games):', result);
    expect(result.games).toBe(24);
    expect(result.kingCaptures).toBeGreaterThan(20);
    expect(Object.keys(result.endings).every((r) => r === 'elimination' || r === 'cap')).toBe(true);
  });

  it('ELO is the strength dial in actual games: a 3000 seat scores a larger share of the wins than a 400 seat in the same game', { timeout: 300_000 }, () => {
    // the top seat rotates through all four chairs against three 400s, so the starting position does not decide it
    const lineups = [0, 1, 2, 3].map((top) => [0, 1, 2, 3].map((s) => (s === top ? 3000 : 400)));
    let topShare = 0;
    for (const lineup of lineups) topShare += arena([lineup], 8).shares[lineup.indexOf(3000)] ?? 0; // wins (shared wins split) of the 3000 seat
    // against three 400 bots a fair share of 32 games would be 8 wins; the 3000 seat should take well over that
    // eslint-disable-next-line no-console
    console.info('Chaturaji arena, one 3000 seat against three 400 seats (32 games): the 3000 seat\'s share of the wins', topShare);
    expect(topShare).toBeGreaterThan(32 * 0.25 * 1.6);
  });
});

// --- latency -----------------------------------------------------------------------------------------------------------------------------

describe('latency: a decision at the top tier stays small (the same budget style as the other 4-seat bots)', () => {
  /** Best of 3 identical runs of one deterministic decision: a scheduler pause can only slow a run down, never speed it up (see TESTING.md section 27). */
  const bestOf = (run: () => void): number => {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      run();
      best = Math.min(best, performance.now() - t0);
    }
    return best;
  };

  it('p99 per decision at ELO 3000 (and 1500) over seeded games, best of 3 per decision; reported, with a generous structural bound', { timeout: 240_000 }, () => {
    const samples: Record<number, number[]> = { 1500: [], 3000: [] };
    for (let seed = 1; seed <= 10; seed++) {
      const rng = mulberry32(seed);
      let state = initialState({ ...CHATURAJI_RULES, maxPlies: 250 });
      while (!state.result) {
        const moves = legalMoves(state, state.turn);
        for (const elo of [1500, 3000]) {
          const decisionSeed = seed * 100_003 + state.ply;
          samples[elo].push(bestOf(() => chooseChaturajiBotMove(state, elo, scored(decisionSeed))));
        }
        const pick = moves[Math.floor(rng() * moves.length)];
        state = playMove(state, pick, mulberry32(seed * 17 + state.ply)).state;
      }
    }
    const stat = (xs: number[]) => {
      const sorted = [...xs].sort((a, b) => a - b);
      return { n: sorted.length, mean: sorted.reduce((a, b) => a + b, 0) / sorted.length, p99: sorted[Math.floor(sorted.length * 0.99)], max: sorted[sorted.length - 1] };
    };
    const top = stat(samples[3000]);
    // eslint-disable-next-line no-console
    console.info('Chaturaji bot decision cost (ms):', { elo3000: top, elo1500: stat(samples[1500]) });
    expect(top.p99).toBeLessThan(25); // the 4 Player Chess careful tier is ~20 ms worst case on this machine; this variant has no deep search
  });

  it('a decision does one legal-move generation per candidate for the next seat and nothing deeper (structural: no search tree)', () => {
    // 3000 and 1500 are the same tier here (no deep tier), so their cost is the same order: not an order of magnitude apart
    const state = initialState(CHATURAJI_RULES);
    const time = (elo: number) => bestOf(() => chooseChaturajiBotMove(state, elo, scored(3)));
    expect(time(3000)).toBeLessThan(time(1500) * 4 + 5);
  });
});



