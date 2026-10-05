import type { ChessEngine } from './ChessEngine';
import type { Move, Piece, PieceColor, SpellCast } from '../types/chess';

/**
 * Spell Chess rules, confirmed directly against chess.com's own Help Center (What is Spell Chess? /
 * How can I play Spell Chess?, both fetched and screenshotted 2026-10-04) rather than inferred from
 * third-party summaries:
 *
 *  - Two spells, Freeze and Jump. Each player starts with FREEZE_INITIAL_CHARGES freezes and
 *    JUMP_INITIAL_CHARGES jumps (5 and 2). Casting either costs one charge of that type and starts a
 *    SPELL_COOLDOWN_TURNS (3) "full turn" cooldown for that player on that spell — 3 of THEIR OWN turns
 *    must pass before it is castable again, tracked per player per spell (see SpellChessPlayerState).
 *  - A player may cast AT MOST ONE spell on their own turn, and only before making their move that turn.
 *  - Freeze: pick any center square; the 3x3 area around it (clipped to a 2x3/2x2 area at the edges —
 *    see getFreezeZoneSquares) becomes frozen. Officially: "Pieces within this area cannot move during
 *    your opponent's next turn." That is a ONE-PLY window on the turn immediately after the caster's own
 *    — never the caster's own current move, and never longer than that single reply. Also usable
 *    defensively: freezing every piece currently giving you check lets you escape check with ANY move
 *    this turn, since the attacker(s) are guaranteed harmless next turn regardless of what you do (see
 *    getCheckingPieceSquares / checkIsWaivedByFreeze).
 *  - Jump: pick any occupied square S (either color's piece). For the span starting now and lasting one
 *    full turn — the caster's own upcoming move AND the opponent's immediate reply, then it expires —
 *    any rook/bishop/queen of the side to move that is blocked ONLY by S along one of its lines may treat
 *    S as transparent and capture the first piece beyond it instead, including the enemy king outright
 *    (see getJumpAugmentedCaptures). Scope decision: jump only ever produces an extra CAPTURE on the far
 *    side of S — chess.com's own description ("capture a piece behind it") never mentions a quiet landing
 *    short of that, so this module doesn't generate one; it also only ever bypasses sliding pieces
 *    (rook/bishop/queen), since a knight/king/pawn's own movement is never blocked by a single square the
 *    way a slider's is, so "jumping" one has no meaning for them.
 *  - Win conditions are additive, not replacing normal chess: checkmate/stalemate/draw all still apply
 *    exactly as chess.js computes them, PLUS capturing the enemy king outright (via a Jump-augmented
 *    move) ends the game immediately, mirroring getDuckChessWinner/getFogOfWarWinner's own shape.
 *
 * Mutually exclusive with every other variant (chess960, Fog of War, Giveaway, Atomic, Duck Chess, Setup
 * Chess). Spell state (charges/cooldowns/pending freeze+jump) is NOT part of the FEN — exactly like Duck
 * Chess's duckSquare, it travels alongside the position (SpellChessState carried per ply in
 * GameHistoryEntry.spellState; the move that caused it is described by Move.spell) and is mirrored
 * VERBATIM in the backend's src/game/spellChess.ts (scripts/test-spell.mjs fails if the two differ).
 */

// --- Shared rules block (mirrored VERBATIM in backend/src/game/spellChess.ts; scripts/test-spell.mjs fails if the
// two copies differ -- edit both together) --------------------------------------------------------------------

export const FREEZE_INITIAL_CHARGES = 5;
export const JUMP_INITIAL_CHARGES = 2;
export const SPELL_COOLDOWN_TURNS = 3;

const FILES = 'abcdefgh';
const fileOf = (square: string) => square.charCodeAt(0) - 97;
const rankOf = (square: string) => Number(square[1]) - 1;
const inBounds = (file: number, rank: number) => file >= 0 && file <= 7 && rank >= 0 && rank <= 7;
const nameOf = (file: number, rank: number) => `${FILES[file]}${rank + 1}`;

export interface SpellCharges {
  freeze: number;
  jump: number;
}

export interface SpellCooldowns {
  /** Turns of that player's own remaining before Freeze/Jump is castable again; 0 = ready now. */
  freeze: number;
  jump: number;
}

export interface SpellChessPlayerState {
  charges: SpellCharges;
  cooldowns: SpellCooldowns;
}

export interface PendingFreeze {
  squares: string[];
  /** Whose upcoming move this immobilizes — always the color opposite whoever cast it. Consumed (and
   * cleared) the instant that color's next move is played, win or not. */
  restricts: PieceColor;
}

export interface PendingJump {
  square: string;
  /** Plies left including the one about to be played; starts at 2 (caster's own move, then the
   * opponent's reply) and is decremented by exactly one every time ANY move is played while set. */
  pliesLeft: 1 | 2;
}

export interface SpellChessState {
  w: SpellChessPlayerState;
  b: SpellChessPlayerState;
  pendingFreeze: PendingFreeze | null;
  pendingJump: PendingJump | null;
}

function freshPlayerState(): SpellChessPlayerState {
  return { charges: { freeze: FREEZE_INITIAL_CHARGES, jump: JUMP_INITIAL_CHARGES }, cooldowns: { freeze: 0, jump: 0 } };
}

export function initialSpellChessState(): SpellChessState {
  return { w: freshPlayerState(), b: freshPlayerState(), pendingFreeze: null, pendingJump: null };
}

/** The 3x3 area centered on `center`, clipped to the board (a 2x3/2x2 area at an edge/corner — chess.com's
 * own wording: "You can place the freeze area anywhere on the board, including edges, creating a 2x3 or
 * 2x2 freeze zone"). */
export function getFreezeZoneSquares(center: string): string[] {
  const cf = fileOf(center);
  const cr = rankOf(center);
  const squares: string[] = [];
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      const f = cf + df;
      const r = cr + dr;
      if (inBounds(f, r)) squares.push(nameOf(f, r));
    }
  }
  return squares;
}

export function canCastFreeze(state: SpellChessState, color: PieceColor): boolean {
  const p = state[color];
  return p.charges.freeze > 0 && p.cooldowns.freeze === 0;
}

export function canCastJump(state: SpellChessState, color: PieceColor): boolean {
  const p = state[color];
  return p.charges.jump > 0 && p.cooldowns.jump === 0;
}

/** Whether `color` may cast ANY spell right now — false mid-turn once they've already cast one (callers
 * track that themselves per turn; this only reflects charges/cooldown). */
export function canCastAnySpell(state: SpellChessState, color: PieceColor): boolean {
  return canCastFreeze(state, color) || canCastJump(state, color);
}

const other = (color: PieceColor): PieceColor => (color === 'w' ? 'b' : 'w');

/** Casts Freeze for `color` around `center`. Illegal casts (no charge, on cooldown) are returned
 * unchanged — callers should guard with canCastFreeze first; this is a safety net, not the primary check. */
export function castFreeze(state: SpellChessState, color: PieceColor, center: string): SpellChessState {
  if (!canCastFreeze(state, color)) return state;
  const player = state[color];
  return {
    ...state,
    [color]: { charges: { ...player.charges, freeze: player.charges.freeze - 1 }, cooldowns: { ...player.cooldowns, freeze: SPELL_COOLDOWN_TURNS } },
    pendingFreeze: { squares: getFreezeZoneSquares(center), restricts: other(color) },
  };
}

/** Casts Jump for `color` targeting `square` (must be occupied — callers should check via getPieceAt
 * before offering it; an empty square just never matches anything in getJumpAugmentedCaptures). */
export function castJump(state: SpellChessState, color: PieceColor, square: string): SpellChessState {
  if (!canCastJump(state, color)) return state;
  const player = state[color];
  return {
    ...state,
    [color]: { charges: { ...player.charges, jump: player.charges.jump - 1 }, cooldowns: { ...player.cooldowns, jump: SPELL_COOLDOWN_TURNS } },
    pendingJump: { square, pliesLeft: 2 },
  };
}

/** Advances cooldowns and expires pending effects after `mover` has just played their move (whether or
 * not they cast a spell this turn). Call exactly once per ply, after the move is applied. */
export function afterSpellChessMove(state: SpellChessState, mover: PieceColor): SpellChessState {
  const player = state[mover];
  const next: SpellChessState = {
    ...state,
    [mover]: {
      charges: player.charges,
      cooldowns: { freeze: Math.max(0, player.cooldowns.freeze - 1), jump: Math.max(0, player.cooldowns.jump - 1) },
    },
  };
  if (next.pendingFreeze && next.pendingFreeze.restricts === mover) next.pendingFreeze = null;
  if (next.pendingJump) {
    next.pendingJump = next.pendingJump.pliesLeft <= 1 ? null : { square: next.pendingJump.square, pliesLeft: 1 };
  }
  return next;
}

/** Squares immobile for `color`'s move right now — empty unless a freeze was cast against them last turn. */
export function frozenSquaresFor(state: SpellChessState, color: PieceColor): string[] {
  return state.pendingFreeze && state.pendingFreeze.restricts === color ? state.pendingFreeze.squares : [];
}

/** The one square currently "jumpable" (either side may exploit it while it's their turn), or null. */
export function activeJumpSquare(state: SpellChessState): string | null {
  return state.pendingJump?.square ?? null;
}

// --- End of the shared rules block --------------------------------------------------------------------------------

type SlidingType = 'r' | 'b' | 'q';
const isSliding = (type: string): type is SlidingType => type === 'r' || type === 'b' || type === 'q';
const ORTHOGONAL_TYPES: SlidingType[] = ['r', 'q'];
const DIAGONAL_TYPES: SlidingType[] = ['b', 'q'];
const DIRECTIONS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Walks from `square` in direction (df, dr), returning the first occupied square found (with its
 * piece), or null if the edge of the board is reached with nothing on it. */
function firstPieceInDirection(engine: ChessEngine, square: string, df: number, dr: number): { square: string; piece: Piece } | null {
  let f = fileOf(square) + df;
  let r = rankOf(square) + dr;
  while (inBounds(f, r)) {
    const sq = nameOf(f, r);
    const piece = engine.getPieceAt(sq);
    if (piece) return { square: sq, piece };
    f += df;
    r += dr;
  }
  return null;
}

/**
 * Every extra capture a Jump on `jumpSquare` currently enables for `mover` — see this module's own doc
 * comment for the exact rule. Recomputed fresh from the live board every time (never cached across
 * moves): if the piece that was on `jumpSquare` at cast time has since moved away, this simply returns
 * no candidates for that direction, which is correct — the window still "exists" but nothing is left to
 * jump over.
 */
export function getJumpAugmentedCaptures(engine: ChessEngine, jumpSquare: string, mover: PieceColor): Move[] {
  if (!engine.getPieceAt(jumpSquare)) return [];
  const out: Move[] = [];
  for (const [df, dr] of DIRECTIONS) {
    const near = firstPieceInDirection(engine, jumpSquare, -df, -dr);
    if (!near || near.piece.color !== mover || !isSliding(near.piece.type)) continue;
    const allowedTypes = df !== 0 && dr !== 0 ? DIAGONAL_TYPES : ORTHOGONAL_TYPES;
    if (!(allowedTypes as string[]).includes(near.piece.type)) continue;
    const far = firstPieceInDirection(engine, jumpSquare, df, dr);
    if (!far || far.piece.color === mover) continue;
    out.push({ from: near.square, to: far.square, san: '', captured: far.piece.type });
  }
  return out;
}

/** The squares of every enemy piece currently giving `kingColor`'s king check — empty if not in check.
 * Needed because chess.js only exposes a yes/no isCheck(), never which piece(s). */
export function getCheckingPieceSquares(engine: ChessEngine, kingColor: PieceColor): string[] {
  let kingSquare: string | null = null;
  for (const row of engine.getBoard()) {
    for (const sq of row) {
      if (sq.piece?.type === 'k' && sq.piece.color === kingColor) kingSquare = sq.square;
    }
  }
  if (!kingSquare) return [];
  const attacker = kingColor === 'w' ? 'b' : 'w';
  return engine.getPseudoLegalMoves(attacker).filter((m) => m.to === kingSquare).map((m) => m.from);
}

/** True when `color` is in check right now AND every single checking piece sits inside a freeze zone
 * `color` is about to cast (or just cast) THIS turn — chess.com's documented defensive use ("temporarily
 * escape check by freezing the attacking piece"). When true, the usual "a move must resolve check" rule
 * is waived for this one move: the frozen attacker(s) are guaranteed unable to capture the king on the
 * very next turn regardless of what the player does now, so leaving the king nominally "in check" from
 * them is safe. Scope decision: while waived, this move is treated the same way Fog of War/Duck
 * Chess/Giveaway already treat every move (no king-safety filtering at all) rather than re-deriving a
 * narrower "safe from the frozen piece(s) only" filter — simplest correct behaviour for the common
 * single-attacker case, documented here rather than silently assumed.
 */
export function checkIsWaivedByFreeze(engine: ChessEngine, color: PieceColor, freezeZone: string[]): boolean {
  if (freezeZone.length === 0) return false;
  const checkers = getCheckingPieceSquares(engine, color);
  return checkers.length > 0 && checkers.every((sq) => freezeZone.includes(sq));
}

/** Spell Chess's one additional, non-exclusive win condition — capturing the enemy king outright via a
 * Jump-augmented move (checkmate/stalemate/draw all still apply as normal on top of this; see this
 * module's own doc comment). `mover` is whoever just moved. */
export function getSpellChessWinner(move: Move | null, mover: PieceColor): PieceColor | null {
  return move?.captured === 'k' ? mover : null;
}

/** A move as shown in the move list: standard SAN, with the cast (if any) prefixed — "F@e4 Nf3",
 * "J@d5 Rxd8". No prefix when nothing was cast that turn. */
export function spellMoveNotation(move: Pick<Move, 'san'>, cast: SpellCast | null | undefined): string {
  if (!cast) return move.san;
  const tag = cast.type === 'freeze' ? `F@${cast.center}` : `J@${cast.square}`;
  return `${tag} ${move.san}`;
}
