/** The 3 live time-control categories a rating is tracked for — daily/unlimited games have no
 * live clock pressure and aren't rated, same reasoning OnlineTimeControlSelectScreen already
 * uses to exclude them from online matchmaking. */
export type RatingCategory = 'bullet' | 'blitz' | 'rapid';

export const RATING_CATEGORIES: RatingCategory[] = ['bullet', 'blitz', 'rapid'];

/** Narrows any TimeControlCategory (which also includes 'daily'/'unlimited') down to a
 * RatingCategory, or null if this category isn't rated. */
export function toRatingCategory(category: string): RatingCategory | null {
  return (RATING_CATEGORIES as string[]).includes(category) ? (category as RatingCategory) : null;
}

export const DEFAULT_RATING = 1200;

// A fairly standard casual K-factor — big enough that a handful of games visibly moves the
// number (the point of a fun internal rating), not tuned for competitive-grade precision.
const K_FACTOR = 32;

/** 1 = win, 0.5 = draw, 0 = loss, always from "this player"'s point of view. */
export type GameResult = 0 | 0.5 | 1;

function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

/** Standard Elo update. `opponentRating` is the bot's real (fixed) ELO for bot games; for online
 * games — where no calibrated opponent rating exists — callers pass the player's own current
 * rating instead, which is a common simplifying assumption for a casual, non-competitive internal
 * rating (it reduces to a flat ±K/2 adjustment per win/loss, still directionally meaningful). */
export function updateRating(rating: number, opponentRating: number, result: GameResult): number {
  const expected = expectedScore(rating, opponentRating);
  return Math.round(rating + K_FACTOR * (result - expected));
}
