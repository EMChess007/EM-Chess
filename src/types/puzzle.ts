export interface PuzzleData {
  id: string;
  /** The position before the "setup" move (index 0 of `moves`) is played. */
  fen: string;
  /**
   * Full UCI move sequence, Lichess puzzle convention: moves[0] is the opponent's "setup" move
   * (auto-played, not shown to the solver as something to find), moves[1] is the first move the
   * solver must find, moves[2] the opponent's automatic reply, moves[3] the solver's next move,
   * and so on, alternating, ending on a solver move.
   */
  moves: string[];
  rating: number;
  themes: string[];
}
