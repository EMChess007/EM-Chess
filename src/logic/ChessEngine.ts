import { Chess, Move as ChessJsMove, type Square as ChessJsSquare } from 'chess.js';
import type { BoardSquare, GameStatus, Move, Piece, PieceColor } from '../types/chess';
import { START_FEN } from '../types/chess';
import { collapseFenRank, expandFenRank, getChess960BackRankFiles } from './chess960';

const FILES = 'abcdefgh';

/** chess.js's own internal move shape — not exported by name, but structurally identical to this
 * (TypeScript matches structurally, so this works wherever chess.js's own unexported
 * `InternalMove` type is expected, e.g. the `Move` class's constructor). See `ChessInternals`
 * below for why this exists at all. */
interface InternalMove {
  color: PieceColor;
  from: number;
  to: number;
  piece: 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
  captured?: 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
  promotion?: 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
  flags: number;
}

/**
 * Fog of War needs chess.js to allow moves that leave the mover's own king in check — impossible
 * via its public API, which always enforces king-safety (confirmed empirically: no documented
 * option on `moves()`/`move()` to disable it). chess.js DOES already contain the machinery
 * though: `_moves({ legal: false })` generates pseudo-legal moves (every normal piece-movement
 * pattern, just without the final "does this leave my king exposed" filter), and `_makeMove`
 * applies a move directly without re-validating legality at all. Both are prefixed with `_`
 * (undocumented, absent from chess.js's own public .d.ts) rather than truly private — verified
 * against the pinned chess.js version via real test runs (position with an exposed king,
 * confirmed `_moves({legal:false})` includes a check-ignoring move, confirmed `_makeMove` applies
 * it and even a direct king capture cleanly). Isolated to these two methods below so a future
 * chess.js upgrade only has one place to fix if this shape ever changes. */
interface ChessInternals {
  _moves(options?: { legal?: boolean; square?: ChessJsSquare; piece?: string }): InternalMove[];
  _makeMove(move: InternalMove): void;
}

function toAppMove(pretty: ChessJsMove): Move {
  return {
    from: pretty.from,
    to: pretty.to,
    promotion: pretty.promotion as 'n' | 'b' | 'r' | 'q' | undefined,
    san: pretty.san,
    captured: pretty.captured as Move['captured'],
  };
}

/** Mirrors chess.js's own internal (unexported) `algebraic()` — converts a raw internal move's
 * 0x88 square index to algebraic notation directly, without constructing a full chess.js `Move`
 * wrapper just to read `.from`/`.to`. See `toAppMoveFromRaw` below for why this matters. */
function squareFromIndex(index: number): string {
  const file = index & 0xf;
  const rank = index >> 4;
  return `${FILES[file]}${'87654321'[rank]}`;
}

/** Builds a Move straight from chess.js's raw internal move shape — from/to/promotion/captured
 * are already plain fields on it, with no need for the full `ChessJsMove` wrapper. That wrapper's
 * constructor is surprisingly expensive: it eagerly computes `.san` via a full `_moveToSan` call
 * (itself a complete `_moves({legal:true})` regeneration, for disambiguation against every other
 * piece that could reach the same square) and two `.fen()` serializations (`.before`/`.after`,
 * the latter via an actual make+undo), none of which getPseudoLegalMoves' own callers ever read —
 * see its doc comment below. Measured directly (this session's own profiling): wrapping every
 * pseudo-legal candidate this way made a single call roughly 10x more expensive than chess.js's
 * own fully-validated `.move()`, worst for pieces with many reachable squares (queens, early
 * captures) — exactly the moves this variant's own board interaction (selecting a piece, seeing
 * its legal-move dots) does on every tap. `san` here is therefore never a real SAN — a clearly-
 * marked placeholder, safe only because nothing reads it (grep `getPseudoLegalMoves` before
 * changing that). */
function toAppMoveFromRaw(raw: InternalMove): Move {
  return {
    from: squareFromIndex(raw.from),
    to: squareFromIndex(raw.to),
    promotion: raw.promotion as 'n' | 'b' | 'r' | 'q' | undefined,
    san: '', // never read — see this function's own doc comment.
    captured: raw.captured as Move['captured'],
  };
}

export interface ChessEngineOptions {
  /**
   * When true, castling is resolved using Chess960 (Fischer Random) rules instead of
   * delegating to chess.js's built-in castling logic, which assumes the classical
   * e1/e8 king and a1/h1/a8/h8 rook starting squares and gets castling wrong (or misses
   * it entirely) for most Chess960 starting positions.
   */
  chess960?: boolean;
  /**
   * The FEN the game actually started from. Required in Chess960 mode to know which
   * files the king and rooks originally stood on (this doesn't change during the game,
   * unlike `fen`, which reflects the current position).
   */
  initialFen?: string;
  /**
   * Fog of War only — a redacted `fen` (see fogOfWar.ts) can legitimately be missing a king (the
   * player simply can't currently see where it is), which chess.js's own strict FEN validation
   * rejects by default ("Invalid FEN: missing king"). This is chess.js's own public, documented
   * escape hatch for exactly that — skips structural validation on load, nothing more. Every
   * other mode always loads a genuinely complete, valid position, so leaves this off (the
   * default) and keeps that validation as a real safety net.
   */
  skipValidation?: boolean;
}

export class ChessEngine {
  private chess: Chess;
  private chess960: boolean;
  private files: { kingFile: number; queenRookFile: number; kingRookFile: number };

  constructor(fen?: string, options?: ChessEngineOptions) {
    const skipValidation = options?.skipValidation ?? false;
    this.chess = fen ? new Chess(fen, { skipValidation }) : new Chess();
    this.chess960 = options?.chess960 ?? false;
    this.files = getChess960BackRankFiles(options?.initialFen ?? fen ?? START_FEN);
  }

  getBoard(): BoardSquare[][] {
    return this.chess.board().map((row, rowIndex) =>
      row.map((cell, colIndex) => ({
        square: `${String.fromCharCode(97 + colIndex)}${8 - rowIndex}`,
        piece: cell ? ({ type: cell.type, color: cell.color } as Piece) : null,
      }))
    );
  }

  getTurn(): 'w' | 'b' {
    return this.chess.turn();
  }

  getLegalMoves(square: string): string[] {
    const verboseMoves = this.chess.moves({ square: square as ChessJsSquare, verbose: true });

    if (!this.chess960) {
      return verboseMoves.map((move) => move.to);
    }

    // chess.js's own castling moves assume classical rook/king squares and are unreliable
    // here, so we drop them and compute Chess960-legal castling targets ourselves.
    const nonCastling = verboseMoves.filter((move) => !move.flags.includes('k') && !move.flags.includes('q'));
    const castlingTargets = this.getChess960CastlingTargetsFrom(square);
    return [...nonCastling.map((move) => move.to), ...castlingTargets];
  }

  move(from: string, to: string, promotion?: 'n' | 'b' | 'r' | 'q'): Move | null {
    if (this.chess960) {
      const side = this.matchChess960CastleAttempt(from, to);
      if (side) {
        return this.performChess960Castle(side);
      }
    }

    try {
      const result = this.chess.move({ from, to, promotion });
      if (!result) return null;
      // Use chess.js's own `promotion` (only set when the move actually promoted a pawn),
      // not the `promotion` parameter we passed in — ChessBoard always passes 'q' as a
      // just-in-case default even for non-promotion moves, and echoing that back verbatim
      // would tag every ordinary move as if it ended in a promotion. A real promotion is
      // always to n/b/r/q (chess.js's PieceSymbol type is just broader than that in practice).
      const actualPromotion = result.promotion as 'n' | 'b' | 'r' | 'q' | undefined;
      return {
        from: result.from,
        to: result.to,
        promotion: actualPromotion,
        san: result.san,
        captured: result.captured as Move['captured'],
      };
    } catch {
      return null;
    }
  }

  undo(): void {
    this.chess.undo();
  }

  reset(): void {
    this.chess.reset();
  }

  getStatus(): GameStatus {
    if (this.chess.isCheckmate()) return 'checkmate';
    if (this.chess.isStalemate()) return 'stalemate';
    if (this.chess.isDraw()) return 'draw';
    if (this.chess.isCheck()) return 'check';
    return 'playing';
  }

  isGameOver(): boolean {
    return this.chess.isGameOver();
  }

  getFen(): string {
    // forceEnpassantSquare: chess.js's own .fen() silently omits the ep-target field whenever
    // playing it would expose the capturing side's king (it simulates the capture and checks
    // king safety before deciding whether to print it) — but _moves({legal:false}), which
    // getPseudoLegalMoves/movePseudoLegal both use, does NOT apply that same check. Fog of War's
    // whole point is allowing king-exposing moves, so without this, an en passant capture could
    // show as a pseudo-legal dot (generated from the live, continuously-played `this.chess`) and
    // then fail the moment a caller reconstructs a fresh engine from this FEN string to execute
    // it (see ChessBoard's handleSquarePress) — the ep square silently isn't there to regenerate
    // from. Harmless outside Fog of War: .move()/.moves() always re-derive legality from live
    // internal state regardless of what the loaded FEN says, so forcing this never lets an
    // actually-illegal en passant capture through a normal game.
    return this.chess.fen({ forceEnpassantSquare: true });
  }

  getHistory(): string[] {
    return this.chess.history();
  }

  /** Total number of legal moves for the side to move in the current position — used as a
   * cheap "how complex is this position" proxy (e.g. for scaling bot thinking time). */
  getLegalMoveCount(): number {
    return this.chess.moves().length;
  }

  /** Whether `square` is attacked by any piece of `byColor` in the current position. */
  isSquareAttacked(square: string, byColor: PieceColor): boolean {
    return this.chess.isAttacked(square as ChessJsSquare, byColor);
  }

  /** The piece on `square`, or null if empty. */
  getPieceAt(square: string): Piece | null {
    const piece = this.chess.get(square as ChessJsSquare);
    return piece ? { type: piece.type, color: piece.color } : null;
  }

  // --- Fog of War (see ChessInternals above) -----------------------------

  /** Pseudo-legal moves for `color` (defaults to the side to move) — only used when actually
   * playing Fog of War (see fogOfWar.ts), for both "what can I actually play" (current turn) and
   * "what do my own pieces currently threaten" (visibility, any color, any time). For a color
   * other than the current turn, this runs generation against a throwaway same-position clone
   * with the turn field flipped, since chess.js's generator is always turn-bound — safe here
   * since it's pure move *generation*, nothing is mutated on the real position.
   *
   * Built via toAppMoveFromRaw, NOT a full chess.js Move wrapper per candidate — every caller
   * (ChessBoard's legalTargets, getVisibleSquares, the bot's own king-capture check) only ever
   * reads from/to/captured/promotion, never `.san` (see toAppMoveFromRaw's own doc comment for
   * the real cost that avoids — this is called on every piece selection and every visibility
   * recompute, i.e. constantly, so it's worth keeping cheap). */
  getPseudoLegalMoves(color?: PieceColor): Move[] {
    const turn = this.chess.turn();
    const source = !color || color === turn ? this.chess : this.cloneWithTurn(color);
    const internals = source as unknown as ChessInternals;
    return internals._moves({ legal: false }).map(toAppMoveFromRaw);
  }

  /** Applies `from`-`to` if it matches one of the CURRENT side's pseudo-legal moves (see
   * getPseudoLegalMoves) — i.e. a legal piece-movement pattern, with no check on whether it
   * leaves the mover's own king exposed, and no restriction against landing on the enemy king's
   * square (Fog of War's whole win condition). Returns null if nothing matches (illegal shape,
   * wrong turn, blocked path, etc.) — same contract as move(). Doesn't handle Chess960 castling —
   * Fog of War and Chess960 aren't combinable from the UI today. */
  movePseudoLegal(from: string, to: string, promotion?: 'n' | 'b' | 'r' | 'q'): Move | null {
    const internals = this.chess as unknown as ChessInternals;
    const candidates = internals._moves({ legal: false });
    // Compared directly off the raw move's own from/to/promotion (see toAppMoveFromRaw's doc
    // comment) — NOT by wrapping every scanned candidate in a chess.js Move first just to read
    // those three fields, which used to pay that wrapper's full san/fen-computing cost once per
    // candidate checked, not once total. The real (SAN-bearing) wrapper is still built exactly
    // once below, for the single candidate that actually matched.
    const raw = candidates.find(
      (m) => squareFromIndex(m.from) === from && squareFromIndex(m.to) === to && (!m.promotion || m.promotion === promotion)
    );
    if (!raw) return null;
    const pretty = new ChessJsMove(this.chess, raw);
    internals._makeMove(raw);
    return toAppMove(pretty);
  }

  private cloneWithTurn(color: PieceColor): Chess {
    const fields = this.chess.fen().split(' ');
    fields[1] = color;
    // skipValidation: see the backend's identical RoomChessEngine.cloneWithTurn for the full
    // rationale (and the crash this was discovered from) — the position being cloned can
    // legitimately be missing a king, either from a just-captured king or an already-redacted
    // fen, regardless of which color's moves are actually being asked for.
    return new Chess(fields.join(' '), { skipValidation: true });
  }

  // --- Chess960 castling ------------------------------------------------

  private getChess960CastlingTargetsFrom(square: string): string[] {
    const piece = this.chess.get(square as ChessJsSquare);
    if (!piece || piece.type !== 'k' || piece.color !== this.chess.turn()) return [];

    const rank = piece.color === 'w' ? '1' : '8';
    if (square !== `${FILES[this.files.kingFile]}${rank}`) return [];

    const targets: string[] = [];
    if (this.isChess960CastleLegal(piece.color, 'k')) targets.push(`${FILES[6]}${rank}`);
    if (this.isChess960CastleLegal(piece.color, 'q')) targets.push(`${FILES[2]}${rank}`);
    return targets;
  }

  private matchChess960CastleAttempt(from: string, to: string): 'k' | 'q' | null {
    const piece = this.chess.get(from as ChessJsSquare);
    if (!piece || piece.type !== 'k' || piece.color !== this.chess.turn()) return null;

    const rank = piece.color === 'w' ? '1' : '8';
    if (from !== `${FILES[this.files.kingFile]}${rank}`) return null;

    if (to === `${FILES[6]}${rank}` && this.isChess960CastleLegal(piece.color, 'k')) return 'k';
    if (to === `${FILES[2]}${rank}` && this.isChess960CastleLegal(piece.color, 'q')) return 'q';
    return null;
  }

  private isChess960CastleLegal(color: PieceColor, side: 'k' | 'q'): boolean {
    const castlingChar = side === 'k' ? (color === 'w' ? 'K' : 'k') : color === 'w' ? 'Q' : 'q';
    if (!this.chess.fen().split(' ')[2].includes(castlingChar)) return false;

    const rank = color === 'w' ? '1' : '8';
    const kingFile = this.files.kingFile;
    const rookFile = side === 'k' ? this.files.kingRookFile : this.files.queenRookFile;

    const kingFromSq = `${FILES[kingFile]}${rank}` as ChessJsSquare;
    const rookFromSq = `${FILES[rookFile]}${rank}` as ChessJsSquare;

    const kingPiece = this.chess.get(kingFromSq);
    const rookPiece = this.chess.get(rookFromSq);
    if (!kingPiece || kingPiece.type !== 'k' || kingPiece.color !== color) return false;
    if (!rookPiece || rookPiece.type !== 'r' || rookPiece.color !== color) return false;

    const kingToFile = side === 'k' ? 6 : 2;
    const rookToFile = side === 'k' ? 5 : 3;

    const mustBeEmpty = new Set<number>([...fileRange(kingFile, kingToFile), ...fileRange(rookFile, rookToFile)]);
    mustBeEmpty.delete(kingFile);
    mustBeEmpty.delete(rookFile);

    for (const file of mustBeEmpty) {
      if (this.chess.get(`${FILES[file]}${rank}` as ChessJsSquare)) return false;
    }

    const opponent: PieceColor = color === 'w' ? 'b' : 'w';
    for (const file of fileRange(kingFile, kingToFile)) {
      if (this.chess.isAttacked(`${FILES[file]}${rank}` as ChessJsSquare, opponent)) return false;
    }

    return true;
  }

  private performChess960Castle(side: 'k' | 'q'): Move | null {
    const color = this.chess.turn();
    if (!this.isChess960CastleLegal(color, side)) return null;

    const rank = color === 'w' ? '1' : '8';
    const rankIndex = color === 'w' ? 7 : 0;
    const kingFile = this.files.kingFile;
    const rookFile = side === 'k' ? this.files.kingRookFile : this.files.queenRookFile;
    const kingToFile = side === 'k' ? 6 : 2;
    const rookToFile = side === 'k' ? 5 : 3;

    const [placement, , castling, , halfmove, fullmove] = this.chess.fen().split(' ');
    const ranks = placement.split('/');
    const row = expandFenRank(ranks[rankIndex]);

    const kingChar = row[kingFile];
    const rookChar = row[rookFile];
    row[kingFile] = '.';
    row[rookFile] = '.';
    row[kingToFile] = kingChar;
    row[rookToFile] = rookChar;
    ranks[rankIndex] = collapseFenRank(row);

    const newCastling = (color === 'w' ? castling.replace(/[KQ]/g, '') : castling.replace(/[kq]/g, '')) || '-';
    const newTurn = color === 'w' ? 'b' : 'w';
    const newHalfmove = String(Number(halfmove) + 1);
    const newFullmove = color === 'b' ? String(Number(fullmove) + 1) : fullmove;

    const newFen = [ranks.join('/'), newTurn, newCastling, '-', newHalfmove, newFullmove].join(' ');
    this.chess.load(newFen);

    const from = `${FILES[kingFile]}${rank}`;
    const to = `${FILES[kingToFile]}${rank}`;
    const san = side === 'k' ? 'O-O' : 'O-O-O';
    return { from, to, san };
  }
}

function fileRange(a: number, b: number): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const out: number[] = [];
  for (let f = lo; f <= hi; f++) out.push(f);
  return out;
}
