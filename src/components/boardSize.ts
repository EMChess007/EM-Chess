// Everything around the board on the tallest of the four GameScreenBody screens (BotGameScreen:
// header + move list, subtitle, status line, a player row above and below the board, opening
// name, bottom action bar) in its typical state — not the rare worst case where every optional
// banner (engine error, "bot is thinking", hint) is visible at once. Reserving for the typical
// case keeps the board a sensible size on ordinary screens; the rare worst case still renders
// correctly, just via GameScreenBody's scroll fallback (see its scroll indicator) instead of
// every banner fitting on screen with zero scrolling.
const RESERVED_CHROME_HEIGHT = 450;
const MIN_SQUARE_SIZE = 24;

/** The pixel size an 8x8 ChessBoard renders at for a given viewport width (and, optionally,
 * available height) — shared with anything that needs to visually align to the board, like the
 * analysis eval bar.
 *
 * Passing `viewportHeight` keeps the board from sizing itself taller than what's actually visible
 * on a short window — otherwise a wide-but-short viewport (e.g. ~720px tall) still renders the
 * board at its full width-driven size, pushing the board's own bottom row down behind the
 * screen's bottom action bar. */
export function getBoardSize(viewportWidth: number, viewportHeight?: number): number {
  const widthBudget = Math.min(viewportWidth - 32, 400);
  const budget = viewportHeight === undefined ? widthBudget : Math.min(widthBudget, viewportHeight - RESERVED_CHROME_HEIGHT);
  const squareSize = Math.max(Math.floor(budget / 8), MIN_SQUARE_SIZE);
  return squareSize * 8;
}
