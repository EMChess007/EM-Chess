import { describe, expect, it } from 'vitest';
import { ChessEngine } from '../ChessEngine';
import {
  afterSpellChessMove,
  canCastFreeze,
  canCastJump,
  castFreeze,
  castJump,
  initialSpellChessState,
  SPELL_COOLDOWN_TURNS,
  type SpellChessState,
} from '../spellChess';

/**
 * Gaps found by the mutation check of the merged Spell Chess (paired/spell-chess): casting Jump never cost a charge in any test, Freeze was never
 * tried with 0 charges, and the engine-level Jump captures and Freeze check-waiver were only exercised through helpers, not through the engine's own
 * getLegalMoves / move(). Each test names the mutant it kills.
 */
const spell = (fen: string, extra: Record<string, unknown> = {}) => new ChessEngine(fen, { skipValidation: true, spellChess: true, ...extra });

describe('charges are really spent', () => {
  it('a Jump cast costs exactly one Jump charge (2 -> 1 -> 0) and nothing else', () => {
    let state = initialSpellChessState();
    expect(state.w.charges).toEqual({ freeze: 5, jump: 2 });
    state = castJump(state, 'w', 'e5');
    expect(state.w.charges).toEqual({ freeze: 5, jump: 1 });
    // The cooldown must run out before the next cast: three of White's own turns.
    expect(canCastJump(state, 'w')).toBe(false);
    for (let i = 0; i < SPELL_COOLDOWN_TURNS; i++) state = afterSpellChessMove(state, 'w');
    expect(canCastJump(state, 'w')).toBe(true);
    state = castJump(state, 'w', 'd4');
    expect(state.w.charges).toEqual({ freeze: 5, jump: 0 });
    for (let i = 0; i < SPELL_COOLDOWN_TURNS; i++) state = afterSpellChessMove(state, 'w');
    expect(canCastJump(state, 'w')).toBe(false); // out of charges even with the cooldown over
    expect(castJump(state, 'w', 'c3')).toBe(state); // ...and a refused cast changes nothing
  });

  it('Freeze cannot be cast with 0 charges even when its cooldown is over, and a refused cast changes nothing', () => {
    const empty: SpellChessState = { ...initialSpellChessState(), w: { charges: { freeze: 0, jump: 2 }, cooldowns: { freeze: 0, jump: 0 } } };
    expect(canCastFreeze(empty, 'w')).toBe(false);
    expect(castFreeze(empty, 'w', 'e7')).toBe(empty);
    expect(canCastFreeze(empty, 'b')).toBe(true); // the other side is unaffected
  });
});

describe('the engine honours Jump through getLegalMoves and move()', () => {
  // White rook a1 behind its own pawn a2; Black pawn a7 beyond. Jumping over a2 lets the rook capture a7.
  const FEN = '4k3/p7/8/8/8/8/P7/R3K3 w - - 0 1';

  it('without a Jump square the rook cannot reach a7; with Jump on a2 it can (as a target and as a move)', () => {
    expect(spell(FEN).getLegalMoves('a1')).not.toContain('a7');
    expect(spell(FEN).move('a1', 'a7')).toBeNull();

    const jumping = spell(FEN, { jumpSquare: 'a2' });
    expect(jumping.getLegalMoves('a1')).toContain('a7');
    const played = spell(FEN, { jumpSquare: 'a2' }).move('a1', 'a7');
    expect(played).not.toBeNull();
    expect(played?.captured).toBe('p');
  });

  it('Jump is the caster side only: the OTHER side cannot use a jump square for its own sliders', () => {
    // Black to move with the same jump square: its pieces are not the ones blocked only by a2.
    expect(spell('4k3/p7/8/8/8/8/P7/R3K3 b - - 0 1', { jumpSquare: 'a2' }).getLegalMoves('a7')).not.toContain('a1');
  });
});

describe('the engine honours the Freeze check waiver through move()', () => {
  // White king e1 is in check from the rook on e8. Normally only a king move / interposition is legal.
  const FEN = '4r1k1/8/8/8/8/8/P7/4K3 w - - 0 1';

  it('while in check, an unrelated pawn move is illegal... unless the Freeze cast this turn covers every checker', () => {
    expect(spell(FEN).move('a2', 'a3')).toBeNull();
    expect(spell(FEN, { freezeEscapeActive: false }).getLegalMoves('a2')).toEqual([]);

    expect(spell(FEN, { freezeEscapeActive: true }).getLegalMoves('a2')).toContain('a3');
    expect(spell(FEN, { freezeEscapeActive: true }).move('a2', 'a3')).not.toBeNull();
  });
});
