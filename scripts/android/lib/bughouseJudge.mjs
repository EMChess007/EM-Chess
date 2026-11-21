/**
 * A JUDGED BUGHOUSE GAME IS JUDGED BEFORE IT CAN MOVE (command #67e). PR #51 head f84902c, job 136874638663 "emulator (small-screens-1)": "14 days" was tapped at 14:40:30 and the pieces
 * were read 51 s later - the time-control tap's wait for a settled tree never ends on a screen where bots keep playing - and by then board B's bots had mated (move 44,
 * "6nr/p5k1/5p2/p1b2K1p/3nPP1P/3r4/8/8"): the result card was on the screen. A longer clock cannot help while bots play on their own.
 *
 * Which seats are human decides the LAYOUT (src/logic/bughouseLayout.ts `deriveBughouseLayout`): the thumbnail layout ("single") needs exactly one human and pass and play needs every
 * human on one board, so those two screens cannot be all-human (four humans is the dual screen). So: the dual screen is all-human (nothing moves until the harness moves), and on every
 * judged screen the board whose WHITE seat is human waits for the harness - it must report the start position when it is judged, otherwise "game moved before judging". A board played
 * by bots only (board B of single and pass and play) is judged from the cells that stood still across the photograph (stableCells), read seconds after the board appeared.
 * Pure (fens in, verdict out) so tests can pin it.
 */

/** The judged screens and the seats their preset makes human (0 = Board A White, 1 = A Black, 2 = B White, 3 = B Black; the setup's presets, bughouseLayout.ts BUGHOUSE_SETUP_PRESETS). */
export const JUDGED_BUGHOUSE_SCREENS = Object.freeze({
  'bughouse-game-single': Object.freeze({ preset: 'solo', humans: Object.freeze([0]) }),
  'bughouse-game-passplay': Object.freeze({ preset: 'opponents', humans: Object.freeze([0, 1]) }),
  'bughouse-game-dual': Object.freeze({ preset: 'four', humans: Object.freeze([0, 1, 2, 3]) }),
});

const WHITE_SEAT = { A: 0, B: 2 };
const BLACK_SEAT = { A: 1, B: 3 };
export const START_PLACEMENT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';

/** The board's seats that a bot plays. */
export function botSeatsOf(humans) {
  return [0, 1, 2, 3].filter((s) => !humans.includes(s));
}

/** Nothing moves on a board until the harness does when White there is human (White moves first; a bot Black only answers). */
export function boardWaitsForHumans(humans, board) {
  return humans.includes(WHITE_SEAT[board]);
}

/** Is the board played by bots only (it moves on its own from the first second)? */
export function boardIsBotsOnly(humans, board) {
  return !humans.includes(WHITE_SEAT[board]) && !humans.includes(BLACK_SEAT[board]);
}

/** Half-moves played in a FEN ((fullmove - 1) * 2, + 1 when Black is to move), or null for an unreadable FEN. */
export function plyOfFen(fen) {
  if (typeof fen !== 'string') return null;
  const parts = fen.trim().split(/\s+/);
  const side = parts[1];
  const full = Number(parts[5] ?? '1');
  if ((side !== 'w' && side !== 'b') || !Number.isInteger(full) || full < 1) return null;
  return (full - 1) * 2 + (side === 'b' ? 1 : 0);
}

/** The start position: the standard placement (a Bughouse pocket suffix "[...]" is ignored), White to move, no move played. */
export function isStartFen(fen) {
  if (typeof fen !== 'string') return false;
  const placement = fen.trim().split(/\s+/)[0].replace(/\[.*\]$/, '');
  return placement === START_PLACEMENT && plyOfFen(fen) === 0;
}

/**
 * The verdict on the boards' first reports. `fens` = { A, B } (the beacon's FEN per board, null when a board reported nothing).
 * @returns {{ issues: string[], notes: string[], boards: { board: 'A' | 'B', waits: boolean, botsOnly: boolean, atStart: boolean, ply: number | null }[] }}
 */
export function bughouseStartVerdict({ screenId, fens }) {
  const judged = JUDGED_BUGHOUSE_SCREENS[screenId];
  if (!judged) throw new RangeError(`not a judged Bughouse screen: ${screenId}`);
  const issues = [];
  const notes = [];
  const boards = ['A', 'B'].map((board) => {
    const fen = fens?.[board] ?? null;
    const waits = boardWaitsForHumans(judged.humans, board);
    const botsOnly = boardIsBotsOnly(judged.humans, board);
    const atStart = isStartFen(fen);
    const ply = plyOfFen(fen);
    if (waits && fen === null) issues.push(`board ${board} reported no position after the game started`);
    else if (waits && !atStart) issues.push(`game moved before judging: board ${board} reports ply ${ply ?? '?'} ("${fen}"), not the start position - nothing moves there before the harness does`);
    else if (botsOnly && fen !== null && !atStart) notes.push(`board ${board} is played by bots only (ply ${ply ?? '?'} at its first report): its pieces are judged from the cells that stood still across the photograph`);
    return { board, waits, botsOnly, atStart, ply };
  });
  return { issues, notes, boards };
}
