import { START_FEN } from '../types/chess';
import type { GameHistoryEntry } from '../types/history';
import { formatSanMoves } from './sanFormat';

/**
 * Builds a minimal but valid PGN (Result tag + movetext, plus FEN/SetUp tags for non-standard
 * starting positions like Chess960) from a game's move history. Built from `history`'s own SAN
 * values rather than chess.js's internal move log, because Chess960 castling in ChessEngine
 * reloads the position via a raw FEN (see ChessEngine.performChess960Castle), which resets
 * chess.js's own history — `history` is the only complete, reliable record across that.
 */
export function buildPgn(initialFen: string, history: GameHistoryEntry[], result: string): string {
  const fenParts = initialFen.split(' ');
  const startTurn: 'w' | 'b' = fenParts[1] === 'b' ? 'b' : 'w';
  const startMoveNumber = parseInt(fenParts[5], 10) || 1;

  const movetext = formatSanMoves(
    startTurn,
    startMoveNumber,
    history.map((entry) => entry.move.san)
  );

  const tags = [`[Result "${result}"]`];
  if (initialFen !== START_FEN) {
    tags.push('[SetUp "1"]', `[FEN "${initialFen}"]`);
  }

  return `${tags.join('\n')}\n\n${movetext} ${result}`.trim();
}
