import { Chess } from 'chess.js';
import { START_FEN } from '../types/chess';
import type { GameHistoryEntry } from '../types/history';
import { replaySanTokens } from './pgnReplay';

export interface PgnMetadata {
  event?: string;
  white?: string;
  black?: string;
  date?: string;
  result?: string;
}

export interface ParsedPgn {
  metadata: PgnMetadata;
  initialFen: string;
  chess960: boolean;
  history: GameHistoryEntry[];
}

export type PgnParseResult = { ok: true; parsed: ParsedPgn } | { ok: false; error: string };

// chess.js's PGN parser fills in these placeholders for tags a real game doesn't have — not
// worth showing to the user as if they were real metadata.
const PLACEHOLDER_HEADER_VALUES = new Set(['?', '????.??.??', '*']);

function cleanHeaderValue(value: string | undefined): string | undefined {
  if (!value || PLACEHOLDER_HEADER_VALUES.has(value)) return undefined;
  return value;
}

const CLASSICAL_BACK_RANK = 'RNBQKBNR';

/** Whether this PGN represents a Chess960 (Fischer Random) game — chess.js's own castling logic
 * assumes classical e1/e8 king and a1/h1/a8/h8 rook squares (see ChessEngine.ts's own doc
 * comment) and doesn't even recognize O-O/O-O-O as legal for anything else, so this decides
 * whether the moves need to be resolved through ChessEngine's Chess960-aware logic instead.
 * Detected from the PGN's own [Variant] tag (what Lichess/chess.com exports use for 960 games)
 * or, failing that, whether its [FEN] tag's back rank differs from the classical piece order. */
function detectChess960(headers: Record<string, string>): boolean {
  if (headers.Variant && /960|fischer/i.test(headers.Variant)) return true;

  const fenTag = headers.FEN;
  if (!fenTag) return false;
  const backRank = fenTag.split(' ')[0]?.split('/')[7]?.toUpperCase();
  return backRank !== undefined && backRank !== CLASSICAL_BACK_RANK;
}

const RESULT_TOKENS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

/** Strips brace/semicolon comments and (possibly nested) parenthesized variations before
 * tokenizing — real-world PGNs exported from Lichess/chess.com/ChessBase commonly carry these,
 * unlike this app's own bare-movetext export (see pgn.ts), and chess.js's own parser handles them
 * fine on its own — this is only needed for the Chess960-castling fallback path below, where we
 * have to tokenize the movetext ourselves instead of trusting chess.js's move validation. */
function tokenizeMovetext(pgn: string): string[] {
  const withoutTags = pgn.replace(/\[[^\]]*\]/g, ' ');
  const withoutBraceComments = withoutTags.replace(/\{[^}]*\}/g, ' ');
  const withoutLineComments = withoutBraceComments.replace(/;[^\n]*/g, ' ');

  // Parenthesized variations can nest (a sub-line within a sub-line) — a regex can't balance
  // that, so this scans character by character and drops everything between a '(' and its
  // matching ')'.
  let depth = 0;
  let withoutVariations = '';
  for (const ch of withoutLineComments) {
    if (ch === '(') {
      depth += 1;
      continue;
    }
    if (ch === ')') {
      if (depth > 0) depth -= 1;
      continue;
    }
    withoutVariations += depth > 0 ? ' ' : ch;
  }

  return withoutVariations
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .filter((token) => !/^\$\d+$/.test(token)) // NAGs, e.g. "$1"
    .filter((token) => !/^\d+\.+$/.test(token)) // bare move numbers, e.g. "12."
    .map((token) => token.replace(/^\d+\.+/, '')) // "12.e4"/"12...e5" -> "e4"/"e5"
    .filter((token) => token.length > 0 && !RESULT_TOKENS.has(token));
}

/** Parses pasted/imported PGN text into everything BoardSetupScreen's "Analyze this position"
 * flow and AnalysisScreen itself need. Tries chess.js's own loadPgn first — it validates the
 * whole PGN and, on success, its own verbose move history (with exact before/after FEN per move)
 * is both simpler and more robust than any hand-rolled parsing, correctly handling comments/NAGs/
 * variations a foreign PGN may contain. The one thing it can't handle is an actual Chess960
 * castling move against a non-classical rook arrangement (see detectChess960's doc comment) —
 * loadPgn throws on that, so on failure this falls back to resolving a from-scratch tokenized
 * move list through ChessEngine's own Chess960-aware move resolution (replaySanTokens, shared
 * with pgnReplay.ts's replayPgn) instead. If that ALSO fails, the PGN really was invalid. */
export function parsePgn(pgn: string): PgnParseResult {
  const trimmed = pgn.trim();
  if (!trimmed) return { ok: false, error: 'Paste or select a PGN first.' };

  const probe = new Chess();
  let loaded = true;
  try {
    probe.loadPgn(trimmed);
  } catch {
    loaded = false;
  }

  // Header/tag parsing (and loading the [FEN] tag's position, if any) happens before chess.js
  // plays through the movetext, so both are populated correctly even when loadPgn goes on to
  // throw on a later move it can't resolve.
  const headers = probe.getHeaders();
  // Atomic and Antichess games (this app's own saved ones are tagged the same way, see buildPgn) follow
  // different rules, so loading them with ordinary chess rules would either fail or — worse — quietly
  // succeed and be analysed wrongly. Refused with a clear message instead.
  if (headers.Variant && /^\s*(atomic|antichess)\s*$/i.test(headers.Variant)) {
    return { ok: false, error: `${headers.Variant.trim()} games can't be analysed — only standard chess and Chess960.` };
  }
  const initialFen = headers.FEN ?? START_FEN;
  const chess960 = detectChess960(headers);

  const history = loaded
    ? probe.history({ verbose: true }).map((m) => ({
        move: {
          from: m.from,
          to: m.to,
          promotion: m.promotion as 'n' | 'b' | 'r' | 'q' | undefined,
          san: m.san,
          captured: m.captured as GameHistoryEntry['move']['captured'],
        },
        fenBefore: m.before,
        fenAfter: m.after,
      }))
    : replaySanTokens(initialFen, chess960, tokenizeMovetext(trimmed));

  if (!history) {
    return { ok: false, error: 'Invalid PGN — could not parse the moves.' };
  }

  return {
    ok: true,
    parsed: {
      metadata: {
        event: cleanHeaderValue(headers.Event),
        white: cleanHeaderValue(headers.White),
        black: cleanHeaderValue(headers.Black),
        date: cleanHeaderValue(headers.Date),
        result: cleanHeaderValue(headers.Result),
      },
      initialFen,
      chess960,
      history,
    },
  };
}
