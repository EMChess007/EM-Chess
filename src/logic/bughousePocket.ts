/**
 * The geometry of a Bughouse pocket (the row of piece chips in a player's bar) as NUMBERS, so that it is a calculation and not an accident of the layout engine (command #27b).
 *
 * WHAT WENT WRONG ON THE PHONE. The pocket was a `flex: 1, flexWrap: 'wrap'` row inside the bar: with two kinds of piece in it the chips stacked one under the other and the second one was
 * drawn over the top rank of the board (and, in the bottom bar, over "White to move"). The bar was supposed to grow with the wrapped chips - which the browser's flexbox does, so the web
 * device matrix (and the fixture of the earlier branch) passed - but a pocket that wraps makes the bar's height, the board's position and the clipping of everything around it depend on how
 * the phone's own layout engine measures a wrapping flex child. Nothing may depend on that: the strip is now a fixed single row that never wraps, every chip has a computed width, and the
 * bar clips what it holds, so that whatever a layout engine does, nothing can be drawn outside the strip. Chips shrink (to POCKET_CHIP_MIN_WIDTH) instead of wrapping; the seat's name gives up
 * its place before the pocket does (`showSeatName`).
 *
 * Pure: no React. The strip's own width is MEASURED by the component (onLayout) and handed in; until it is, the defaults here are the safe ones (smallest chips, name shown).
 */

/** Chips per pocket: pawn, knight, bishop, rook, queen. */
export const POCKET_MAX_CHIPS = 5;
export const POCKET_CHIP_HEIGHT = 26;
export const POCKET_CHIP_HEIGHT_COMPACT = 24;
/** The smallest a chip is drawn: a 17 dp piece and the count's pill beside it (a two-digit count). */
export const POCKET_CHIP_MIN_WIDTH = 24;
export const POCKET_CHIP_MAX_WIDTH = 40;
export const POCKET_GAP = 2;
export const POCKET_PADDING = 2;

export const pocketChipHeight = (compact: boolean): number => (compact ? POCKET_CHIP_HEIGHT_COMPACT : POCKET_CHIP_HEIGHT);

/** The width a pocket of `chips` chips needs at the smallest chip: the least the row may be given. */
export function pocketMinWidth(chips: number): number {
  if (chips <= 0) return 0;
  return 2 * POCKET_PADDING + chips * POCKET_CHIP_MIN_WIDTH + (chips - 1) * POCKET_GAP;
}

/**
 * The width of each chip when `chips` chips share `rowWidth` (the measured width of the pocket row): as wide as the room allows, never below the minimum (the strip's layout guarantees
 * the room, see `showSeatName`) and never above the maximum (two chips in a wide row do not stretch). `null` = not measured yet: the smallest, which always fits.
 */
export function pocketChipWidth(rowWidth: number | null, chips: number): number {
  if (rowWidth === null || chips <= 0) return POCKET_CHIP_MIN_WIDTH;
  const room = rowWidth - 2 * POCKET_PADDING - (chips - 1) * POCKET_GAP;
  return Math.max(POCKET_CHIP_MIN_WIDTH, Math.min(POCKET_CHIP_MAX_WIDTH, Math.floor(room / chips)));
}

// The strip's other parts, in dp (the styles of BughouseBoardBlock use these same numbers).
export const STRIP_PADDING = 4;
export const STRIP_GAP = 4;
export const STRIP_DOT = 10;
export const STRIP_SHAPE = 12;
export const STRIP_CLOCK_MIN_WIDTH = 46;
/** The least the seat's name is given when it is shown: one short word ("You", "Beginner"). */
export const STRIP_NAME_MIN_WIDTH = 56;

/** What the strip needs besides the name and the pocket: its padding, the colour dot, the team shape, the clock and the four gaps between the five parts. */
export const STRIP_FIXED_WIDTH = 2 * STRIP_PADDING + STRIP_DOT + STRIP_SHAPE + STRIP_CLOCK_MIN_WIDTH + 4 * STRIP_GAP;

/** The strip width from which the seat's name is shown NEXT TO a pocket of all five kinds. Below it the name is left out (the colour dot, the team shape, the clock and the status line say who is who). */
export const NAME_MIN_STRIP_WIDTH = STRIP_FIXED_WIDTH + pocketMinWidth(POCKET_MAX_CHIPS) + STRIP_NAME_MIN_WIDTH;

/**
 * Whether the strip shows the seat's name. Decided by the strip's width ALONE, with room kept for a full pocket - never by what the pocket holds now, so nothing jumps while a game is
 * played. Before the first measurement (`null`) the name is shown.
 */
export function showSeatName(stripWidth: number | null): boolean {
  return stripWidth === null || stripWidth >= NAME_MIN_STRIP_WIDTH;
}

/** The size of the piece inside a chip. */
export const pocketPieceSize = (compact: boolean): number => pocketChipHeight(compact) - 6;
