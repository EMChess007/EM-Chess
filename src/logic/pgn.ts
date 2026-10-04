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
export function buildPgn(initialFen: string, history: GameHistoryEntry[], result: string, variant?: string): string {
  const fenParts = initialFen.split(' ');
  const startTurn: 'w' | 'b' = fenParts[1] === 'b' ? 'b' : 'w';
  const startMoveNumber = parseInt(fenParts[5], 10) || 1;

  const movetext = formatSanMoves(
    startTurn,
    startMoveNumber,
    // Duck Chess: where the duck went rides along as a standard PGN comment, "e4 {@g6}" — a bare "e4 @g6" would
    // break the movetext grammar for any tool that reads the export.
    history.map((entry) => (entry.move.duck ? `${entry.move.san} {@${entry.move.duck}}` : entry.move.san))
  );

  const tags = [`[Result "${result}"]`];
  if (variant) tags.push(`[Variant "${variant}"]`);
  if (initialFen !== START_FEN) {
    tags.push('[SetUp "1"]', `[FEN "${initialFen}"]`);
  }

  return `${tags.join('\n')}\n\n${movetext} ${result}`.trim();
}
