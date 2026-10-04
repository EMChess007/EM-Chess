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
  };
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
    default:
      return '';
  }
}
