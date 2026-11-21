import { describe, expect, it } from 'vitest';
import type { GameVariant } from '../../components/VariantSelector';
import { TOURNAMENT_EXCLUDED_VARIANTS, completeVariantFlags, variantDisplayName, variantFromWireFlags, variantWireFlags } from '../onlineVariants';
import { tournamentMatchToGame } from '../tournamentMatch';

// Literal lists on purpose (command #65): every variant a tournament accepts, with the name its lobby / standings show.
const TOURNAMENT_VARIANTS: [GameVariant, string][] = [
  ['classic', 'Classic'],
  ['chess960', 'Chess960'],
  ['kingOfTheHill', 'King of the Hill'],
  ['threeCheck', 'Three-Check'],
  ['fogOfWar', 'Fog of War'],
  ['giveaway', 'Giveaway'],
  ['atomic', 'Atomic'],
  ['duckChess', 'Duck Chess'],
  ['spellChess', 'Spell Chess'],
  ['horde', 'Horde'],
  ['racingKings', 'Racing Kings'],
  ['torpedo', 'Torpedo'],
  ['knightmate', 'Knightmate'],
  ['crazyhouse', 'Crazyhouse'],
];

describe('tournament variants (command #65)', () => {
  it('only Setup Chess is excluded from tournaments', () => {
    expect(TOURNAMENT_EXCLUDED_VARIANTS).toEqual(['setupChess']);
  });

  it.each(TOURNAMENT_VARIANTS)('%s: wire flags -> variant -> display name round-trips', (variant, name) => {
    const flags = variantWireFlags(variant);
    expect(variantFromWireFlags(flags)).toBe(variant);
    expect(variantDisplayName(variant)).toBe(name);
    expect(Object.values(flags).filter(Boolean)).toHaveLength(variant === 'classic' ? 0 : 1);
  });

  it('a missing flag is false: an older server that sends no flags is Classic, a partial record completes to the full one', () => {
    expect(variantFromWireFlags({})).toBe('classic');
    expect(completeVariantFlags({ isTorpedo: true })).toEqual(variantWireFlags('torpedo'));
  });

  it.each(TOURNAMENT_VARIANTS)('%s: a tournament match enters the game with that variant and nothing else', (variant) => {
    const game = tournamentMatchToGame(
      { ...variantWireFlags(variant), roomId: 'R', color: 'b', playerToken: 'tok', timeControl: { initialSeconds: 180, incrementSeconds: 2 }, fen: 'f', whiteMs: 1, blackMs: 2, visibleSquares: ['e2'] },
      { userId: 'u2' },
    );
    expect(game).toMatchObject({ ...variantWireFlags(variant), roomId: 'R', color: 'b', playerToken: 'tok', opponent: { userId: 'u2' }, fen: 'f', whiteMs: 1, blackMs: 2, visibleSquares: ['e2'] });
  });

  it('visibleSquares is only present when the server sent it (Fog of War)', () => {
    const game = tournamentMatchToGame({ roomId: 'R', color: 'w', playerToken: 't', timeControl: { initialSeconds: 60, incrementSeconds: 0 }, fen: 'f', whiteMs: 1, blackMs: 1 }, { userId: null });
    expect(game).not.toHaveProperty('visibleSquares');
  });
});
