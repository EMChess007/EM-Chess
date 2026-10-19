/**
 * The CHATURAJI GOLDEN TRANSCRIPTS (CHATURAJI_SPEC.md section 11), recorded once the W1 rules were final.
 *
 * The third engine gate, next to fourPlayerGoldenKit.ts (4 Player Chess) and fourPlayerGiveawayGoldenKit.ts (Giveaway): `recordChaturajiGame(seed)` plays one
 * seeded Chaturaji game and `recordChaturajiScene(name)` replays a hand-built position; both return a text transcript of everything observable - at every step the
 * serialized 8 x 8 position, the full legal-move list of the seat to move, the action taken and the engine's events as JSON.
 * `fourPlayerChaturajiGolden.test.ts` hashes them against `fixtures/fourPlayerChaturajiGolden.json`. A hash that moves means a Chaturaji rule moved - a bug unless
 * it was deliberate (then regenerate the fixture in the same commit and say so). The bot is deliberately NOT part of it (the Chaturaji bot is W2).
 *
 *   backend/node_modules/.bin/tsx src/logic/__tests__/fourPlayerChaturajiGoldenKit.ts --record     (rewrites the fixture; only for a deliberate rule change)
 *
 * Deterministic by construction: seeded mulberry32 for every choice, no clock and no Date.
 */
import {
  CHATURAJI_RULES,
  SQUARE8,
  findLegalMove,
  initialState,
  legalMoves,
  moveLabelOn,
  playMove,
  resign,
  serialize,
  stateFromPieces,
  type FourPlayerState,
  type GameEvent,
  type Move,
  type Seat,
} from '../fourPlayer';
import { mulberry32, sha256 } from './fourPlayerGoldenKit';

const label = (move: Move): string => moveLabelOn(move, SQUARE8);
const ROOK = 4;

/** Plays one seeded Chaturaji game (with some bias towards captures so that kings fall) and returns its transcript. */
export function recordChaturajiGame(seed: number, maxSteps = 1100): string {
  const rng = mulberry32(seed);
  const lines: string[] = [];
  let state: FourPlayerState = initialState(CHATURAJI_RULES);
  for (let step = 0; step < maxSteps && !state.result; step++) {
    const seat = state.turn;
    const moves = legalMoves(state, seat);
    lines.push(`#${step} ${serialize(state)}`);
    lines.push(`L ${moves.map(label).join(',')}`);
    let events: GameEvent[];
    const roll = rng();
    if (roll < 0.015) {
      const active = ([0, 1, 2, 3] as Seat[]).filter((s) => state.status[s] === 'active');
      const who = active[Math.floor(rng() * active.length)];
      const applied = resign(state, who, mulberry32(seed * 31 + step), roll < 0.0075 ? 'resign' : 'timeout');
      lines.push(`R ${who}`);
      state = applied.state;
      events = applied.events;
    } else {
      const captures = moves.filter((m) => m.captured !== 0);
      const pick = captures.length > 0 && rng() < 0.5 ? captures[Math.floor(rng() * captures.length)] : moves[Math.floor(rng() * moves.length)];
      const move = findLegalMove(state, seat, pick.from, pick.to, ROOK) ?? pick;
      lines.push(`M ${label(move)}`);
      const applied = playMove(state, move, mulberry32(seed * 17 + step));
      state = applied.state;
      events = applied.events;
    }
    lines.push(`E ${JSON.stringify(events)}`);
  }
  lines.push(`FINAL ${serialize(state)}`);
  return lines.join('\n');
}

// --- Hand-built scenes ----------------------------------------------------------------------------------------------------------------
// Random games rarely reach the rare rules, so the gate also replays fixed scenes: a hand-built position, a script of moves / resignations, then "the first
// legal move" for a few plies.

type Step = { move: [string, string] } | { resign: Seat; reason: 'resign' | 'timeout' };

interface Scene {
  pieces: string[];
  options?: Parameters<typeof stateFromPieces>[1];
  script: Step[];
  tail: number;
}

const KINGS = ['rK@a1', 'bK@a8', 'yK@h8', 'gK@h1'];
const mv = (from: string, to: string): Step => ({ move: [from, to] });
const out = (seat: Seat, reason: 'resign' | 'timeout' = 'resign'): Step => ({ resign: seat, reason });

const SCENES: Record<string, Scene> = {
  start: { pieces: [], options: undefined, script: [], tail: 24 },
  kingCapture: { pieces: ['rK@a1', 'rR@d4', 'bK@d8', 'bN@b6', 'bP@c5', 'yK@h8', 'gK@h1'], script: [mv('d4', 'd8')], tail: 10 },
  ignoredCheck: { pieces: ['rK@d1', 'rP@a2', 'bR@d6', 'bK@a8', 'yK@h8', 'gK@h1'], script: [mv('a2', 'a3'), mv('d6', 'd1')], tail: 6 },
  forkTwo: { pieces: ['rK@a1', 'rN@c5', 'bK@d6', 'yK@f6', 'gK@h1'], script: [mv('c5', 'e4')], tail: 6 },
  forkThree: { pieces: ['rK@a1', 'rN@c5', 'bK@d6', 'yK@f6', 'gK@g3'], script: [mv('c5', 'e4')], tail: 6 },
  forkThenCapture: { pieces: ['rK@a1', 'rN@e5', 'bK@d7', 'yK@f6', 'gK@b6'], script: [mv('e5', 'd7')], tail: 8 },
  discovered: { pieces: ['rK@a1', 'rR@d4', 'rN@e4', 'bK@a4', 'yK@g4', 'gK@h1'], script: [mv('e4', 'c5')], tail: 6 },
  promotionByCapture: { pieces: [...KINGS, 'rP@c7', 'bN@b8', 'yP@d8'], script: [mv('c7', 'b8')], tail: 12 },
  promotionBlue: { pieces: [...KINGS, 'bP@g5'], options: { turn: 1 }, script: [mv('g5', 'h5')], tail: 8 },
  deadPieces: { pieces: [...KINGS, 'rR@d4', 'bP@d6', 'bN@f4'], options: { status: ['active', 'frozen', 'active', 'active'] }, script: [mv('d4', 'd6')], tail: 10 },
  stalemateElimination: {
    pieces: ['bK@a8', ...'abcdefgh'.split('').map((f) => `bP@${f}7`), ...'bcdefgh'.split('').map((f) => `bP@${f}8`), 'rK@a1', 'yK@e4', 'gK@h1'],
    script: [mv('a1', 'b1')],
    tail: 12,
  },
  resignWalkingKing: { pieces: ['rK@a1', 'bK@a8', 'yK@h8', 'gK@d4', 'rP@d5'], options: { turn: 2 }, script: [out(3), mv('h8', 'h7')], tail: 20 },
  captureWalkingKing: { pieces: ['rK@a1', 'rR@d1', 'bK@a8', 'yK@h8', 'gK@d4'], options: { status: ['active', 'active', 'active', 'dead-king'] }, script: [mv('d1', 'd4')], tail: 8 },
  endNotTheSurvivor: { pieces: ['rK@a1', 'rR@d4', 'gK@d8'], options: { status: ['active', 'frozen', 'frozen', 'active'], score: [0, 0, 20, 0] }, script: [mv('d4', 'd8')], tail: 1 },
  endTie: { pieces: ['rK@a1', 'rR@d4', 'gK@d8'], options: { status: ['active', 'frozen', 'frozen', 'active'], score: [0, 0, 3, 0] }, script: [mv('d4', 'd8')], tail: 1 },
  endBonus: { pieces: ['rK@a1', 'rR@d4', 'gK@d8', 'bK@a8', 'yK@h8'], options: { status: ['active', 'dead-king', 'dead-king', 'active'] }, script: [mv('d4', 'd8')], tail: 1 },
  resignEnds: { pieces: ['rK@a1', 'bK@a8', 'gK@h1'], options: { status: ['active', 'dead-king', 'frozen', 'active'] }, script: [out(3, 'timeout')], tail: 1 },
  capTie: { pieces: [...KINGS, 'rP@c3'], options: { ply: 4, rules: { ...CHATURAJI_RULES, maxPlies: 5 }, score: [2, 7, 1, 7] }, script: [mv('c3', 'c4')], tail: 1 },
  bareKings: { pieces: [...KINGS], script: [], tail: 40 },
};

/** Replays one scene and returns its transcript (position, legal moves, action and events at every step, plus the final position). */
export function recordChaturajiScene(name: string): string {
  const scene = SCENES[name];
  let state = name === 'start' ? initialState(CHATURAJI_RULES) : stateFromPieces(scene.pieces, { rules: CHATURAJI_RULES, ...scene.options });
  const lines: string[] = [];
  let step = 0;
  const observe = (): void => {
    lines.push(`#${step} ${serialize(state)}`, `L ${legalMoves(state, state.turn).map(label).join(',')}`);
  };
  for (const entry of scene.script) {
    observe();
    if ('resign' in entry) {
      const applied = resign(state, entry.resign, mulberry32(step), entry.reason);
      state = applied.state;
      lines.push(`R ${entry.resign} ${entry.reason}`, `E ${JSON.stringify(applied.events)}`);
    } else {
      const [from, to] = entry.move;
      const move = findLegalMove(state, state.turn, SQUARE8.parseSquare(from), SQUARE8.parseSquare(to), ROOK);
      if (!move) throw new Error(`chaturaji golden scene ${name}: ${from}-${to} is not legal`);
      const applied = playMove(state, move, mulberry32(step));
      state = applied.state;
      lines.push(`M ${label(move)}`, `E ${JSON.stringify(applied.events)}`);
    }
    step++;
  }
  for (let i = 0; i < scene.tail && !state.result; i++) {
    const moves = legalMoves(state, state.turn);
    observe();
    const applied = playMove(state, moves[0], mulberry32(step));
    state = applied.state;
    lines.push(`M ${label(moves[0])}`, `E ${JSON.stringify(applied.events)}`);
    step++;
  }
  lines.push(`FINAL ${serialize(state)}`);
  return lines.join('\n');
}

export const CHATURAJI_SCENE_NAMES: readonly string[] = Object.keys(SCENES);

/** The seeds replayed by the gate. */
export const CHATURAJI_GOLDEN_SEEDS: readonly number[] = Array.from({ length: 40 }, (_, i) => 3000 + i * 43);

export function recordAllChaturajiHashes(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const seed of CHATURAJI_GOLDEN_SEEDS) result[`game:${seed}`] = sha256(recordChaturajiGame(seed));
  for (const name of CHATURAJI_SCENE_NAMES) result[`scene:${name}`] = sha256(recordChaturajiScene(name));
  return result;
}

// `--record`: rewrite the fixture from the CURRENT engine.
if (process.argv.includes('--record') && process.argv[1]?.includes('fourPlayerChaturajiGoldenKit')) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { writeFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs');
  mkdirSync(`${__dirname}/fixtures`, { recursive: true });
  writeFileSync(`${__dirname}/fixtures/fourPlayerChaturajiGolden.json`, JSON.stringify(recordAllChaturajiHashes(), null, 1) + '\n');
  console.log(`recorded ${CHATURAJI_GOLDEN_SEEDS.length} games + ${CHATURAJI_SCENE_NAMES.length} scenes`);
}
