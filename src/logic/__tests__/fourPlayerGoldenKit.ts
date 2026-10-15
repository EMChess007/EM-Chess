/**
 * The FFA GOLDEN TRANSCRIPTS - the regression gate of 4 Player Giveaway W1 (FOUR_PLAYER_GIVEAWAY_SPEC.md section 5).
 *
 * Giveaway is implemented INSIDE the shared 4 Player engine (a `rules.mode` dispatch at a handful of touch points), so the one thing that
 * must never happen is a 4 Player Chess game behaving differently. `recordFfaGame(seed)` plays one seeded FFA game and returns a text
 * transcript of everything observable: at every step the serialized position, the full legal-move list of the seat to move, a bot decision
 * (some steps), the action taken, and the engine's events as JSON. `fourPlayerFfaGolden.test.ts` hashes the transcripts and compares them
 * with `fixtures/fourPlayerFfaGolden.json`, which was RECORDED FROM THE ENGINE BEFORE ANY GIVEAWAY CHANGE. A hash that moves means FFA
 * moved - which is a bug unless a Chess rule was deliberately changed (then regenerate the fixture in the same commit and say so).
 *
 *   npx tsx src/logic/__tests__/fourPlayerGoldenKit.ts --record     (rewrites the fixture; only for a deliberate FFA change)
 *
 * Deterministic by construction: a seeded mulberry32 for every choice, a fixed bot rng per decision, no clock and no Date.
 */
import { createHash } from 'node:crypto';
import {
  FFA_RULES,
  chooseBotMove,
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

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROMOTION_PIECES = [5, 4, 3, 2]; // queen, rook, bishop, knight

/** Plays one seeded FFA game and returns its transcript (see the file header). */
export function recordFfaGame(seed: number, maxSteps = 260): string {
  const rng = mulberry32(seed);
  const lines: string[] = [];
  let state: FourPlayerState = initialState(FFA_RULES);
  for (let step = 0; step < maxSteps && !state.result; step++) {
    const seat = state.turn;
    const moves = legalMoves(state, seat);
    lines.push(`#${step} ${serialize(state)}`);
    lines.push(`L ${moves.map(moveLabel).join(',')}`);
    if (step % 7 === 3) {
      const elo = step % 14 === 3 ? 600 : 1400;
      const bot = chooseBotMove(state, elo, mulberry32(seed * 1009 + step));
      lines.push(`B${elo} ${bot ? moveLabel(bot) : '-'}`);
    }
    let events: GameEvent[];
    const roll = rng();
    if (roll < 0.03) {
      // a random ACTIVE seat resigns (or times out) - the mover or not
      const active = ([0, 1, 2, 3] as Seat[]).filter((s) => state.status[s] === 'active');
      const who = active[Math.floor(rng() * active.length)];
      const applied = resign(state, who, mulberry32(seed * 31 + step), roll < 0.015 ? 'resign' : 'timeout');
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

// --- Hand-built scenes ---------------------------------------------------------------------------------------------------------------
// Random games rarely reach the rare endings (the 48 recorded games contain ONE checkmate and no stalemate, cap or dead position), so the
// gate also replays fixed scenes: a hand-built position, a scripted opening move or two, then "the first legal move" for a few plies.

interface Scene {
  pieces: string[];
  options?: Parameters<typeof stateFromPieces>[1];
  /** from-to pairs played first (each must be legal), then `tail` plies of "first legal move". */
  script: [string, string][];
  tail: number;
  rng?: number;
}

const SCENES: Record<string, Scene> = {
  // a single knight move mates two seats at once
  doubleMate: {
    pieces: ['rK@h1', 'rN@e9', 'bK@a11', 'bN@a10', 'bN@b10', 'bR@b11', 'yK@d12', 'yN@c11', 'yN@d11', 'yN@d13', 'yB@e11', 'yN@e12', 'yN@e13', 'gK@n7'],
    script: [['e9', 'c10']],
    tail: 8,
  },
  // a boxed-in seat is stalemated at its turn
  stalemate: { pieces: ['rK@h1', 'rR@e10', 'rR@m4', 'bK@a8', 'yK@g14', 'gK@n11'], options: { turn: 2 }, script: [['g14', 'g13']], tail: 8 },
  // the ply cap scores and ends the game
  capScores: { pieces: ['rK@h1', 'bK@a8', 'yK@g14', 'gK@n7', 'yP@g13'], options: { ply: 4, rules: { ...FFA_RULES, maxPlies: 5 }, score: [3, 1, 7, 2] }, script: [['h1', 'h2']], tail: 2 },
  // nothing can end it but the cap
  shuffleToCap: { pieces: ['rK@h1', 'rN@e3', 'bK@a8', 'bN@c6', 'yK@g14', 'yN@j12', 'gK@n7', 'gN@l9'], options: { rules: { ...FFA_RULES, maxPlies: 40 } }, script: [], tail: 60 },
  // the last capture leaves four bare kings
  deadPosition: { pieces: ['rK@h1', 'bK@a8', 'bB@h2', 'yK@g14', 'gK@n7'], script: [['h1', 'h2']], tail: 3 },
  // a dead king walks (rng picks the step)
  deadKingWalk: { pieces: ['rK@h1', 'rP@e2', 'bK@d8', 'yK@g14', 'gK@n7'], options: { status: ['active', 'dead-king', 'active', 'active'] }, script: [['e2', 'e3']], tail: 6, rng: 0.99 },
  // castling both ways
  castleShort: { pieces: ['rK@h1', 'rR@d1', 'rR@k1', 'bK@a8', 'yK@g14', 'gK@n7'], script: [['h1', 'j1']], tail: 6 },
  castleLong: { pieces: ['rK@h1', 'rR@d1', 'rR@k1', 'bK@a8', 'yK@g14', 'gK@n7'], script: [['h1', 'f1']], tail: 6 },
  // a mixed-material skirmish played for 40 plies
  mixedMaterial: { pieces: ['rK@h1', 'rN@k8', 'bK@a8', 'yK@g14', 'gK@n11', 'gN@n10', 'gN@m10', 'gN@m11'], script: [], tail: 40 },
};

/** Replays one scene and returns its transcript (position, legal moves, action and events at every step, plus the final position). */
export function recordFfaScene(name: string): string {
  const scene = SCENES[name];
  let state = stateFromPieces(scene.pieces, scene.options);
  const lines: string[] = [];
  const rngFor = (step: number) => (scene.rng === undefined ? mulberry32(step) : () => scene.rng!);
  const stepOnce = (move: Move, step: number): void => {
    const applied = playMove(state, move, rngFor(step));
    state = applied.state;
    lines.push(`M ${moveLabel(move)}`, `E ${JSON.stringify(applied.events)}`);
  };
  let step = 0;
  for (const [from, to] of scene.script) {
    lines.push(`#${step} ${serialize(state)}`, `L ${legalMoves(state, state.turn).map(moveLabel).join(',')}`);
    const move = findLegalMove(state, state.turn, parseSquare(from), parseSquare(to));
    if (!move) throw new Error(`golden scene ${name}: ${from}-${to} is not legal`);
    stepOnce(move, step++);
  }
  for (let i = 0; i < scene.tail && !state.result; i++) {
    const moves = legalMoves(state, state.turn);
    lines.push(`#${step} ${serialize(state)}`, `L ${moves.map(moveLabel).join(',')}`);
    stepOnce(moves[0], step++);
  }
  lines.push(`FINAL ${serialize(state)}`);
  return lines.join('\n');
}

export const SCENE_NAMES: readonly string[] = Object.keys(SCENES);

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The seeds replayed by the gate. Enough variety to reach promotion, castling, en passant, mates, stalemates, dead-king walks and caps. */
export const GOLDEN_SEEDS: readonly number[] = Array.from({ length: 48 }, (_, i) => 1000 + i * 37);

export function recordAllHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const seed of GOLDEN_SEEDS) out[`game:${seed}`] = sha256(recordFfaGame(seed));
  for (const name of SCENE_NAMES) out[`scene:${name}`] = sha256(recordFfaScene(name));
  return out;
}

// `--record`: rewrite the fixture from the CURRENT engine.
if (process.argv.includes('--record') && process.argv[1]?.includes('fourPlayerGoldenKit')) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { writeFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs');
  mkdirSync(`${__dirname}/fixtures`, { recursive: true });
  writeFileSync(`${__dirname}/fixtures/fourPlayerFfaGolden.json`, JSON.stringify(recordAllHashes(), null, 1) + '\n');
  console.log(`recorded ${GOLDEN_SEEDS.length} transcripts`);
}
