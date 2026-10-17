import { describe, expect, it } from 'vitest';
import { START_FEN } from '../../types/chess';
import { ChessEngine } from '../ChessEngine';
import {
  FREEZE_INITIAL_CHARGES,
  JUMP_INITIAL_CHARGES,
  SPELL_COOLDOWN_TURNS,
  activeJumpSquare,
  afterSpellChessMove,
  canCastFreeze,
  canCastJump,
  castFreeze,
  castJump,
  checkIsWaivedByFreeze,
  frozenSquaresFor,
  getCheckingPieceSquares,
  getFreezeZoneSquares,
  getJumpAugmentedCaptures,
  getSpellChessWinner,
  initialSpellChessState,
  spellMoveNotation,
} from '../spellChess';

const engine = (fen: string) => new ChessEngine(fen, { skipValidation: true });

describe('getFreezeZoneSquares', () => {
  it('is the full 3x3 around a center square not touching the edge', () => {
    expect(getFreezeZoneSquares('e4').sort()).toEqual(['d3', 'd4', 'd5', 'e3', 'e4', 'e5', 'f3', 'f4', 'f5'].sort());
  });

  it('clips to a 2x2 corner', () => {
    expect(getFreezeZoneSquares('a1').sort()).toEqual(['a1', 'a2', 'b1', 'b2'].sort());
    expect(getFreezeZoneSquares('h8').sort()).toEqual(['g7', 'g8', 'h7', 'h8'].sort());
  });

  it('clips to a 2x3 edge', () => {
    expect(getFreezeZoneSquares('a4').sort()).toEqual(['a3', 'a4', 'a5', 'b3', 'b4', 'b5'].sort());
    expect(getFreezeZoneSquares('e1').sort()).toEqual(['d1', 'd2', 'e1', 'e2', 'f1', 'f2'].sort());
  });
});

describe('charges and cooldowns', () => {
  it('starts with 5 freezes and 2 jumps per side, both ready', () => {
    const state = initialSpellChessState();
    expect(state.w.charges).toEqual({ freeze: FREEZE_INITIAL_CHARGES, jump: JUMP_INITIAL_CHARGES });
    expect(state.b.charges).toEqual({ freeze: FREEZE_INITIAL_CHARGES, jump: JUMP_INITIAL_CHARGES });
    expect(canCastFreeze(state, 'w')).toBe(true);
    expect(canCastJump(state, 'w')).toBe(true);
  });

  it('casting spends exactly one charge of that type and starts a 3-turn cooldown, leaving the other spell untouched', () => {
    const state = initialSpellChessState();
    const afterFreeze = castFreeze(state, 'w', 'e4');
    expect(afterFreeze.w.charges).toEqual({ freeze: FREEZE_INITIAL_CHARGES - 1, jump: JUMP_INITIAL_CHARGES });
    expect(afterFreeze.w.cooldowns.freeze).toBe(SPELL_COOLDOWN_TURNS);
    expect(afterFreeze.w.cooldowns.jump).toBe(0);
    expect(canCastFreeze(afterFreeze, 'w')).toBe(false);
    expect(canCastJump(afterFreeze, 'w')).toBe(true);
    // Black's own charges/cooldowns are untouched by White's cast.
    expect(afterFreeze.b).toEqual(state.b);
  });

  it('a cast while on cooldown or out of charges is a no-op', () => {
    const state = initialSpellChessState();
    const onCooldown = castFreeze(state, 'w', 'e4');
    expect(castFreeze(onCooldown, 'w', 'd4')).toEqual(onCooldown);

    const noCharges = { ...state, w: { ...state.w, charges: { ...state.w.charges, jump: 0 } } };
    expect(castJump(noCharges, 'w', 'a7')).toEqual(noCharges);
  });

  it('cooldown counts down only on the casting player\'s OWN turns, 3 of them before it is castable again', () => {
    let state = castFreeze(initialSpellChessState(), 'w', 'e4');
    expect(canCastFreeze(state, 'w')).toBe(false);
    // Black moving doesn't count against White's cooldown.
    state = afterSpellChessMove(state, 'b');
    expect(state.w.cooldowns.freeze).toBe(SPELL_COOLDOWN_TURNS);
    state = afterSpellChessMove(state, 'w'); // 1 of White's own turns passed
    expect(state.w.cooldowns.freeze).toBe(2);
    expect(canCastFreeze(state, 'w')).toBe(false);
    state = afterSpellChessMove(state, 'b');
    state = afterSpellChessMove(state, 'w'); // 2
    expect(state.w.cooldowns.freeze).toBe(1);
    state = afterSpellChessMove(state, 'b');
    state = afterSpellChessMove(state, 'w'); // 3
    expect(state.w.cooldowns.freeze).toBe(0);
    expect(canCastFreeze(state, 'w')).toBe(true);
  });

  it('cooldown never goes negative once already at 0', () => {
    let state = initialSpellChessState();
    state = afterSpellChessMove(state, 'w');
    expect(state.w.cooldowns).toEqual({ freeze: 0, jump: 0 });
  });
});

describe('freeze timing', () => {
  it('restricts only the opponent\'s very next move, never the caster\'s own current move', () => {
    const state = castFreeze(initialSpellChessState(), 'w', 'e4');
    expect(frozenSquaresFor(state, 'w')).toEqual([]); // White's own upcoming move is unaffected
    expect(frozenSquaresFor(state, 'b').sort()).toEqual(getFreezeZoneSquares('e4').sort());
  });

  it('clears the instant the restricted side has played their one move, not before and not lingering after', () => {
    let state = castFreeze(initialSpellChessState(), 'w', 'e4');
    state = afterSpellChessMove(state, 'w'); // White's own move after casting: freeze untouched, still pending for Black
    expect(frozenSquaresFor(state, 'b').length).toBe(9);
    state = afterSpellChessMove(state, 'b'); // Black's restricted move is now used up
    expect(state.pendingFreeze).toBeNull();
    expect(frozenSquaresFor(state, 'b')).toEqual([]);
  });
});

describe('jump timing', () => {
  it('is active for the caster\'s own move AND the opponent\'s one reply, then expires', () => {
    let state = castJump(initialSpellChessState(), 'w', 'a7');
    expect(activeJumpSquare(state)).toBe('a7');
    state = afterSpellChessMove(state, 'w'); // caster's own move consumes it
    expect(activeJumpSquare(state)).toBe('a7'); // still live for the opponent's reply
    state = afterSpellChessMove(state, 'b'); // opponent's reply consumes the window
    expect(activeJumpSquare(state)).toBeNull();
  });
});

describe('getJumpAugmentedCaptures', () => {
  it('lets a rook blocked only by its own pawn jump it to capture the piece beyond (the canonical a-file trap)', () => {
    // Black rook a8, Black pawn a7 (blocker), empty a6, White queen a5, Black to move.
    const fen = 'r3k3/p7/8/Q7/8/8/8/4K3 b - - 0 1';
    const caps = getJumpAugmentedCaptures(engine(fen), 'a7', 'b');
    expect(caps).toEqual([{ from: 'a8', to: 'a5', san: '', captured: 'q' }]);
  });

  it('produces nothing once the blocking piece has moved away (recomputed fresh, not cached)', () => {
    const vacated = 'r3k3/8/8/Q7/8/8/8/4K3 b - - 0 1'; // a7 now empty
    expect(getJumpAugmentedCaptures(engine(vacated), 'a7', 'b')).toEqual([]);
  });

  it('never lets a piece jump its own blocker to capture a piece of its own color', () => {
    const ownPieceBeyond = 'r3k3/p7/8/r7/8/8/8/4K3 b - - 0 1'; // beyond a7 is Black's own rook — no capture offered
    expect(getJumpAugmentedCaptures(engine(ownPieceBeyond), 'a7', 'b')).toEqual([]);
  });

  it('only the correct piece TYPE for the ray may use the jump: a rook needs an orthogonal line, a bishop a diagonal one', () => {
    // Bishop on a1, own pawn on b2 (diagonal blocker), enemy knight on c3 beyond — bishop should jump it.
    const bishopDiag = '4k3/8/8/8/8/2n5/1P6/B3K3 w - - 0 1';
    expect(getJumpAugmentedCaptures(engine(bishopDiag), 'b2', 'w')).toEqual([{ from: 'a1', to: 'c3', san: '', captured: 'n' }]);

    // Rook on a1, own pawn on a2 (orthogonal blocker), enemy knight on a3 beyond — rook jumps it...
    const rookOrth = '4k3/8/8/8/8/n7/P7/R3K3 w - - 0 1';
    expect(getJumpAugmentedCaptures(engine(rookOrth), 'a2', 'w')).toEqual([{ from: 'a1', to: 'a3', san: '', captured: 'n' }]);

    // ...but swap the SAME rook onto a diagonal line from the jump square (own pawn b2 as a diagonal blocker,
    // enemy knight c3 beyond) and it gets no candidate at all — a rook cannot use a diagonal jump line.
    const rookWrongGeometry = '4k3/8/8/8/8/2n5/1P6/R3K3 w - - 0 1';
    expect(getJumpAugmentedCaptures(engine(rookWrongGeometry), 'b2', 'w')).toEqual([]);
  });

  it('a queen may bypass on either orthogonal or diagonal lines', () => {
    const diag = '4k3/8/8/8/8/2n5/1P6/Q3K3 w - - 0 1';
    expect(getJumpAugmentedCaptures(engine(diag), 'b2', 'w')).toEqual([{ from: 'a1', to: 'c3', san: '', captured: 'n' }]);
  });

  it('includes the enemy king as a capturable target — Spell Chess\'s whole point for this spell', () => {
    const kingBeyond = 'k7/p7/8/8/8/8/8/R3K3 w - - 0 1'; // White rook a1, Black pawn a7 blocking, Black king a8 beyond
    expect(getJumpAugmentedCaptures(engine(kingBeyond), 'a7', 'w')).toEqual([{ from: 'a1', to: 'a8', san: '', captured: 'k' }]);
  });

  it('knights, kings and pawns can never be the jumping piece — jump only ever applies to sliders', () => {
    // Knight on a1 "blocked" by a2 pawn is meaningless (knights jump naturally) — no candidate from a1.
    const knightNear = '4k3/8/8/8/8/n7/P7/N3K3 w - - 0 1';
    expect(getJumpAugmentedCaptures(engine(knightNear), 'a2', 'w')).toEqual([]);
  });

  it('an empty jump square (its piece already moved) yields no candidates at all', () => {
    expect(getJumpAugmentedCaptures(engine(START_FEN), 'e4', 'w')).toEqual([]);
  });
});

describe('getCheckingPieceSquares / checkIsWaivedByFreeze', () => {
  it('finds the single checking piece', () => {
    const inCheck = '4k3/8/8/8/8/8/8/r3K3 w - - 0 1'; // Black rook checks White king along the back rank
    expect(getCheckingPieceSquares(engine(inCheck), 'w')).toEqual(['a1']);
  });

  it('finds BOTH checking pieces in a double check', () => {
    // White king e1 attacked by both a rook on e8 (file) and a knight on d3 (knight check).
    const doubleCheck = '4r3/8/8/8/8/3n4/8/4K3 w - - 0 1';
    expect(getCheckingPieceSquares(engine(doubleCheck), 'w').sort()).toEqual(['d3', 'e8'].sort());
  });

  it('is empty when not in check', () => {
    expect(getCheckingPieceSquares(engine(START_FEN), 'w')).toEqual([]);
  });

  it('waives check only when EVERY checking piece is inside the freeze zone — not just one of several', () => {
    const doubleCheck = '4r3/8/8/8/8/3n4/8/4K3 w - - 0 1';
    const e = engine(doubleCheck);
    expect(checkIsWaivedByFreeze(e, 'w', getFreezeZoneSquares('e8'))).toBe(false); // only covers the rook
    expect(checkIsWaivedByFreeze(e, 'w', [...getFreezeZoneSquares('e8'), 'd3'])).toBe(true); // covers both
  });

  it('is false with an empty freeze zone and false when not in check at all', () => {
    expect(checkIsWaivedByFreeze(engine(START_FEN), 'w', [])).toBe(false);
    expect(checkIsWaivedByFreeze(engine(START_FEN), 'w', ['e2', 'e4'])).toBe(false);
  });
});

describe('getSpellChessWinner', () => {
  it('is the mover when their move captured a king, null otherwise', () => {
    expect(getSpellChessWinner({ from: 'a1', to: 'a8', san: '', captured: 'k' }, 'w')).toBe('w');
    expect(getSpellChessWinner({ from: 'a1', to: 'a8', san: '', captured: 'q' }, 'w')).toBeNull();
    expect(getSpellChessWinner(null, 'w')).toBeNull();
  });
});

describe('spellMoveNotation', () => {
  it('prefixes a freeze or jump cast, and leaves an uncast move alone', () => {
    expect(spellMoveNotation({ san: 'Nf3' }, { type: 'freeze', center: 'e4', squares: getFreezeZoneSquares('e4') })).toBe('F@e4 Nf3');
    expect(spellMoveNotation({ san: 'Rxd8' }, { type: 'jump', square: 'd5' })).toBe('J@d5 Rxd8');
    expect(spellMoveNotation({ san: 'Nf3' }, null)).toBe('Nf3');
    expect(spellMoveNotation({ san: 'Nf3' }, undefined)).toBe('Nf3');
  });
});
