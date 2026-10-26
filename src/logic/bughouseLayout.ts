/**
 * Bughouse W3a (BUGHOUSE_SPEC.md 5.6, B23): the Local setup's seat labels and presets, the layout that follows from where the humans sit, the cell sizes and the screen-size gate.
 * Pure: no React, no engine. Every function that names a cell size, a clock or a board takes the BOARD (or a seat, which names its board) as a required argument.
 *
 * THE SEAT MODEL IS THE 4-SEAT ONE (`SeatConfig` of fourPlayer/setup.ts: each seat Human or Bot with an ELO). The four seats are the Bughouse seat map of types.ts (0 = Board A White,
 * 1 = A Black, 2 = B White, 3 = B Black); the 4-seat helpers (`withController`, `humanSeats`, `isStartable`) work on it unchanged because they only index by 0..3.
 */
import { DEFAULT_BOT_ELO, type SeatConfig, type SeatController } from './fourPlayer/setup';
import type { BughouseTimeControl } from './bughouse/rules';
import { seatPlace, type BoardId, type BughouseSeat, type BughouseTeam } from './bughouse/types';

/** Shown on the setup screen (and as an overlay mid-game) when a seat setup with humans on both boards does not fit the window. The spec's wording, word for word. */
export const BUGHOUSE_SIZE_GATE_MESSAGE = 'This seat setup needs a larger screen. Turn the device to landscape, or put every human on one board.';
/** Shown in W3a for a setup that fits the window but needs the simultaneous-play input of W3b. */
export const BUGHOUSE_COMING_NEXT_MESSAGE = 'Playing on both boards at the same time on one device is coming next. For now put every human on one board, or play with one human.';
export const BUGHOUSE_NO_HUMAN_MESSAGE = 'At least one seat must be a human.';

/** The smallest cell (px) at which two boards played at the same time are tappable at speed (the Chaturaji minimum). */
export const BUGHOUSE_DUAL_MIN_CELL = 28;
/** The width from which a tie between the two arrangements goes to side by side (S-U3). */
export const BUGHOUSE_SIDE_BY_SIDE_MIN_WIDTH = 700;

/** The app's time-control presets that are Bughouse's six (B11: 1, 2 | 1, 3, 3 | 2, 5, 5 | 2 - 10 minutes is dropped, no Daily, no "No time limit"). */
export const BUGHOUSE_TIME_CONTROL_IDS: readonly string[] = ['bullet-1', 'bullet-2-1', 'blitz-3', 'blitz-3-2', 'blitz-5', 'blitz-5-2'];

/** A preset as the engine's integer-millisecond control. */
export function bughouseTimeControlOf(preset: { initialSeconds: number; incrementSeconds: number }): BughouseTimeControl {
  return { initialMs: preset.initialSeconds * 1000, incrementMs: preset.incrementSeconds * 1000 };
}

export interface SeatRowLabel {
  seat: BughouseSeat;
  board: BoardId;
  color: 'White' | 'Black';
  team: BughouseTeam;
  /** "Board A · White · Team 1" */
  text: string;
  /** Team 1 = a diamond, Team 2 = a circle: the shape carries the team without colour. */
  shape: '◆' | '●';
}

/** The four rows of the Local setup, in seat order. */
export function seatRowLabel(seat: BughouseSeat): SeatRowLabel {
  const place = seatPlace(seat);
  const color = place.color === 'w' ? 'White' : 'Black';
  return { seat, board: place.board, color, team: place.team, text: `Board ${place.board} · ${color} · Team ${place.team}`, shape: place.team === 1 ? '◆' : '●' };
}

export const BUGHOUSE_TEAM_NAMES: Readonly<Record<BughouseTeam, string>> = { 1: 'Team 1', 2: 'Team 2' };
export const bughouseTeamShape = (team: BughouseTeam): '◆' | '●' => (team === 1 ? '◆' : '●');

export type BughouseSetupPresetId = 'solo' | 'opponents' | 'teammates' | 'four';
export interface BughouseSetupPreset {
  id: BughouseSetupPresetId;
  label: string;
  /** The seats that are human in this preset. */
  humans: readonly BughouseSeat[];
}

/** The four one-tap presets: shortcuts that fill the same four rows, not modes. */
export const BUGHOUSE_SETUP_PRESETS: readonly BughouseSetupPreset[] = [
  { id: 'solo', label: 'You + 3 bots', humans: [0] },
  { id: 'opponents', label: '2 opponents', humans: [0, 1] },
  { id: 'teammates', label: '2 teammates', humans: [0, 3] },
  { id: 'four', label: '4 players', humans: [0, 1, 2, 3] },
];

/** The seat config of a preset; a seat that is not human is a bot of `elo`. */
export function presetSeatConfig(id: BughouseSetupPresetId, elo: number = DEFAULT_BOT_ELO): SeatConfig {
  const preset = BUGHOUSE_SETUP_PRESETS.find((p) => p.id === id);
  if (!preset) throw new RangeError(`unknown preset ${id}`);
  const seat = (s: BughouseSeat): SeatController => (preset.humans.includes(s) ? { kind: 'human' } : { kind: 'bot', elo });
  return [seat(0), seat(1), seat(2), seat(3)];
}

/** Which preset (if any) a config equals, ignoring the bots' ELOs. */
export function presetOfConfig(config: SeatConfig): BughouseSetupPresetId | null {
  const humans = humanBughouseSeats(config);
  const preset = BUGHOUSE_SETUP_PRESETS.find((p) => p.humans.length === humans.length && p.humans.every((s, i) => s === humans[i]));
  return preset ? preset.id : null;
}

export function humanBughouseSeats(config: SeatConfig): BughouseSeat[] {
  return ([0, 1, 2, 3] as BughouseSeat[]).filter((seat) => config[seat].kind === 'human');
}

// --- The layout that follows from where the humans sit ----------------------------------------------------------------------------------------

export type BughouseLayout =
  | { kind: 'none' }
  /** Exactly one human: its board large, the partner's board a thumbnail (portrait) or two equal boards (landscape). */
  | { kind: 'standard'; seat: BughouseSeat }
  /** Two or more humans, all on `board`: that board is shared and turns to the side to move; the other board runs with bots. */
  | { kind: 'passAndPlay'; board: BoardId }
  /** Humans on both boards: both boards are playable at once (W3b). */
  | { kind: 'dual' };

/** The screen the humans' seats call for (B23 / 5.6). Zero humans cannot start. */
export function deriveBughouseLayout(config: SeatConfig): BughouseLayout {
  const humans = humanBughouseSeats(config);
  if (humans.length === 0) return { kind: 'none' };
  if (humans.length === 1) return { kind: 'standard', seat: humans[0] };
  const boards = new Set(humans.map((s) => seatPlace(s).board));
  if (boards.size === 1) return { kind: 'passAndPlay', board: seatPlace(humans[0]).board };
  return { kind: 'dual' };
}

// --- Cell sizes and the size gate -------------------------------------------------------------------------------------------------------------

export type DualArrangement = 'stacked' | 'sideBySide';

/** Portrait, two boards stacked: height needs 16c + 288, width 8c + 16. */
export const stackedDualCell = (width: number, height: number): number => Math.min(Math.floor((height - 288) / 16), Math.floor((width - 16) / 8));
/** Landscape / tablet, two boards side by side: height needs 8c + 128, width 16c + 24. */
export const sideBySideDualCell = (width: number, height: number): number => Math.min(Math.floor((height - 128) / 8), Math.floor((width - 24) / 16));

export interface DualFit {
  arrangement: DualArrangement;
  /** The cell of the winning arrangement (may be below the minimum, even negative on a tiny window). */
  cell: number;
  stacked: number;
  sideBySide: number;
  /** Whether the cell reaches BUGHOUSE_DUAL_MIN_CELL. */
  fits: boolean;
}

/** `getBughouseDualCellSize(w, h)` of the spec: the arrangement with the larger cell wins; on a tie, side by side from 700 px wide, otherwise stacked. */
export function getBughouseDualCellSize(width: number, height: number): DualFit {
  const stacked = stackedDualCell(width, height);
  const sideBySide = sideBySideDualCell(width, height);
  let arrangement: DualArrangement;
  if (sideBySide > stacked) arrangement = 'sideBySide';
  else if (stacked > sideBySide) arrangement = 'stacked';
  else arrangement = width >= BUGHOUSE_SIDE_BY_SIDE_MIN_WIDTH ? 'sideBySide' : 'stacked';
  const cell = arrangement === 'stacked' ? stacked : sideBySide;
  return { arrangement, cell, stacked, sideBySide, fits: cell >= BUGHOUSE_DUAL_MIN_CELL };
}

export type SetupGate =
  | { startable: true }
  | { startable: false; reason: 'noHuman' | 'tooSmall' | 'comingNext'; message: string };

/**
 * Whether the setup may start in this window. W3a plays one human and "all humans on one board"; humans on both boards need the simultaneous-play input of W3b, so that setup is
 * refused with the size message when the window is below the minimum (evaluated against the CURRENT window: rotating updates it) and with "coming next" when it would fit.
 */
export function bughouseSetupGate(config: SeatConfig, width: number, height: number): SetupGate {
  const layout = deriveBughouseLayout(config);
  if (layout.kind === 'none') return { startable: false, reason: 'noHuman', message: BUGHOUSE_NO_HUMAN_MESSAGE };
  if (layout.kind !== 'dual') return { startable: true };
  if (!getBughouseDualCellSize(width, height).fits) return { startable: false, reason: 'tooSmall', message: BUGHOUSE_SIZE_GATE_MESSAGE };
  return { startable: false, reason: 'comingNext', message: BUGHOUSE_COMING_NEXT_MESSAGE };
}

/** Chrome around the large board of the standard portrait layout: header, controls, four clock rows, a pocket row and the partner strip (calibrated: 36 at 360 x 640, 49 at 412 x 915). */
export const BUGHOUSE_MAIN_CHROME = 352;
export const BUGHOUSE_MAIN_MIN_CELL = 28;
export const BUGHOUSE_MAIN_MAX_CELL = 52;
/** The thumbnail's cell (an 8 x 12 board is about 96 px). */
export const BUGHOUSE_THUMB_CELL = 12;

/** The cell of the large board in the portrait layout (one human, or the shared board of pass-and-play). */
export function getBughouseMainCellSize(width: number, height: number): number {
  const byWidth = Math.floor((width - 16) / 8);
  const byHeight = Math.floor((height - BUGHOUSE_MAIN_CHROME) / 8);
  return Math.max(BUGHOUSE_MAIN_MIN_CELL, Math.min(BUGHOUSE_MAIN_MAX_CELL, byWidth, byHeight));
}

export type StandardArrangement = 'thumbnail' | 'sideBySide';

/** One human or pass-and-play: landscape and tablets show two equal boards side by side; a portrait phone shows the large board and a thumbnail. */
export function standardArrangement(width: number, height: number): StandardArrangement {
  return width >= BUGHOUSE_SIDE_BY_SIDE_MIN_WIDTH || width > height ? 'sideBySide' : 'thumbnail';
}

/** The cell of EACH board when two are side by side outside the dual setups (the same size for both). */
export function getBughouseSideCellSize(width: number, height: number): number {
  return Math.max(BUGHOUSE_MAIN_MIN_CELL - 8, Math.min(BUGHOUSE_MAIN_MAX_CELL + 10, sideBySideDualCell(width, height)));
}
