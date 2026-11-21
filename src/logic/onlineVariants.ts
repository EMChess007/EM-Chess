import type { GameVariant } from '../components/VariantSelector';

/** The variant flags exactly as they travel on the wire (join_queue / create_challenge payloads — see
 * backend/src/game/types.ts). Variants are mutually exclusive, so at most one is ever true. */
export interface OnlineVariantFlags {
  isChess960: boolean;
  isKingOfTheHill: boolean;
  isThreeCheck: boolean;
  isSetupChess: boolean;
  isFogOfWar: boolean;
  isGiveaway: boolean;
  isAtomic: boolean;
  isDuckChess: boolean;
  isSpellChess: boolean;
  isHorde: boolean;
  isRacingKings: boolean;
  isTorpedo: boolean;
  isKnightmate: boolean;
  isCrazyhouse: boolean;
}

/** Turns the single-select VariantSelector value into the wire flags — one place instead of a
 * positional boolean per variant threaded through every Online screen. */
export function variantWireFlags(variant: GameVariant): OnlineVariantFlags {
  return {
    isChess960: variant === 'chess960',
    isKingOfTheHill: variant === 'kingOfTheHill',
    isThreeCheck: variant === 'threeCheck',
    isSetupChess: variant === 'setupChess',
    isFogOfWar: variant === 'fogOfWar',
    isGiveaway: variant === 'giveaway',
    isAtomic: variant === 'atomic',
    isDuckChess: variant === 'duckChess',
    isSpellChess: variant === 'spellChess',
    isHorde: variant === 'horde',
    isRacingKings: variant === 'racingKings',
    isTorpedo: variant === 'torpedo',
    isKnightmate: variant === 'knightmate',
    isCrazyhouse: variant === 'crazyhouse',
  };
}

/** The 2-player variants a Tournament cannot run. Setup Chess: no start position exists until both players have built a blind army
 * (a pairing phase with no room yet), and a tournament match is room-based end to end. From Position is not a GameVariant (challenge only). */
export const TOURNAMENT_EXCLUDED_VARIANTS: GameVariant[] = ['setupChess'];

/** Wire flags -> the single-select variant (the reverse of variantWireFlags); 'classic' when none is set. Accepts the partial flag
 * records old servers send (a missing flag is false). */
export function variantFromWireFlags(flags: Partial<OnlineVariantFlags>): GameVariant {
  if (flags.isChess960) return 'chess960';
  if (flags.isKingOfTheHill) return 'kingOfTheHill';
  if (flags.isThreeCheck) return 'threeCheck';
  if (flags.isSetupChess) return 'setupChess';
  if (flags.isFogOfWar) return 'fogOfWar';
  if (flags.isGiveaway) return 'giveaway';
  if (flags.isAtomic) return 'atomic';
  if (flags.isDuckChess) return 'duckChess';
  if (flags.isSpellChess) return 'spellChess';
  if (flags.isHorde) return 'horde';
  if (flags.isRacingKings) return 'racingKings';
  if (flags.isTorpedo) return 'torpedo';
  if (flags.isKnightmate) return 'knightmate';
  if (flags.isCrazyhouse) return 'crazyhouse';
  return 'classic';
}

/** The variant's display name ("Classic", "Fog of War", ...), for a lobby / standings subtitle. */
export function variantDisplayName(variant: GameVariant): string {
  const prefix = variantTitlePrefix(variant).replace(' · ', '');
  return prefix === '' ? 'Classic' : prefix;
}

/** Complete wire flags from a possibly partial record (every missing flag false) - one place for the tournament payloads. */
export function completeVariantFlags(flags: Partial<OnlineVariantFlags>): OnlineVariantFlags {
  return variantWireFlags(variantFromWireFlags(flags));
}

/** Short title used on the matchmaking screen, e.g. "Giveaway · "; empty for the classic game. */
export function variantTitlePrefix(variant: GameVariant): string {
  switch (variant) {
    case 'chess960':
      return 'Chess960 · ';
    case 'kingOfTheHill':
      return 'King of the Hill · ';
    case 'threeCheck':
      return 'Three-Check · ';
    case 'setupChess':
      return 'Setup Chess · ';
    case 'fogOfWar':
      return 'Fog of War · ';
    case 'giveaway':
      return 'Giveaway · ';
    case 'atomic':
      return 'Atomic · ';
    case 'duckChess':
      return 'Duck Chess · ';
    case 'spellChess':
      return 'Spell Chess · ';
    case 'racingKings':
      return 'Racing Kings · ';
    case 'torpedo':
      return 'Torpedo · ';
    case 'knightmate':
      return 'Knightmate · ';
    case 'horde':
      return 'Horde · ';
    case 'crazyhouse':
      return 'Crazyhouse · ';
    default:
      return '';
  }
}
