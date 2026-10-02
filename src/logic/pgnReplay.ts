import { START_FEN } from '../types/chess';
import type { GameHistoryEntry } from '../types/history';
import { ChessEngine } from './ChessEngine';

const ALL_SQUARES: string[] = [];
for (let f = 0; f < 8; f++) {
  for (let r = 1; r <= 8; r++) {
    ALL_SQUARES.push(`${String.fromCharCode(97 + f)}${r}`);
  }
}

const PROMOTION_PIECES: ('q' | 'r' | 'b' | 'n')[] = ['q', 'r', 'b', 'n'];

function stripSanDecorations(san: string): string {
  return san.replace(/[+#!?]+$/g, '');
}

/**
 * Resolves a SAN move token (as found in a PGN's movetext) to the from/to/promotion needed by
 * ChessEngine.move(). chess.js's own SAN parser doesn't understand this app's Chess960 castling
 * (see ChessEngine.ts's own doc comment on why), so this instead brute-forces every legal move
 * from `fen` through ChessEngine itself (which does handle Chess960 castling correctly) and
 * keeps whichever one produces a matching SAN. Cheap enough for a one-off "replay this game for
 * analysis" action — not meant for a hot loop.
 */
function resolveSanMove(
  fen: string,
  chess960: boolean,
  initialFen: string,
  sanTarget: string
): { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' } | null {
  const target = stripSanDecorations(sanTarget);
  const probe = new ChessEngine(fen, { chess960, initialFen });
  const turnColor = probe.getTurn();

  for (const from of ALL_SQUARES) {
    const piece = probe.getPieceAt(from);
    if (!piece || piece.color !== turnColor) continue;

    for (const to of probe.getLegalMoves(from)) {
      const isPromotion = piece.type === 'p' && (to[1] === '1' || to[1] === '8');
      const promotions: (typeof PROMOTION_PIECES)[number][] | [undefined] = isPromotion ? PROMOTION_PIECES : [undefined];

      for (const promotion of promotions) {
        const trial = new ChessEngine(fen, { chess960, initialFen });
        const result = trial.move(from, to, promotion);
        if (result && stripSanDecorations(result.san) === target) {
          return { from, to, promotion };
        }
      }
    }
  }
  return null;
}

/** Parses a `[FEN "..."]` PGN tag if present (see buildPgn in pgn.ts), else the standard
 * starting position. */
function extractInitialFen(pgn: string): string {
  const match = pgn.match(/\[FEN\s+"([^"]+)"\]/);
  return match ? match[1] : START_FEN;
}

const RESULT_TOKENS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

/** Strips PGN tag lines and the trailing result token, returning the raw SAN move tokens in
 * order (move numbers like "12." / "12..." stripped too). */
function extractSanTokens(pgn: string): string[] {
  const withoutTags = pgn.replace(/\[[^\]]*\]/g, ' ');
  return withoutTags
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .filter((token) => !/^\d+\.+$/.test(token))
    .map((token) => token.replace(/^\d+\.+/, ''))
    .filter((token) => token.length > 0 && !RESULT_TOKENS.has(token));
}

/**
 * Replays an already-tokenized list of SAN moves from `initialFen`, resolving each one through
 * ChessEngine (so Chess960 castling — see resolveSanMove above — is handled correctly). Returns
 * null if any token can't be resolved to a legal move, rather than a partial, silently wrong
 * result. Shared by replayPgn below (which does its own PGN tokenizing) and pgnImport.ts (which
 * needs a more thorough tokenizer that also strips comments/NAGs/variations a foreign PGN may
 * contain).
 */
export function replaySanTokens(initialFen: string, chess960: boolean, sanTokens: string[]): GameHistoryEntry[] | null {
  const history: GameHistoryEntry[] = [];
  let fen = initialFen;

  for (const san of sanTokens) {
    const resolved = resolveSanMove(fen, chess960, initialFen, san);
    if (!resolved) return null;

    const engine = new ChessEngine(fen, { chess960, initialFen });
    const move = engine.move(resolved.from, resolved.to, resolved.promotion);
    if (!move) return null;

    const fenAfter = engine.getFen();
    history.push({ move, fenBefore: fen, fenAfter });
    fen = fenAfter;
  }

  return history;
}

/**
 * Reconstructs the move-by-move history (fenBefore/fenAfter per move) a stored game's PGN
 * represents — the same shape a live game screen builds incrementally as it's played (see
 * LocalGameScreen/BotGameScreen), so it can feed straight into AnalysisScreen. Returns null if
 * any move in the PGN can't be resolved (a corrupt/foreign PGN) rather than a partial, silently
 * wrong result.
 */
export function replayPgn(pgn: string, chess960: boolean): { initialFen: string; history: GameHistoryEntry[] } | null {
  // Giveaway (Antichess) games play by different rules (mandatory captures, capturable kings, king
  // promotion), so replaying or analysing one with ordinary chess rules would be wrong even when it
  // happens not to fail outright — see buildPgn's variant tag.
  if (/\[Variant\s+"Antichess"\]/i.test(pgn)) return null;
  const initialFen = extractInitialFen(pgn);
  const history = replaySanTokens(initialFen, chess960, extractSanTokens(pgn));
  return history ? { initialFen, history } : null;
}
