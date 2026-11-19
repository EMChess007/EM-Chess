// Everything around the board on the tallest of the four GameScreenBody screens (BotGameScreen:
// header + move list, subtitle, status line, a player row above and below the board, opening
// name, bottom action bar) in its typical state — not the rare worst case where every optional
// banner (engine error, "bot is thinking", hint) is visible at once. The board size is otherwise
// fixed; screens rely on GameScreenBody's scroll to reach anything past this typical-state budget.
const RESERVED_CHROME_HEIGHT = 450;
const MIN_SQUARE_SIZE = 24;

/** The editor boards (Board Editor / From Position, Setup Chess army builder) sit inside the screen's 16 dp side padding, in a 2 dp border. */
export const EDITOR_BOARD_SIDE_PADDING = 16;
export const EDITOR_BOARD_BORDER = 2;

/**
 * The square size, in dp, of an EDITOR board (a board of touchable squares that is not drawn by ChessBoard). Unlike `getBoardSize` it leaves room for the board's own border,
 * so `8 * square + 2 * border` never exceeds the width the screen gives its content (command #55: on a 360 dp phone the old 41 dp squares + border were 4 dp too wide).
 * Never below MIN_SQUARE_SIZE. The editor board is never a flex-wrapped row: see EditorBoardGrid.
 */
export function getEditorSquareSize(viewportWidth: number): number {
  const content = Math.min(viewportWidth - 2 * EDITOR_BOARD_SIDE_PADDING - 2 * EDITOR_BOARD_BORDER, 400);
  return Math.max(Math.floor(content / 8), MIN_SQUARE_SIZE);
}

/** The style of an editor square's touch target: exactly the square, never shrunk by its row. */
export const editorSquareStyle = (squareSize: number) => ({ width: squareSize, height: squareSize, flexShrink: 0 }) as const;

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
