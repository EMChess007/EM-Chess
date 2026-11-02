import type { FourVariant } from './fourPlayer/state';

/**
 * THE GAMES THE ONLINE CARD OFFERS BESIDES THE 2-PLAYER VARIANTS (command #35). Quick Match and Challenge a Friend show one chip row: the 2-player variants (`GameVariant`, components/VariantSelector)
 * and these four "4 Player Variations". A chip of this kind routes to the game's own queue (Quick Match: `four_join_queue` / `bug_join_queue`) or its own friend room (Challenge a Friend:
 * `four_room_*` / `bug_room_*`); the 2-player chips go to `join_queue` / `create_challenge` as before.
 */
export type FourSeatGame = 'fourPlayerChess' | 'fourPlayerGiveaway' | 'chaturaji' | 'crazyBughouse';

export const FOUR_SEAT_GAMES: readonly { value: FourSeatGame; label: string }[] = [
  { value: 'fourPlayerChess', label: '4 Player\nChess' },
  { value: 'fourPlayerGiveaway', label: '4 Player\nGiveaway' },
  { value: 'chaturaji', label: 'Chaturaji' },
  { value: 'crazyBughouse', label: 'Crazy\nBughouse' },
];

/** The name the screens and the lists show for each game, on one line. */
export const FOUR_SEAT_GAME_TITLES: Readonly<Record<FourSeatGame, string>> = {
  fourPlayerChess: '4 Player Chess',
  fourPlayerGiveaway: '4 Player Giveaway',
  chaturaji: 'Chaturaji',
  crazyBughouse: 'Crazy Bughouse',
};

export const isFourSeatGame = (value: unknown): value is FourSeatGame => typeof value === 'string' && (value as string) in FOUR_SEAT_GAME_TITLES;

/** The 4-seat engine's variant of a game; null for Crazy Bughouse (its own engine). */
export function fourVariantOfGame(game: FourSeatGame): FourVariant | null {
  return game === 'fourPlayerChess' ? 'ffa' : game === 'fourPlayerGiveaway' ? 'giveaway' : game === 'chaturaji' ? 'chaturaji' : null;
}

export function gameOfFourVariant(variant: FourVariant): FourSeatGame {
  return variant === 'giveaway' ? 'fourPlayerGiveaway' : variant === 'chaturaji' ? 'chaturaji' : 'fourPlayerChess';
}
