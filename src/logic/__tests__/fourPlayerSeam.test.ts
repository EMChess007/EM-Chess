import { afterEach, describe, expect, it } from 'vitest';
import {
  CROSS14,
  FFA_OPTIONS,
  FFA_RULES,
  FLAG_CASTLE,
  FLAG_PROMOTION,
  GEOMETRIES,
  GIVEAWAY_OPTIONS,
  GIVEAWAY_RULES,
  KNOWN_RULES,
  PROMOTABLE_TYPES,
  QUEEN,
  ROOK,
  attackers,
  buildGeometry,
  chooseBotMove,
  evaluate,
  isPromotionPremove,
  deserialize,
  geometryOf,
  initialState,
  isInCheck,
  legalMoves,
  listPieces,
  optionsOf,
  playMove,
  promotionOf,
  pseudoMoves,
  serialize,
  stateFromPieces,
  validateRules,
  type BoardId,
  type FourPlayerRules,
  type FourPlayerState,
  type Move,
  type RuleOptions,
  type Seat,
} from '../fourPlayer';

/**
 * The SEAM of Chaturaji W0 (CHATURAJI_SPEC.md section 8.2): the geometry object and the rule options. W0 changes no behaviour (the golden
 * transcripts and the geometry identity test prove that); THIS file proves the seam is real - that the engine reads the board and the options from
 * the state's RULES at every place that used to read a module-level constant - which the golden tests cannot, because with only the cross board
 * installed every read returns the same thing.
 *
 * It does so with two TEST-ONLY boards registered under a throwaway id (never shipped; the validator refuses them):
 *   - `open14`: the cross board's size with NO cut corners (all 196 squares playable). Rays, knight / king neighbours, pawn captures and the cell
 *     array behave differently in the corners, so any engine function that still reads the cross tables gives a different answer.
 *   - `small6`: a 6 x 6 board (36 cells): a different SIZE, so any hard-coded 14 / 196 shows up as a wrong square, a wrong forward coordinate or a
 *     wrong snapshot.
 */
const registered: string[] = [];
function register(id: string, size: number, isPlayable: (file: number, rank: number) => boolean = () => true) {
  const geo = buildGeometry({ id: id as BoardId, size, isPlayable });
  (GEOMETRIES as Record<string, typeof geo>)[id] = geo;
  registered.push(id);
  return geo;
}
afterEach(() => {
  for (const id of registered.splice(0)) delete (GEOMETRIES as Record<string, unknown>)[id];
});

const rulesOn = (id: string, options: Partial<RuleOptions> = {}, base: FourPlayerRules = FFA_RULES): FourPlayerRules => ({
  ...base,
  options: { ...optionsOf(base), board: id as BoardId, ...options },
});
/** A move's name on ITS board ("c2-c4", "a1xb3"): `moveLabel` names squares on the cross board only. */
const label = (state: FourPlayerState, move: Move): string => {
  const geo = geometryOf(state.rules);
  return `${geo.squareName(move.from)}${move.captured ? 'x' : '-'}${geo.squareName(move.to)}`;
};
const movesOf = (state: FourPlayerState, seat: Seat, from: string): string[] => {
  const geo = geometryOf(state.rules);
  return legalMoves(state, seat)
    .filter((m) => m.from === geo.parseSquare(from))
    .map((m) => label(state, m))
    .sort();
};

describe('the cross board is one geometry among others', () => {
  it('FFA_RULES / GIVEAWAY_RULES carry no options of their own: their options are the defaults of their mode', () => {
    expect(FFA_RULES.options).toBeUndefined();
    expect(GIVEAWAY_RULES.options).toBeUndefined();
    expect(optionsOf(FFA_RULES)).toBe(FFA_OPTIONS);
    expect(optionsOf(GIVEAWAY_RULES)).toBe(GIVEAWAY_OPTIONS);
    expect(FFA_OPTIONS).toEqual({ board: 'cross14', pawnDoubleStep: true, castling: true, promotionTypes: PROMOTABLE_TYPES });
    expect(GIVEAWAY_OPTIONS).toEqual({ board: 'cross14', pawnDoubleStep: true, castling: false, promotionTypes: PROMOTABLE_TYPES });
  });

  it('geometryOf resolves the board a rules object names; both shipped presets play on the cross', () => {
    expect(geometryOf(FFA_RULES)).toBe(CROSS14);
    expect(geometryOf(GIVEAWAY_RULES)).toBe(CROSS14);
    const open = register('open14', 14);
    expect(geometryOf(rulesOn('open14'))).toBe(open);
  });

  it('a geometry built by buildGeometry with the cross predicate is table-for-table the shipped one (the builder is deterministic)', () => {
    const again = buildGeometry({ id: 'cross14', size: 14, isPlayable: (f, r) => !((f < 3 || f > 10) && (r < 3 || r > 10)) });
    expect(Array.from(again.valid)).toEqual(Array.from(CROSS14.valid));
    expect(again.rays.map((r) => Array.from(r))).toEqual(CROSS14.rays.map((r) => Array.from(r)));
    expect(again.knightTargets.map((r) => Array.from(r))).toEqual(CROSS14.knightTargets.map((r) => Array.from(r)));
    expect(again.kingTargets.map((r) => Array.from(r))).toEqual(CROSS14.kingTargets.map((r) => Array.from(r)));
  });

  it('a geometry owns its own size: index / file / rank / names / forward coordinate / rotation on a 6 x 6 board', () => {
    const g = register('small6', 6);
    expect(g.cells).toBe(36);
    expect([g.fileOf(20), g.rankOf(20), g.index(2, 3)]).toEqual([2, 3, 20]);
    expect(g.squareName(20)).toBe('c4');
    expect(g.parseSquare('c4')).toBe(20);
    expect(g.parseSquare('g1')).toBe(-1); // off a 6-wide board
    expect(g.parseSquare('a7')).toBe(-1);
    expect([0, 1, 2, 3].map((seat) => g.forwardCoord(seat as Seat, 20))).toEqual([3, 2, 2, 3]); // rank 3, file 2, 5 - 3, 5 - 2
    expect(g.stepForward(0, g.index(0, 5))).toBe(-1); // off the top
    expect(g.toDisplay(1, 2, 1)).toEqual([3, 1]);
    expect(g.fromDisplay(3, 1, 1)).toEqual([1, 2]);
    for (let view = 0; view < 4; view++) for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) expect(g.fromDisplay(...g.toDisplay(x, y, view as Seat), view as Seat)).toEqual([x, y]);
  });
});

describe('the engine reads the board from the state\'s rules, everywhere it used to read a constant', () => {
  it('stateFromPieces / serialize / deserialize / listPieces: the cell array, the rows and the square names follow the board', () => {
    register('small6', 6);
    const rules = rulesOn('small6');
    const state = stateFromPieces(['rK@a1', 'bK@a6', 'yK@f6', 'gK@f1', 'rR@c3'], { rules });
    expect(state.cells.length).toBe(36);
    expect(state.kings).toEqual([0, 30, 35, 5]);
    const text = serialize(state);
    expect(text.split(' ')[0].split('/')).toHaveLength(6);
    expect(text.split(' ')[0].split('/')[0]).toHaveLength(12);
    expect(serialize(deserialize(text, rules))).toBe(text);
    expect(listPieces(state)).toEqual(['rK@a1', 'gK@f1', 'rR@c3', 'bK@a6', 'yK@f6']);
    expect(() => stateFromPieces(['rK@g1'], { rules })).toThrow(/not a playable square/); // file g does not exist on 6 files
  });

  it('a start position needs a board that brings its own layout: initialState refuses a board it has none for', () => {
    register('small6', 6);
    expect(() => initialState(rulesOn('small6'))).toThrow(/no start position for board small6/);
  });

  it('sliders: a rook ray ends where THIS board ends (6 x 6), and the open board has the corner squares the cross board cuts out', () => {
    register('small6', 6);
    register('open14', 14);
    const small = stateFromPieces(['rK@f1', 'bK@a6', 'yK@f6', 'gK@a1', 'rR@c3'], { rules: rulesOn('small6'), turn: 0 });
    expect(movesOf(small, 0, 'c3')).toHaveLength(10); // 5 along the file, 5 along the rank, nothing past the edge
    const pieces = ['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7', 'rR@d1'];
    const cross = stateFromPieces(pieces, { turn: 0 });
    const open = stateFromPieces(pieces, { rules: rulesOn('open14'), turn: 0 });
    const crossRook = movesOf(cross, 0, 'd1');
    const openRook = movesOf(open, 0, 'd1');
    expect(openRook).toContain('d1-a1'); // a1..c1 are cut corners on the cross board
    expect(crossRook).not.toContain('d1-c1');
    expect(openRook).toHaveLength(crossRook.length + 3);
  });

  it('knights follow the board\'s neighbour tables: a corner knight has moves on the open board, and a 6 x 6 edge is an edge', () => {
    register('open14', 14);
    const open = stateFromPieces(['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7', 'rN@a1'], { rules: rulesOn('open14') });
    expect(movesOf(open, 0, 'a1')).toEqual(['a1-b3', 'a1-c2']);
    register('small6', 6);
    const small = stateFromPieces(['rK@f1', 'bK@a6', 'yK@a1', 'gK@c1', 'rN@e5'], { rules: rulesOn('small6') });
    expect(movesOf(small, 0, 'e5')).toEqual(['e5-c4', 'e5-c6', 'e5-d3', 'e5-f3']); // the other four jumps leave the board
  });

  it('kings follow the board\'s neighbour table too (a king in a 6 x 6 corner has three steps)', () => {
    register('small6', 6);
    const small = stateFromPieces(['rK@a1', 'bK@f6', 'yK@f1', 'gK@a6'], { rules: rulesOn('small6') });
    expect(movesOf(small, 0, 'a1')).toEqual(['a1-a2', 'a1-b1', 'a1-b2']);
  });

  it('attackers() takes the board as its last argument (the cross by default), and isInCheck reads the state\'s rules', () => {
    const open = register('open14', 14);
    const state = stateFromPieces(['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7', 'bR@a1'], { rules: rulesOn('open14') });
    const c1 = open.parseSquare('c1');
    expect(attackers(state.cells, state.status, c1, 0, open) & 0b10).toBe(0b10); // Blue's corner rook attacks c1 along the rank
    expect(attackers(state.cells, state.status, c1, 0)).toBe(0); // read with the cross tables, index 2 is a cut corner: nothing
    expect(isInCheck(stateFromPieces(['rK@c1', 'bR@a1', 'bK@a8', 'yK@g14', 'gK@n7'], { rules: rulesOn('open14') }), 0)).toBe(true);
  });

  it('pawns: the forward coordinate, the double step and the promotion line follow the board and the options', () => {
    register('small6', 6);
    const six = (options: Partial<RuleOptions> = {}): FourPlayerRules => ({ ...rulesOn('small6', options), promotionCoord: 5 });
    const kings = ['rK@f1', 'bK@a6', 'yK@f6', 'gK@a1'];
    const start = stateFromPieces([...kings, 'rP@c2'], { rules: six(), turn: 0 });
    expect(movesOf(start, 0, 'c2')).toEqual(['c2-c3', 'c2-c4']); // forward coordinate 1 on this board: a double step is on offer
    const noDouble = stateFromPieces([...kings, 'rP@c2'], { rules: six({ pawnDoubleStep: false }), turn: 0 });
    expect(movesOf(noDouble, 0, 'c2')).toEqual(['c2-c3']);
    // promotion is on THIS board's forward coordinate 5 (rank 6), not the cross board's 7
    const promo = stateFromPieces(['rK@f1', 'bK@a1', 'yK@f6', 'gK@a6', 'rP@c5'], { rules: six(), turn: 0 });
    const promotions = legalMoves(promo, 0).filter((m) => m.flags & FLAG_PROMOTION);
    expect(promotions.map(promotionOf).sort()).toEqual([2, 3, 4, 5]);
    expect(promotions.every((m) => m.to === 32)).toBe(true); // c6 = index 5 * 6 + 2
  });

  it('promotionTypes narrows the choices, and a promoted piece is the one named (a rook-only rule offers exactly one promotion: a rook)', () => {
    const rookOnly = { ...FFA_RULES, options: { ...FFA_OPTIONS, promotionTypes: [ROOK] } } as FourPlayerRules;
    const pieces = ['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7', 'rP@e7'];
    const state = stateFromPieces(pieces, { rules: rookOnly, turn: 0 });
    const promos = legalMoves(state, 0).filter((m) => m.flags & FLAG_PROMOTION);
    expect(promos.map(promotionOf)).toEqual([ROOK]);
    expect(legalMoves(stateFromPieces(pieces, { turn: 0 }), 0).filter((m) => m.flags & FLAG_PROMOTION).map(promotionOf)).toEqual([QUEEN, ROOK, 3, 2]); // FFA: all four, queen first
    expect(listPieces(playMove(state, promos[0], () => 0).state)).toContain('rT@e8'); // a promoted rook now stands on e8
  });

  it('castling follows the option: with every right set the cross position castles with castling on, not with it off; a castling-less board never reads the cross rook table', () => {
    const pieces = ['rK@h1', 'rR@d1', 'rR@k1', 'bK@a8', 'yK@g14', 'gK@n7'];
    const on = stateFromPieces(pieces, { turn: 0 });
    expect(legalMoves(on, 0).some((m) => m.flags & FLAG_CASTLE)).toBe(true);
    const off = stateFromPieces(pieces, { turn: 0, rules: { ...FFA_RULES, options: { ...FFA_OPTIONS, castling: false } } as FourPlayerRules });
    expect(off.castling).toBe(0); // the rights are not even inferred
    expect(legalMoves(off, 0).some((m) => m.flags & FLAG_CASTLE)).toBe(false);
    // On a 6 x 6 board square 3 is d1, but on the cross board it is a rook start whose move would clear a right: it must not here.
    register('small6', 6);
    const small = stateFromPieces(['rK@f1', 'bK@a6', 'yK@f6', 'gK@a1', 'rR@d1'], { rules: rulesOn('small6', { castling: false }), turn: 0, castling: 0b11111111 });
    const rookMove = legalMoves(small, 0).find((m) => m.from === 3)!;
    expect(playMove(small, rookMove, () => 0).state.castling).toBe(0b11111111);
  });
});

describe('turn passing, the bot and premoves read the board too', () => {
  const six = () => {
    register('small6', 6);
    return { ...rulesOn('small6'), promotionCoord: 5 } as FourPlayerRules;
  };

  it('checkmate is detected on the board in play: two rooks mate a corner king on 6 x 6, the elimination credits the mater (+20)', () => {
    const state = stateFromPieces(['rK@a1', 'rR@c6', 'rR@c5', 'bK@a6', 'yK@f3', 'gK@e2'], { rules: six(), turn: 0 });
    const kingMove = legalMoves(state, 0).find((m) => m.to === 1)!; // a1-b1: a quiet move, then the turn reaches Blue
    const { state: after, events } = playMove(state, kingMove, () => 0);
    expect(events.find((e) => e.kind === 'eliminated')).toMatchObject({ seat: 1, reason: 'checkmate', credit: 0 });
    expect(after.score[0]).toBe(20);
    expect(after.status[1]).not.toBe('active');
  });

  it('the same position one rook short is no mate: Blue is not eliminated (the attack tables belong to the 6 x 6 board)', () => {
    const state = stateFromPieces(['rK@a1', 'rR@c6', 'bK@a6', 'yK@f3', 'gK@e2'], { rules: six(), turn: 0 });
    const { events } = playMove(state, legalMoves(state, 0).find((m) => m.to === 1)!, () => 0);
    expect(events.some((e) => e.kind === 'eliminated')).toBe(false);
  });

  it('the bot evaluation rewards an advanced pawn by the forward coordinate of the BOARD in play (+0.04 per step on 6 x 6)', () => {
    const rules = six();
    const at = (square: string) => evaluate(stateFromPieces(['rK@f1', 'bK@a6', 'yK@f6', 'gK@a1', `rP@${square}`], { rules }), 0);
    expect(at('c3') - at('c2')).toBeCloseTo(0.04, 10);
    expect(at('c5') - at('c2')).toBeCloseTo(0.12, 10);
  });

  it('a careful bot does not hang its rook: on 6 x 6 it declines a pawn that a Blue rook guards, because it asks THIS board who attacks the square', () => {
    const rules = six();
    // Red rook c2 may take Green's pawn on c5, but Blue's rook on a5 then takes the rook along rank 5 (nothing defends it).
    const state = stateFromPieces(['rK@f1', 'rR@c2', 'gP@c5', 'bR@a5', 'bK@a6', 'yK@f6'], { rules, turn: 0 });
    expect(legalMoves(state, 0).some((m) => m.captured !== 0)).toBe(true); // the capture exists
    const careful = chooseBotMove(state, 1500, () => 0)!;
    expect(careful.captured).toBe(0); // ...and the careful bot does not play it
    const greedy = chooseBotMove(state, 600, () => 0)!;
    expect(greedy.captured).not.toBe(0); // the greedy tier only counts points, so it grabs the pawn
  });

  it('a knight attack next to a corner counts on THIS board: a Blue knight on c2 checks a Red king on a1 (6 x 6)', () => {
    const state = stateFromPieces(['rK@a1', 'bN@c2', 'bK@f6', 'yK@f3', 'gK@e5'], { rules: six(), turn: 0 });
    expect(isInCheck(state, 0)).toBe(true);
  });

  it('pawn captures are generated on THIS board: a Red pawn on c2 takes a piece on d3 and one on b3 (6 x 6)', () => {
    const state = stateFromPieces(['rK@f1', 'rP@c2', 'bN@d3', 'gN@b3', 'bK@a6', 'yK@f6', 'gK@a1'], { rules: six(), turn: 0 });
    expect(movesOf(state, 0, 'c2')).toEqual(['c2-c3', 'c2-c4', 'c2xb3', 'c2xd3']);
  });

  it('a board with more cells than the cross has is read in full: a king on rank 16 of a 16 x 16 board is found (kings[] and the cell array)', () => {
    register('big16', 16);
    const state = stateFromPieces(['rK@a16', 'bK@b16', 'yK@c16', 'gK@d16'], { rules: rulesOn('big16') });
    expect(state.cells.length).toBe(256);
    expect(state.kings).toEqual([240, 241, 242, 243]);
    expect(serialize(state).split(' ')[0].split('/')).toHaveLength(16);
  });

  it('castling needs the option even when the rights are set: with castling off and every right given by hand there is no castling move', () => {
    const pieces = ['rK@h1', 'rR@d1', 'rR@k1', 'bK@a8', 'yK@g14', 'gK@n7'];
    const off = stateFromPieces(pieces, { turn: 0, castling: 0b11111111, rules: { ...FFA_RULES, options: { ...FFA_OPTIONS, castling: false } } as FourPlayerRules });
    expect(off.castling).toBe(0b11111111);
    expect(legalMoves(off, 0).some((m) => m.flags & FLAG_CASTLE)).toBe(false);
  });

  it('the castling path is checked against the board in play: a corner rook that only exists on the open board forbids castling out of its check', () => {
    register('open14', 14);
    const pieces = ['rK@h1', 'rR@k1', 'bR@a1', 'bK@a8', 'yK@g14', 'gK@n7'];
    const open = stateFromPieces(pieces, { rules: rulesOn('open14'), turn: 0 }); // the king is attacked along rank 1 from the corner
    expect(isInCheck(open, 0)).toBe(true);
    expect(legalMoves(open, 0).some((m) => m.flags & FLAG_CASTLE)).toBe(false);
    const cross = stateFromPieces(['rK@h1', 'rR@k1', 'bK@a8', 'yK@g14', 'gK@n7'], { turn: 0 }); // the same position without the corner rook castles
    expect(legalMoves(cross, 0).some((m) => m.flags & FLAG_CASTLE)).toBe(true);
  });

  it('a defended piece is not "hanging": the careful bot takes the guarded pawn when its own second rook defends the square (6 x 6)', () => {
    const rules = six();
    const state = stateFromPieces(['rK@f1', 'rR@c2', 'rR@e5', 'gP@c5', 'bR@a5', 'bK@a6', 'yK@f6'], { rules, turn: 0 });
    const geo = geometryOf(rules);
    const move = chooseBotMove(state, 1500, () => 0)!;
    expect([move.from, move.to]).toEqual([geo.parseSquare('c2'), geo.parseSquare('c5')]);
  });

  it('a pawn attack next to a corner counts on a board that has no cut corners: a Blue pawn on a2 checks a Red king on b1 (6 x 6)', () => {
    const state = stateFromPieces(['rK@b1', 'bP@a2', 'bK@f6', 'yK@f3', 'gK@e2'], { rules: six(), turn: 0 });
    expect(isInCheck(state, 0)).toBe(true);
  });

  it('a double step records the skipped square on THIS board (en passant): Red c2-c4 on 6 x 6 passes c3', () => {
    const state = stateFromPieces(['rK@f1', 'rP@c2', 'bK@a6', 'yK@f6', 'gK@a1'], { rules: six(), turn: 0 });
    const geo = geometryOf(state.rules);
    const after = playMove(state, legalMoves(state, 0).find((m) => m.from === geo.parseSquare('c2') && m.to === geo.parseSquare('c4'))!, () => 0).state;
    expect(after.ep).toEqual({ passed: geo.parseSquare('c3'), pawn: geo.parseSquare('c4'), by: 0 });
  });

  it('a walking dead king steps onto the empty neighbours of THIS board: a corner king on 6 x 6 has three', () => {
    const state = stateFromPieces(['rK@a1', 'bK@f6', 'yK@f1', 'gK@a6'], { rules: six(), turn: 0, status: ['dead-king', 'active', 'active', 'active'] });
    expect(pseudoMoves(state, 0).map((m) => label(state, m)).sort()).toEqual(['a1-a2', 'a1-b1', 'a1-b2']);
  });

  it('a promotion premove is recognised on the promotion line of the board in play (forward coordinate 4 -> 5 on 6 x 6, not the cross board one)', () => {
    const rules = six();
    const state = stateFromPieces(['rK@f1', 'bK@a1', 'yK@f6', 'gK@a6', 'rP@c5'], { rules, turn: 1 });
    const geo = geometryOf(rules);
    expect(isPromotionPremove(state, 0, geo.parseSquare('c5'), geo.parseSquare('c6'))).toBe(true);
    const quiet = stateFromPieces(['rK@f1', 'bK@a1', 'yK@f6', 'gK@a6', 'rP@c3'], { rules, turn: 1 });
    expect(isPromotionPremove(quiet, 0, geo.parseSquare('c3'), geo.parseSquare('c4'))).toBe(false);
  });
});

describe('the validator accepts only the shipped presets', () => {
  it('the known presets are accepted, as themselves, whatever order the fields arrive in', () => {
    for (const preset of KNOWN_RULES) {
      const result = validateRules(JSON.parse(JSON.stringify(preset)));
      expect(result.ok && result.rules).toBe(preset);
    }
    expect(validateRules({ maxPlies: 1000, promotionCoord: 7, mode: 'giveaway' })).toEqual({ ok: true, rules: GIVEAWAY_RULES });
  });

  it('anything else is refused: a tuned number, an option mix, an unknown board, junk', () => {
    expect(validateRules({ ...FFA_RULES, maxPlies: 999 }).ok).toBe(false);
    expect(validateRules({ ...FFA_RULES, options: { ...FFA_OPTIONS, castling: false } }).ok).toBe(false);
    expect(validateRules({ ...GIVEAWAY_RULES, options: { ...GIVEAWAY_OPTIONS, pawnDoubleStep: false } }).ok).toBe(false);
    register('small6', 6);
    expect(validateRules(rulesOn('small6')).ok).toBe(false);
    expect(validateRules({ mode: 'chaturaji' }).ok).toBe(false);
    for (const junk of [null, undefined, 0, 'ffa', [], {}]) expect(validateRules(junk).ok).toBe(false);
  });

  it('exactly two presets exist (Chaturaji adds the third in W1), and the 4 Player start position still has 20 pseudo-legal moves for Red', () => {
    expect(KNOWN_RULES).toEqual([FFA_RULES, GIVEAWAY_RULES]);
    expect(pseudoMoves(initialState(), 0)).toHaveLength(20); // 8 pawns x 2 + 2 knights x 2
  });
});
