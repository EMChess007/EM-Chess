import type { Move, PieceColor, PieceType } from '../types/chess';
import type { ChessEngine } from './ChessEngine';

/**
 * Crazyhouse, per chess.com's own documentation (support.chess.com/en/articles/8614995, chess.com/article/view/crazyhouse-chess):
 *
 *  - A captured piece changes colour and goes into the CAPTURER's reserve ("bank"). On your turn you do ONE thing: make an
 *    ordinary move, or DROP a reserve piece on any empty square. Pawns may not be dropped on the 1st or 8th rank.
 *  - A PROMOTED piece that is captured goes into the reserve as a PAWN, not as the piece it had become.
 *  - Drops may give check and may deliver checkmate (no shogi-style "no pawn-drop mate"), and a drop may block a check.
 *  - There is no new way to win: checkmate, stalemate and the clock decide the game, as in standard chess. What changes is
 *    that a side is only checkmated/stalemated if it also has NO legal drop (a drop can interpose and refute "mate").
 *  - Notation: "N@f3" (a "+"/"#" suffix as usual) — the same "@" convention Duck Chess uses for the duck.
 *
 * HOW LITTLE IS CUSTOM (compare Atomic): chess.js stays authoritative for every ordinary move — its legality, castling,
 * en passant, promotion and check detection are all used as they are. This module adds only
 *  1. the reserve and the "which pieces on the board are promoted" bookkeeping (the CrazyhouseState below),
 *  2. which squares a drop may legally use, and
 *  3. a drop applied as a move.
 *
 * STATE THAT IS NOT IN THE FEN. Like Duck Chess's duckSquare, the reserve cannot live in a standard FEN, and neither can
 * "this queen is really a promoted pawn" (other implementations bolt a "~" onto the piece letter, "Q~", which chess.js cannot
 * parse). So a CrazyhouseState travels BESIDE the position: ChessEngine takes it as an option, updates it itself on every
 * move()/drop() (getCrazyhouseState() returns the result), every Move that changes it carries the state AFTER that ply in
 * `move.crazyhouse`, and the screens store that in GameHistoryEntry.crazyhouse — one entry per ply, so Undo, position review
 * and analysis restore reserves and promotions for free, exactly as duckSquare does.
 *
 * PROMOTED-PIECE TRACKING — the one genuinely new piece of machinery. `promoted` is the set of SQUARES currently holding a
 * piece that started as a pawn (never a pawn, never a king). It is updated by applyCrazyhouseMove, once per move:
 *   - a pawn promoting lands on its target square: that square joins the set;
 *   - a piece MOVING away from a promoted square takes its status with it (the old square leaves, the new one joins);
 *   - a piece CAPTURED on a promoted square leaves the set and feeds the reserve a PAWN; any other capture feeds the type;
 *   - castling carries a (promoted) rook along; en passant captures a pawn on a DIFFERENT square than the landing one.
 * Dropped pieces are never promoted. Because it is positional state, it must be copied with the reserve everywhere — a
 * promoted queen captured, dropped as a pawn, promoted again and captured again is a normal sequence of the five rules above.
 *
 * DROP LEGALITY needs no search: placing a piece can never expose your own king (it only ever adds a blocker). So a drop is
 * legal on any empty square when you are not in check; when you are in check by exactly one SLIDING piece only the squares
 * between it and your king work; against a knight/pawn check or a double check no drop is legal at all.
 *
 * ENGINE DETAILS (ChessEngine's `crazyhouse` option): a drop is applied by editing the FEN (piece placed, turn flipped, en
 * passant cleared, halfmove clock reset, fullmove advanced) and reloading chess.js. Castling rights are FLAGS in the FEN,
 * so a rook re-dropped on h1 after the original was captured does NOT restore them; a dropped pawn is never "just
 * double-stepped", so en passant never interacts with a drop. chess.js's own isDraw() is NOT trusted (it calls king-versus-king
 * a draw, but a reserve can still be dropped), and its checkmate/stalemate are only right when the side has no drops.
 *
 * Mutually exclusive with every other variant.
 */

// --- Shared rules block (mirrored VERBATIM in backend/src/game/crazyhouse.ts; scripts/test-crazyhouse.mjs fails if the
// two copies differ -- edit both together) ------------------------------------------------------------------------

export type ReservePieceType = 'p' | 'n' | 'b' | 'r' | 'q';
export const RESERVE_PIECE_TYPES: ReservePieceType[] = ['p', 'n', 'b', 'r', 'q'];

export type Reserve = Record<ReservePieceType, number>;

export interface CrazyhouseState {
  reserve: { w: Reserve; b: Reserve };
  /** Squares currently holding a promoted piece (never a pawn or king) — see the header comment. */
  promoted: string[];
}

export interface CrazyhouseDrop {
  piece: ReservePieceType;
  square: string;
}

const CZ_FILES = 'abcdefgh';
const czFile = (square: string) => square.charCodeAt(0) - 97;
const czRank = (square: string) => Number(square[1]) - 1;
const czInBounds = (file: number, rank: number) => file >= 0 && file <= 7 && rank >= 0 && rank <= 7;
const czName = (file: number, rank: number) => `${CZ_FILES[file]}${rank + 1}`;
const czOther = (color: PieceColor): PieceColor => (color === 'w' ? 'b' : 'w');

export function emptyReserve(): Reserve {
  return { p: 0, n: 0, b: 0, r: 0, q: 0 };
}

export function initialCrazyhouseState(): CrazyhouseState {
  return { reserve: { w: emptyReserve(), b: emptyReserve() }, promoted: [] };
}

export function cloneCrazyhouseState(state: CrazyhouseState): CrazyhouseState {
  return { reserve: { w: { ...state.reserve.w }, b: { ...state.reserve.b } }, promoted: [...state.promoted] };
}

export function reserveTotal(reserve: Reserve): number {
  return reserve.p + reserve.n + reserve.b + reserve.r + reserve.q;
}

/** A square on the board, as the helpers below see it — just enough to find checks without a chess engine. */
export type CrazyhousePieceAt = (square: string) => { type: string; color: PieceColor } | null | undefined;

const KNIGHT_STEPS: [number, number][] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const ORTHOGONAL_STEPS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAGONAL_STEPS: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Who is giving `color`'s king check on `kingSquare`: how many pieces, and — for exactly one SLIDING checker — the empty
 * squares between it and the king (where a drop could block). Knights, pawns and an adjacent king cannot be blocked. */
export function crazyhouseCheckInfo(kingSquare: string, color: PieceColor, pieceAt: CrazyhousePieceAt): { checkers: number; blockSquares: string[] } {
  const enemy = czOther(color);
  const kf = czFile(kingSquare);
  const kr = czRank(kingSquare);
  let checkers = 0;
  let blockSquares: string[] = [];
  const scan = (steps: [number, number][], sliders: string[]) => {
    for (const [df, dr] of steps) {
      const between: string[] = [];
      let f = kf + df;
      let r = kr + dr;
      while (czInBounds(f, r)) {
        const sq = czName(f, r);
        const piece = pieceAt(sq);
        if (piece) {
          if (piece.color === enemy && sliders.includes(piece.type)) {
            checkers++;
            blockSquares = between;
          }
          break;
        }
        between.push(sq);
        f += df;
        r += dr;
      }
    }
  };
  scan(ORTHOGONAL_STEPS, ['r', 'q']);
  scan(DIAGONAL_STEPS, ['b', 'q']);
  for (const [df, dr] of KNIGHT_STEPS) {
    const f = kf + df;
    const r = kr + dr;
    if (!czInBounds(f, r)) continue;
    const piece = pieceAt(czName(f, r));
    if (piece && piece.color === enemy && piece.type === 'n') {
      checkers++;
      blockSquares = [];
    }
  }
  // Pawns attack toward the king from the side they advance from: Black pawns sit one rank ABOVE a White king.
  const pawnRank = color === 'w' ? kr + 1 : kr - 1;
  for (const df of [-1, 1]) {
    const f = kf + df;
    if (!czInBounds(f, pawnRank)) continue;
    const piece = pieceAt(czName(f, pawnRank));
    if (piece && piece.color === enemy && piece.type === 'p') {
      checkers++;
      blockSquares = [];
    }
  }
  // A king can never give check, and the one non-slider/slider mix above is covered by the count.
  return { checkers, blockSquares: checkers === 1 ? blockSquares : [] };
}

/** Every square `color` may drop a `piece` on: empty; not the 1st/8th rank for a pawn; and — if `color`'s king is in
 * check — only a square that blocks a single sliding check. Returns [] when the reserve has none of that piece. */
export function legalDropSquares(state: CrazyhouseState, color: PieceColor, piece: ReservePieceType, pieceAt: CrazyhousePieceAt): string[] {
  if (!(state.reserve[color][piece] > 0)) return []; // also refuses a piece type the reserve has no slot for ("k", junk)
  let kingSquare: string | null = null;
  const empties: string[] = [];
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const sq = czName(file, rank);
      const occupant = pieceAt(sq);
      if (!occupant) {
        if (piece === 'p' && (rank === 0 || rank === 7)) continue;
        empties.push(sq);
      } else if (occupant.type === 'k' && occupant.color === color) {
        kingSquare = sq;
      }
    }
  }
  if (!kingSquare) return empties;
  const { checkers, blockSquares } = crazyhouseCheckInfo(kingSquare, color, pieceAt);
  if (checkers === 0) return empties;
  const blocking = new Set(blockSquares);
  return checkers === 1 ? empties.filter((sq) => blocking.has(sq)) : [];
}

/** Every legal drop for `color` (each reserve type × each legal square). */
export function legalDrops(state: CrazyhouseState, color: PieceColor, pieceAt: CrazyhousePieceAt): CrazyhouseDrop[] {
  const drops: CrazyhouseDrop[] = [];
  for (const piece of RESERVE_PIECE_TYPES) {
    for (const square of legalDropSquares(state, color, piece, pieceAt)) drops.push({ piece, square });
  }
  return drops;
}

/** What one ordinary move did, as far as the reserve and the promoted set care. */
export interface CrazyhouseMoveInfo {
  from: string;
  to: string;
  /** Set when a pawn promoted on this move. */
  promotion?: string;
  /** The type of the piece captured (a promoted piece reports its board type, e.g. 'q'). */
  captured?: string;
  /** True for an en passant capture: the captured pawn stands beside `from`, not on `to`. */
  enPassant?: boolean;
  /** Castling: the rook's own move. */
  castleRook?: { from: string; to: string };
}

/** The state after `mover` plays an ordinary move — see the header comment's five rules. Returns a new object. */
export function applyCrazyhouseMove(state: CrazyhouseState, mover: PieceColor, move: CrazyhouseMoveInfo): CrazyhouseState {
  const next = cloneCrazyhouseState(state);
  let promoted = new Set(next.promoted);
  const wasPromoted = promoted.has(move.from);
  promoted.delete(move.from);

  if (move.captured) {
    const capturedSquare = move.enPassant ? `${move.to[0]}${move.from[1]}` : move.to;
    // A captured promoted piece goes into the reserve as a PAWN.
    const type = (promoted.has(capturedSquare) ? 'p' : move.captured) as ReservePieceType;
    promoted.delete(capturedSquare);
    if (RESERVE_PIECE_TYPES.includes(type)) next.reserve[mover][type]++;
  }

  if (move.promotion || wasPromoted) promoted.add(move.to);

  if (move.castleRook && promoted.has(move.castleRook.from)) {
    promoted.delete(move.castleRook.from);
    promoted.add(move.castleRook.to);
  }
  next.promoted = [...promoted].sort();
  return next;
}

/** The state after `color` drops a `piece` — one fewer in the reserve; a dropped piece is never promoted. */
export function applyCrazyhouseDrop(state: CrazyhouseState, color: PieceColor, piece: ReservePieceType): CrazyhouseState {
  const next = cloneCrazyhouseState(state);
  if (next.reserve[color][piece] > 0) next.reserve[color][piece]--;
  next.promoted = [...next.promoted].sort();
  return next;
}

/** "N@f3" (pawn: "@f3"... written "P@f3" like the other piece letters, so a drop is never mistaken for a move). */
export function crazyhouseDropSan(piece: ReservePieceType, square: string, suffix: '' | '+' | '#' = ''): string {
  return `${piece.toUpperCase()}@${square}${suffix}`;
}

// --- End of the shared rules block --------------------------------------------------------------------------------

const PROMOTION_PIECES: ('q' | 'r' | 'b' | 'n')[] = ['q', 'r', 'b', 'n'];

/** Every legal ORDINARY move for the side to move (drops are separate: engine.getLegalDrops()), optionally only those starting on
 * `square`, with every promotion choice expanded. Moves carry no SAN (nothing has been played); `captured` is filled in, including
 * the pawn taken en passant. Built from the engine's own getLegalMoves, so it is exactly what the board offers. */
export function getCrazyhouseMoves(engine: ChessEngine, square?: string): Move[] {
  const turn = engine.getTurn();
  const moves: Move[] = [];
  const squares = square ? [square] : engine.getBoard().flat().filter((s) => s.piece?.color === turn).map((s) => s.square);
  for (const from of squares) {
    const piece = engine.getPieceAt(from);
    if (!piece || piece.color !== turn) continue;
    // A set: chess.js lists a promotion target once per promotion piece, and the choices are expanded below.
    for (const to of new Set(engine.getLegalMoves(from))) {
      const target = engine.getPieceAt(to);
      const enPassant = piece.type === 'p' && !target && from[0] !== to[0];
      const captured: PieceType | undefined = target ? target.type : enPassant ? 'p' : undefined;
      const lastRank = (turn === 'w' && to[1] === '8') || (turn === 'b' && to[1] === '1');
      if (piece.type === 'p' && lastRank) {
        for (const promotion of PROMOTION_PIECES) moves.push({ from, to, promotion, san: '', captured });
      } else {
        moves.push({ from, to, san: '', captured });
      }
    }
  }
  return moves;
}
