/**
 * The GIVEAWAY GOLDEN TRANSCRIPTS - the second regression gate (CHATURAJI_SPEC.md section 11, written BEFORE Chaturaji W0 touched the engine).
 *
 * The first gate (fourPlayerGoldenKit.ts) pins 4 Player Chess. Chaturaji W0 rewires the shared engine (board geometry and rule options read from
 * the rules object), and 4 Player Giveaway lives in the same engine behind `rules.mode`, so it needs the same protection: `recordGiveawayGame(seed)`
 * plays one seeded Giveaway game and `recordGiveawayScene(name)` replays a hand-built position; both return a text transcript of everything
 * observable - at every step the serialized position, the full legal-move list of the seat to move, a bot decision (some steps), the action taken
 * and the engine's events as JSON. `fourPlayerGiveawayGolden.test.ts` hashes them and compares with `fixtures/fourPlayerGiveawayGolden.json`,
 * RECORDED FROM THE ENGINE BEFORE ANY CHATURAJI CHANGE. A hash that moves means Giveaway moved - a bug unless a Giveaway rule was deliberately
 * changed (then regenerate the fixture in the same commit and say so).
 *
 *   backend/node_modules/.bin/tsx src/logic/__tests__/fourPlayerGiveawayGoldenKit.ts --record     (rewrites the fixture; only for a deliberate change)
 *
 * Deterministic by construction: seeded mulberry32 for every choice, a fixed bot rng per decision, no clock and no Date.
 */
import {
  GIVEAWAY_RULES,
  chooseGiveawayFourBotMove,
  findLegalMove,
  initialState,
  legalMoves,
  moveLabel,
  parseSquare,
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

const PROMOTION_PIECES = [5, 4, 3, 2]; // queen, rook, bishop, knight

/** Plays one seeded Giveaway game and returns its transcript (see the file header). */
export function recordGiveawayGame(seed: number, maxSteps = 320): string {
  const rng = mulberry32(seed);
  const lines: string[] = [];
  let state: FourPlayerState = initialState(GIVEAWAY_RULES);
  for (let step = 0; step < maxSteps && !state.result; step++) {
    const seat = state.turn;
    const moves = legalMoves(state, seat);
    lines.push(`#${step} ${serialize(state)}`);
    lines.push(`L ${moves.map(moveLabel).join(',')}`);
    if (step % 5 === 2) {
      const elo = step % 10 === 2 ? 700 : 1500;
      const bot = chooseGiveawayFourBotMove(state, elo, mulberry32(seed * 1009 + step));
      lines.push(`B${elo} ${bot ? moveLabel(bot) : '-'}`);
    }
    let events: GameEvent[];
    const roll = rng();
    if (roll < 0.02) {
      const active = ([0, 1, 2, 3] as Seat[]).filter((s) => state.status[s] === 'active');
      const who = active[Math.floor(rng() * active.length)];
      const applied = resign(state, who, mulberry32(seed * 31 + step), roll < 0.01 ? 'resign' : 'timeout');
      lines.push(`R ${who}`);
      state = applied.state;
      events = applied.events;
    } else {
      const pick: Move = moves[Math.floor(rng() * moves.length)];
      const promoted = findLegalMove(state, seat, pick.from, pick.to, PROMOTION_PIECES[Math.floor(rng() * 4)]);
      const move = promoted ?? pick;
      lines.push(`M ${moveLabel(move)}`);
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
// Random games reach the rare endings only sometimes, so the gate also replays fixed scenes covering every Giveaway rule: forced captures against
// 1 / 3 seats, en passant, a king capture, capture-promotions, walls, stuck, last piece, last standing, the cap with a tie, no castling.

type Step = { move: [string, string, number?] } | { resign: Seat; reason: 'resign' | 'timeout' };

interface Scene {
  pieces: string[];
  options?: Parameters<typeof stateFromPieces>[1];
  script: Step[];
  /** plies of "first legal move" after the script. */
  tail: number;
}

const KINGS = ['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7'];
const mv = (from: string, to: string, promo?: number): Step => ({ move: [from, to, promo] });
const out = (seat: Seat, reason: 'resign' | 'timeout' = 'resign'): Step => ({ resign: seat, reason });

const SCENES: Record<string, Scene> = {
  oneVictim: { pieces: ['rR@d5', 'bP@d9', ...KINGS], options: { turn: 0 }, script: [], tail: 8 },
  threeVictims: { pieces: ['bQ@g8', 'gP@m8', 'yP@g12', 'rP@g3', ...KINGS], options: { turn: 1 }, script: [], tail: 10 },
  enPassant: { pieces: ['yP@i13', 'gP@j11', ...KINGS], options: { turn: 2 }, script: [mv('i13', 'i11')], tail: 6 },
  lastPieceKing: { pieces: ['rR@d5', 'bK@d9', 'rK@h1', 'yK@g14', 'gK@n7'], options: { turn: 0 }, script: [mv('d5', 'd9')], tail: 2 },
  kingsAdjacent: { pieces: ['rK@h1', 'bK@h2', 'bP@a9', 'yK@g14', 'gK@n7'], options: { turn: 0 }, script: [], tail: 8 },
  promotionByCapture: { pieces: ['rP@e7', 'bR@f8', ...KINGS], options: { turn: 0 }, script: [mv('e7', 'f8', 2)], tail: 6 },
  walls: { pieces: ['rR@e1', 'bN@e5', 'yP@e12', 'gP@m6', 'rK@h1', 'yK@g14', 'gK@n7'], options: { turn: 0, status: ['active', 'frozen', 'active', 'active'] }, script: [], tail: 40 },
  stuck: { pieces: ['rK@h1', 'bK@a8', 'bP@e11', 'yP@e12', 'gK@n7'], options: { turn: 0 }, script: [mv('h1', 'h2'), mv('a8', 'a9')], tail: 2 },
  outOfPieces: { pieces: ['rK@h1', 'bK@a9', 'yR@g8', 'gP@m8'], options: { turn: 0 }, script: [mv('h1', 'h2'), mv('a9', 'a10'), mv('g8', 'm8')], tail: 1 },
  lastStanding: { pieces: [...KINGS], options: { turn: 0 }, script: [mv('h1', 'h2'), out(1, 'timeout'), mv('g14', 'g13'), out(0), out(3, 'timeout')], tail: 1 },
  capTie: {
    pieces: ['rK@h1', 'rP@e3', 'bK@a8', 'bP@b9', 'yK@g14', 'yP@e12', 'yP@f12', 'gK@n7', 'gP@m6', 'gP@m5'],
    options: { turn: 0, ply: 5, rules: { ...GIVEAWAY_RULES, maxPlies: 6 } },
    script: [mv('h1', 'h2')],
    tail: 1,
  },
  noCastling: { pieces: ['rK@h1', 'rR@d1', 'rR@k1', 'bK@a8', 'yK@g14', 'gK@n7'], options: { turn: 0 }, script: [], tail: 6 },
  mixedMaterial: { pieces: ['rK@h1', 'rN@k8', 'bK@a8', 'yK@g14', 'gK@n11', 'gN@n10', 'gN@m10', 'gN@m11'], options: { turn: 0 }, script: [], tail: 40 },
};

/** Replays one scene and returns its transcript (position, legal moves, action and events at every step, plus the final position). */
export function recordGiveawayScene(name: string): string {
  const scene = SCENES[name];
  let state = stateFromPieces(scene.pieces, { rules: GIVEAWAY_RULES, ...scene.options });
  const lines: string[] = [];
  let step = 0;
  const observe = (): void => {
    lines.push(`#${step} ${serialize(state)}`, `L ${legalMoves(state, state.turn).map(moveLabel).join(',')}`);
  };
  for (const entry of scene.script) {
    observe();
    if ('resign' in entry) {
      const applied = resign(state, entry.resign, mulberry32(step), entry.reason);
      state = applied.state;
      lines.push(`R ${entry.resign} ${entry.reason}`, `E ${JSON.stringify(applied.events)}`);
    } else {
      const [from, to, promo] = entry.move;
      const move = findLegalMove(state, state.turn, parseSquare(from), parseSquare(to), promo);
      if (!move) throw new Error(`giveaway golden scene ${name}: ${from}-${to} is not legal`);
      const applied = playMove(state, move, mulberry32(step));
      state = applied.state;
      lines.push(`M ${moveLabel(move)}`, `E ${JSON.stringify(applied.events)}`);
    }
    step++;
  }
  for (let i = 0; i < scene.tail && !state.result; i++) {
    const moves = legalMoves(state, state.turn);
    observe();
    const applied = playMove(state, moves[0], mulberry32(step));
    state = applied.state;
    lines.push(`M ${moveLabel(moves[0])}`, `E ${JSON.stringify(applied.events)}`);
    step++;
  }
  lines.push(`FINAL ${serialize(state)}`);
  return lines.join('\n');
}

export const GIVEAWAY_SCENE_NAMES: readonly string[] = Object.keys(SCENES);

/** The seeds replayed by the gate. */
export const GIVEAWAY_GOLDEN_SEEDS: readonly number[] = Array.from({ length: 40 }, (_, i) => 2000 + i * 41);

export function recordAllGiveawayHashes(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const seed of GIVEAWAY_GOLDEN_SEEDS) result[`game:${seed}`] = sha256(recordGiveawayGame(seed));
  for (const name of GIVEAWAY_SCENE_NAMES) result[`scene:${name}`] = sha256(recordGiveawayScene(name));
  return result;
}

// `--record`: rewrite the fixture from the CURRENT engine.
if (process.argv.includes('--record') && process.argv[1]?.includes('fourPlayerGiveawayGoldenKit')) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { writeFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs');
  mkdirSync(`${__dirname}/fixtures`, { recursive: true });
  writeFileSync(`${__dirname}/fixtures/fourPlayerGiveawayGolden.json`, JSON.stringify(recordAllGiveawayHashes(), null, 1) + '\n');
  console.log(`recorded ${GIVEAWAY_GOLDEN_SEEDS.length} games + ${GIVEAWAY_SCENE_NAMES.length} scenes`);
}
