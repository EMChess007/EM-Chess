/** The pixel size an 8x8 ChessBoard renders at for a given viewport width — shared with
 * anything that needs to visually align to the board, like the analysis eval bar. */
export function getBoardSize(viewportWidth: number): number {
  const squareSize = Math.floor(Math.min(viewportWidth - 32, 400) / 8);
  return squareSize * 8;
}
