/**
 * Bughouse W3a: what the Local screens SHOW and ALLOW, derived from the engine's match and the seat config - orientation, who may touch, the squares a dropped piece may go to, the pocket
 * chips, the status line, the king badges and the game-over summary. Pure, and everything that comes from the rules is read from the engine (`legalDropsOn`, `verdicts`, `result`),
 * never recomputed here. THE BOARD (or a seat, which names its board) IS A REQUIRED ARGUMENT of every function that names a square, a pocket or a clock (HP9;
 * `bughouseUiBoardArgument.test.ts` scans this file).
 */
import { RESERVE_PIECE_TYPES, type ReservePieceType } from './crazyhouse';
import { legalDropsOn, openBoard, pocketOfSeat, type BughouseMatch, type BoardVerdict } from './bughouse';
import { seatAt, seatPlace, type BoardId, type BughouseColor, type BughouseSeat, type BughouseTeam } from './bughouse/types';
import { bughouseTeamShape, deriveBughouseLayout, dualBoardPlan, humanBughouseSeats, type BughouseLayout } from './bughouseLayout';
import type { SeatConfig } from './fourPlayer/setup';

const otherColor = (color: BughouseColor): BughouseColor => (color === 'w' ? 'b' : 'w');

// --- Orientation (S-U3): each board is shown from its player's side ---------------------------------------------------------------------------

/**
 * The colour at the BOTTOM of `board`.
 *  - standard (one human): the human's own board shows the human's colour; the partner's board shows the PARTNER's colour (the other one), S-U3;
 *  - pass-and-play: the shared board turns to the side to move (`autoFlip` off keeps White at the bottom); the other board shows the partner of the side to move;
 *  - no human / dual: White.
 */
export function boardOrientation(layout: BughouseLayout, board: BoardId, match: BughouseMatch, autoFlip: boolean): BughouseColor {
  if (layout.kind === 'standard') {
    const mine = seatPlace(layout.seat);
    return board === mine.board ? mine.color : otherColor(mine.color);
  }
  if (layout.kind === 'passAndPlay') {
    if (!autoFlip) return 'w';
    const shownTurn = match.verdicts[layout.board].turn;
    return board === layout.board ? shownTurn : otherColor(shownTurn);
  }
  return 'w';
}

/**
 * The colour at the BOTTOM of `board` when humans play both boards (W3b): the colour of the human who plays it; a board whose two colours are both human follows the pass-and-play
 * rule (it turns to the side to move; `autoFlip` off keeps White at the bottom).
 */
export function dualBoardOrientation(config: SeatConfig, board: BoardId, match: BughouseMatch, autoFlip: boolean): BughouseColor {
  const plan = dualBoardPlan(config, board);
  if (plan.shared) return autoFlip ? match.verdicts[board].turn : 'w';
  return plan.humanColors[0];
}

/** The square on display cell (row, col) of `board` when `orientation` is at the bottom (row 0 is the top row as drawn). Board-qualified, like every cell of this game. */
export function boardCellToSquare(board: BoardId, orientation: BughouseColor, row: number, col: number): { board: BoardId; square: string } {
  const file = orientation === 'w' ? col : 7 - col;
  const rank = orientation === 'w' ? 8 - row : row + 1;
  return { board, square: `${'abcdefgh'[file]}${rank}` };
}

/** The display cell of `square` on `board` seen from `orientation` - the inverse of boardCellToSquare. */
export function boardSquareToCell(board: BoardId, orientation: BughouseColor, square: string): { board: BoardId; row: number; col: number } {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  return { board, row: orientation === 'w' ? 8 - rank : rank - 1, col: orientation === 'w' ? file : 7 - file };
}

// --- Who may touch ----------------------------------------------------------------------------------------------------------------------------

/** The human seat that may act on `board` right now, or null: only the side to move may touch, only when a human sits there, never after the end. */
export function touchSeat(config: SeatConfig, match: BughouseMatch, board: BoardId): BughouseSeat | null {
  if (match.result !== null) return null;
  const seat = seatAt(board, match.verdicts[board].turn);
  return config[seat].kind === 'human' ? seat : null;
}

/** Whether a seat is controlled by a bot on this device. */
export const isBotSeat = (config: SeatConfig, seat: BughouseSeat): boolean => config[seat].kind === 'bot';

/** The board that has the human focus at the start: the one human's board, the shared board of pass-and-play. */
export function mainBoardOf(layout: BughouseLayout): BoardId {
  if (layout.kind === 'standard') return seatPlace(layout.seat).board;
  if (layout.kind === 'passAndPlay') return layout.board;
  return 'A';
}

// --- Drops ------------------------------------------------------------------------------------------------------------------------------------

/** The squares `piece` may be dropped on by the side to move on `board` - straight from the engine, so a pawn is never offered on the 1st or 8th rank and a check is honoured. */
export function dropSquares(match: BughouseMatch, board: BoardId, piece: ReservePieceType): string[] {
  return legalDropsOn(match, board)
    .filter((option) => option.piece === piece)
    .map((option) => option.square);
}

export interface PocketChip {
  piece: ReservePieceType;
  count: number;
  /** The pocket holder may tap it now: they are the side to move, a human controls them and the piece has a legal square. */
  usable: boolean;
}

/** The chips of `seat`'s pocket (pieces it holds, queen first), with whether each can be tapped now. `actor` is the seat that may touch this board (touchSeat). */
export function pocketChips(match: BughouseMatch, seat: BughouseSeat, actor: BughouseSeat | null): PocketChip[] {
  const pocket = pocketOfSeat(match, seat);
  const board = seatPlace(seat).board;
  const droppable = actor === seat ? new Set(legalDropsOn(match, board).map((d) => d.piece)) : new Set<string>();
  return RESERVE_PIECE_TYPES.filter((piece) => pocket[piece] > 0)
    .slice()
    .reverse()
    .map((piece) => ({ piece, count: pocket[piece], usable: droppable.has(piece) }));
}

// --- Status -----------------------------------------------------------------------------------------------------------------------------------

export type BoardStatusKind = 'playing' | 'check' | 'stuck' | 'over';
export interface BoardStatusLine {
  kind: BoardStatusKind;
  text: string;
}

export const STUCK_TEXT = 'Waiting for a piece from your partner';
export const STUCK_CHECK_TEXT = 'In check - waiting for a piece from your partner to block it';

/**
 * The line under a board. A `stuck` side is NEVER shown as mate (B4 / B5): it is waiting. `you` says whether the viewer is the side to move ("your partner") or a bystander ("their partner").
 * Once the match is over the board says so; a mate is only ever shown for the verdict `checkmate`.
 */
export function boardStatusLine(match: BughouseMatch, board: BoardId, you: boolean): BoardStatusLine {
  const verdict: BoardVerdict = match.verdicts[board];
  if (match.result !== null) {
    return { kind: 'over', text: verdict.status === 'checkmate' ? 'Checkmate' : 'Game over' };
  }
  const colour = verdict.turn === 'w' ? 'White' : 'Black';
  if (verdict.status === 'stuck') {
    const inCheck = verdict.stuck === 'check';
    if (you) return { kind: 'stuck', text: inCheck ? STUCK_CHECK_TEXT : STUCK_TEXT };
    return { kind: 'stuck', text: inCheck ? `${colour} is in check - waiting for a piece from their partner to block it` : `${colour} is waiting for a piece from their partner` };
  }
  if (verdict.status === 'check') return { kind: 'check', text: you ? 'Check - your king is attacked' : `${colour} is in check` };
  return { kind: 'playing', text: `${colour} to move` };
}

/** The square of the king in check on `board` (the side to move), or null: highlights the check, including for a stuck side in check and for a mate. */
export function checkedKingSquare(match: BughouseMatch, board: BoardId): string | null {
  const verdict = match.verdicts[board];
  if (!verdict.inCheck) return null;
  const chess = openBoard(match.boards[board].fen);
  if (chess === null) return null;
  for (const row of chess.board()) for (const cell of row) if (cell && cell.type === 'k' && cell.color === verdict.turn) return cell.square;
  return null;
}

// --- Team badges (5.3) ------------------------------------------------------------------------------------------------------------------------

export interface KingBadge {
  team: BughouseTeam;
  shape: '◆' | '●';
  /** The suffix of the king cell's accessible label. */
  label: string;
}

/**
 * The badge on the king of `color` on `board`. One human: only that human's team is badged ("your team"); with two or more humans there is no single "me", so both teams are
 * badged on all four kings (diamond Team 1, circle Team 2).
 */
export function kingBadge(layout: BughouseLayout, board: BoardId, color: BughouseColor): KingBadge | null {
  const team = seatPlace(seatAt(board, color)).team;
  if (layout.kind === 'standard') {
    if (seatPlace(layout.seat).team !== team) return null;
    return { team, shape: bughouseTeamShape(team), label: 'your team' };
  }
  return { team, shape: bughouseTeamShape(team), label: `Team ${team}` };
}

// --- Clocks -----------------------------------------------------------------------------------------------------------------------------------

/** "3:00", "0:42", and tenths under ten seconds ("0:07.4"). Never negative. */
export function formatBughouseClock(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(clamped / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const base = `${minutes}:${String(seconds).padStart(2, '0')}`;
  return clamped < 10000 ? `${base}.${Math.floor((clamped % 1000) / 100)}` : base;
}

/** The two seats of `board`, top of the screen first: the side at the bottom is `orientation`. */
export function boardSeatsTopFirst(board: BoardId, orientation: BughouseColor): [BughouseSeat, BughouseSeat] {
  return [seatAt(board, otherColor(orientation)), seatAt(board, orientation)];
}

// --- Game over --------------------------------------------------------------------------------------------------------------------------------

export interface GameOverSummary {
  voided: boolean;
  winnerTeam: BughouseTeam | null;
  /** "Team 1 wins" / "No result". */
  headline: string;
  /** "Checkmate" / "Flag fell" / "Resigned" / "Abandoned". */
  reason: string;
  /** The deciding board, outlined on the result screen; null when voided. */
  decidingBoard: BoardId | null;
  loserSeat: BughouseSeat | null;
  /** "Board A - checkmate". */
  detail: string;
}

const REASON_TEXT = { checkmate: 'Checkmate', flag: 'Flag fell', resign: 'Resigned' } as const;

/** The result as the game-over card shows it, read from the engine's `result` (null while the match is on). */
export function gameOverSummary(match: BughouseMatch): GameOverSummary | null {
  const result = match.result;
  if (result === null) return null;
  if ('voided' in result) return { voided: true, winnerTeam: null, headline: 'No result', reason: 'Abandoned', decidingBoard: null, loserSeat: null, detail: 'Abandoned' };
  const reason = REASON_TEXT[result.reason];
  return {
    voided: false,
    winnerTeam: result.winnerTeam,
    headline: `Team ${result.winnerTeam} wins`,
    reason,
    decidingBoard: result.board,
    loserSeat: result.loserSeat,
    detail: `Board ${result.board} - ${reason.toLowerCase()}`,
  };
}

/** Whether the viewer (the one human, if any) is on the winning team; null for several humans or no result. */
export function viewerWon(config: SeatConfig, match: BughouseMatch): boolean | null {
  const summary = gameOverSummary(match);
  const humans = humanBughouseSeats(config);
  if (summary === null || summary.voided || humans.length !== 1) return null;
  return seatPlace(humans[0]).team === summary.winnerTeam;
}

/** Convenience for screens: the layout of a config. */
export const layoutOf = deriveBughouseLayout;
