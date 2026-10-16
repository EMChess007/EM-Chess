import { describe, expect, it } from 'vitest';
import { ChessEngine } from '../ChessEngine';
import { chooseSpellChessBotCast } from '../bots';
import { castFreeze, castJump, initialSpellChessState } from '../spellChess';

const engine = (fen: string) => new ChessEngine(fen, { skipValidation: true });
const neverSkip = () => 0; // always below any actChance > 0, so the bot always "tries"
const alwaysSkip = () => 0.999999;

describe('chooseSpellChessBotCast', () => {
  it('casts a defensive freeze covering a single checking piece when in check', () => {
    const inCheck = '4k3/8/8/8/8/8/8/r3K3 w - - 0 1'; // Black rook a1 checks White king e1
    const cast = chooseSpellChessBotCast(engine(inCheck), 'w', initialSpellChessState(), 3000, neverSkip);
    expect(cast?.type).toBe('freeze');
    if (cast?.type === 'freeze') {
      expect(cast.squares).toContain('a1');
    }
  });

  it('does not attempt a defensive freeze when no single zone covers a double check', () => {
    const doubleCheck = '4r3/8/8/8/8/3n4/8/4K3 w - - 0 1'; // rook e8 + knight d3, too far apart for one 3x3
    const cast = chooseSpellChessBotCast(engine(doubleCheck), 'w', initialSpellChessState(), 3000, neverSkip);
    // No jump charges context here and no capture available either, so nothing should fire.
    expect(cast).toBeNull();
  });

  it('casts an offensive jump only when a real capture of at least a minor piece is available', () => {
    // White rook a1, own pawn a2 (blocker), Black knight a3 beyond — worth jumping.
    const worthwhile = '4k3/8/8/8/8/n7/P7/R3K3 w - - 0 1';
    const cast = chooseSpellChessBotCast(engine(worthwhile), 'w', initialSpellChessState(), 3000, neverSkip);
    expect(cast).toEqual({ type: 'jump', square: 'a2' });
  });

  it('never casts jump when the only jump capture on offer is a pawn (below the minor-piece bar)', () => {
    const pawnOnly = '4k3/8/8/8/8/p7/P7/R3K3 w - - 0 1'; // beyond a2 is just a pawn
    const cast = chooseSpellChessBotCast(engine(pawnOnly), 'w', initialSpellChessState(), 3000, neverSkip);
    expect(cast).toBeNull();
  });

  it('casts an offensive freeze around the enemy king when a capture is available and nothing more urgent applies', () => {
    // White knight f3 can capture the pawn on d4; no check, and no sliding piece to make jump relevant.
    const canCapture = '4k3/8/8/8/3p4/5N2/8/4K3 w - - 0 1';
    const cast = chooseSpellChessBotCast(engine(canCapture), 'w', initialSpellChessState(), 3000, neverSkip);
    expect(cast).toEqual({ type: 'freeze', center: 'e8', squares: expect.arrayContaining(['e8']) });
  });

  it('casts nothing when there is no check, no profitable jump and no capture to back up a freeze', () => {
    const quiet = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    expect(chooseSpellChessBotCast(engine(quiet), 'w', initialSpellChessState(), 3000, neverSkip)).toBeNull();
  });

  it('respects charges/cooldown — never offers a spell that canCastFreeze/canCastJump already forbids', () => {
    const inCheck = '4k3/8/8/8/8/8/8/r3K3 w - - 0 1';
    const onCooldown = castFreeze(initialSpellChessState(), 'w', 'a1'); // uses White's freeze charge/cooldown
    expect(chooseSpellChessBotCast(engine(inCheck), 'w', onCooldown, 3000, neverSkip)).toBeNull();

    const worthwhile = '4k3/8/8/8/8/n7/P7/R3K3 w - - 0 1';
    const jumpOnCooldown = castJump(initialSpellChessState(), 'w', 'h8'); // casting starts a 3-turn cooldown at once
    expect(chooseSpellChessBotCast(engine(worthwhile), 'w', jumpOnCooldown, 3000, neverSkip)).toBeNull();
  });

  it('ELO gates whether the bot acts at all — a roll at/above its chance threshold skips casting entirely', () => {
    const inCheck = '4k3/8/8/8/8/8/8/r3K3 w - - 0 1';
    expect(chooseSpellChessBotCast(engine(inCheck), 'w', initialSpellChessState(), 400, alwaysSkip)).toBeNull();
  });
});
