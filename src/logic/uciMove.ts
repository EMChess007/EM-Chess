import { ChessEngine, type ChessEngineOptions } from './ChessEngine';
import { formatSanMoves } from './sanFormat';

export interface UciMove {
  from: string;
  to: string;
  promotion?: 'n' | 'b' | 'r' | 'q';
}

const PROMOTION_PIECES = new Set(['n', 'b', 'r', 'q']);

/** Parses a UCI move string (e.g. "e2e4", "e7e8q") into its from/to/promotion parts. */
export function parseUciMove(uci: string): UciMove | null {
  const trimmed = uci.trim();
  if (trimmed.length < 4 || trimmed === '(none)') return null;

  const from = trimmed.slice(0, 2);
  const to = trimmed.slice(2, 4);
  const promotionChar = trimmed.length >= 5 ? trimmed[4].toLowerCase() : undefined;
  const promotion = promotionChar && PROMOTION_PIECES.has(promotionChar) ? (promotionChar as UciMove['promotion']) : undefined;

  return { from, to, promotion };
}

/** Converts a UCI move string into SAN notation (e.g. "Nf3") by playing it on a scratch
 * ChessEngine at the given position. Returns null if the move can't be parsed or played. */
export function uciMoveToSan(uci: string, fen: string, options?: ChessEngineOptions): string | null {
  const parsed = parseUciMove(uci);
  if (!parsed) return null;
  const engine = new ChessEngine(fen, options);
  const move = engine.move(parsed.from, parsed.to, parsed.promotion);
  return move?.san ?? null;
}

/**
 * Renders a UCI move sequence (a principal variation) as a readable, move-numbered SAN string,
 * e.g. "23...Qxf8 24.Rxb8 Qxb8 25.Nd5", by playing it out on a scratch ChessEngine. Stops early
 * if a move can't be parsed/played (e.g. the engine's `pv` ran past the position it thought was
 * reachable) or once `maxPly` moves have been rendered.
 */
export function uciSequenceToSan(fen: string, uciMoves: string[], options?: ChessEngineOptions, maxPly = 6): string {
  const engine = new ChessEngine(fen, options);
  const startMoveNumber = parseInt(fen.split(' ')[5], 10) || 1;
  const startTurn = engine.getTurn();
  const sanMoves: string[] = [];

  for (let i = 0; i < Math.min(uciMoves.length, maxPly); i++) {
    const parsed = parseUciMove(uciMoves[i]);
    if (!parsed) break;
    const move = engine.move(parsed.from, parsed.to, parsed.promotion);
    if (!move) break;
    sanMoves.push(move.san);
  }

  return formatSanMoves(startTurn, startMoveNumber, sanMoves);
}
