/**
 * The BUGHOUSE GOLDEN TRANSCRIPTS (BUGHOUSE_SPEC.md W1 test 2f): `recordBughouseGame(seed)` plays one seeded full match and `recordBughouseScene(name)` plays a scripted scene; both return a
 * text transcript of everything observable - for every input the input itself, the instant, the outcome (applied / flag / idle / rejected with its reason), the events, and the
 * COMPLETE match as the snapshot text (both positions, the promoted marks, the four pockets, the four clocks, the verdicts, the seq, the result). `bughouseGolden.test.ts` hashes them
 * against `fixtures/bughouseGolden.json`. A hash that moves means a Bughouse rule moved - a bug unless it was deliberate (then regenerate the fixture in the same commit and say so).
 *
 *   backend/node_modules/.bin/tsx src/logic/__tests__/bughouseGoldenKit.ts --record     (rewrites the fixture; only for a deliberate rule change)
 *
 * The games are driven by the ENGINE ALONE (its own legal lists), not by the reference model, so the golden does not depend on chessops. Deterministic by construction: seeded
 * mulberry32 for every choice, instants are integers made from the seed, no clock and no Date.
 */
import {
  BUGHOUSE_TIME_CONTROLS,
  createMatch,
  legalActions,
  seatPlace,
  serializeMatch,
  settle,
  voidMatch,
  type BughouseAction,
  type BughouseMatch,
  type BughouseSeat,
  type BughouseTimeControl,
  type SettleOutcome,
} from '../bughouse';
import { mulberry32, sha256 } from './fourPlayerGoldenKit';
import { drop, move, scene, START, type SceneOptions } from './bughouseScenes';

export { sha256 };

type Step = { seat: BughouseSeat; action: BughouseAction; now: number } | { timer: true; now: number } | { void: true; now: number };

function describeOutcome(outcome: SettleOutcome): string {
  switch (outcome.kind) {
    case 'idle':
      return 'idle';
    case 'rejected':
      return `rejected ${outcome.reason}`;
    case 'applied':
      return `applied ${JSON.stringify(outcome.events)}`;
    case 'flag':
      return `flag ${JSON.stringify(outcome.events)} discarded ${JSON.stringify(outcome.discarded)}`;
  }
}

/** Runs one step, appends it to the transcript and returns the (possibly new) match. */
function run(m: BughouseMatch, step: Step, out: string[]): BughouseMatch {
  if ('void' in step) {
    const next = voidMatch(m, step.now);
    out.push(`void at ${step.now}: ${next === null ? 'refused' : 'voided'}`, serializeMatch(next ?? m));
    return next ?? m;
  }
  const input = 'timer' in step ? null : { seat: step.seat, action: step.action };
  const outcome = settle(m, input, step.now);
  out.push(`input ${JSON.stringify(input)} at ${step.now}: ${describeOutcome(outcome)}`);
  const next = outcome.kind === 'applied' || outcome.kind === 'flag' ? outcome.match : m;
  out.push(serializeMatch(next));
  return next;
}

export interface GameCoverage {
  games: number;
  commits: number;
  captures: number;
  drops: number;
  banks: number;
  promotions: number;
  mates: number;
  flags: number;
  resigns: number;
  stuck: number;
  rejected: number;
}
export const emptyGameCoverage = (): GameCoverage => ({ games: 0, commits: 0, captures: 0, drops: 0, banks: 0, promotions: 0, mates: 0, flags: 0, resigns: 0, stuck: 0, rejected: 0 });

/** Plays one seeded match with the engine's own legal lists; optionally adds what it reached to `coverage`. */
export function recordBughouseGame(seed: number, maxSteps = 110, coverage?: GameCoverage): string {
  const rng = mulberry32(seed);
  const timeControl: BughouseTimeControl = BUGHOUSE_TIME_CONTROLS[Math.floor(rng() * BUGHOUSE_TIME_CONTROLS.length)];
  const room = Math.floor(rng() * 500);
  const start = Math.floor(rng() * 3000);
  let m = createMatch({ timeControl, roomNumber: room, startMs: start });
  const out: string[] = [`game ${seed} control ${timeControl.initialMs}|${timeControl.incrementMs} room ${room} start ${start}`, serializeMatch(m)];
  let now = start;
  for (let step = 0; step < maxSteps && m.result === null; step++) {
    now += rng() < 0.02 ? Math.floor(rng() * (timeControl.initialMs / 4)) : Math.floor(rng() * 800);
    const roll = rng();
    const seats = ([0, 1, 2, 3] as BughouseSeat[]).filter((s) => m.verdicts[seatPlace(s).board].turn === seatPlace(s).color);
    const seat = seats.length > 0 ? seats[Math.floor(rng() * seats.length)] : (Math.floor(rng() * 4) as BughouseSeat);
    let s: Step;
    if (roll < 0.02) s = { timer: true, now };
    else if (roll < 0.0215) s = { seat, action: { kind: 'resign' }, now };
    else if (roll < 0.08) s = { seat, action: drop(seatPlace(seat).board === 'A' ? 'B' : 'A', 'n', 'e4'), now }; // a hostile request: the wrong board
    else {
      const legal = legalActions(m, seat);
      const place = seatPlace(seat);
      if (legal.drops.length > 0 && rng() < 0.5) {
        const d = legal.drops[Math.floor(rng() * legal.drops.length)];
        s = { seat, action: drop(place.board, d.piece, d.square), now };
      } else if (legal.moves.length > 0) {
        // prefer a capture: a move whose destination is occupied
        const placement = m.boards[place.board].fen.split(' ')[0];
        const occupied = (sq: string) => {
          let file = 0;
          for (const ch of placement.split('/')[8 - Number(sq[1])]) {
            if (/\d/.test(ch)) file += Number(ch);
            else {
              if (file === sq.charCodeAt(0) - 97) return true;
              file++;
            }
          }
          return false;
        };
        const captures = legal.moves.filter((mv) => occupied(mv.to));
        const pool = captures.length > 0 && rng() < 0.6 ? captures : legal.moves;
        const mv = pool[Math.floor(rng() * pool.length)];
        s = { seat, action: move(place.board, mv.from, mv.to, mv.promotion), now };
      } else s = { timer: true, now: now + Math.floor(rng() * 1500) };
    }
    const before = m;
    m = run(m, s, out);
    if (coverage) {
      coverage.commits += m.seq - before.seq;
      if (m === before && !('timer' in s)) coverage.rejected++;
      for (const board of ['A', 'B'] as const) if (m.verdicts[board].status === 'stuck' && before.verdicts[board].status !== 'stuck') coverage.stuck++;
      if (m.seq > before.seq && 'action' in s) {
        if (s.action.kind === 'drop') coverage.drops++;
        if (s.action.kind === 'move') {
          const sanBefore = before.boards[s.action.board].fen.split(' ')[0];
          const sanAfter = m.boards[s.action.board].fen.split(' ')[0];
          if (m.pockets.reduce((n, p) => n + p.p + p.n + p.b + p.r + p.q, 0) > before.pockets.reduce((n, p) => n + p.p + p.n + p.b + p.r + p.q, 0)) {
            coverage.captures++;
            coverage.banks++;
          }
          if (sanBefore !== sanAfter && m.boards[s.action.board].promoted.length > before.boards[s.action.board].promoted.length) coverage.promotions++;
        }
      }
    }
  }
  out.push(`final ${m.result === null ? 'no result' : JSON.stringify(m.result)}`);
  if (coverage) {
    coverage.games++;
    const r = m.result;
    if (r !== null && !('voided' in r)) {
      if (r.reason === 'checkmate') coverage.mates++;
      if (r.reason === 'flag') coverage.flags++;
      if (r.reason === 'resign') coverage.resigns++;
    }
  }
  return out.join('\n') + '\n';
}

// --- scripted scenes -------------------------------------------------------------------------------------------------------------------------

interface SceneScript {
  options: SceneOptions;
  steps: Step[];
}

const ONE_MINUTE: BughouseTimeControl = { initialMs: 60000, incrementMs: 0 };
const backRank = 'k7/8/8/8/8/8/6PP/r6K w - - 0 1';
const mateInOne = 'k7/2K5/8/8/8/8/8/1Q6 w - - 0 1';
const s = (seat: BughouseSeat, action: BughouseAction, now: number): Step => ({ seat, action, now });

const SCENES: Record<string, SceneScript> = {
  // the start: moves on both boards, captures crossing over, drops of the credited pieces
  opening: {
    options: { timeControl: { initialMs: 120000, incrementMs: 1000 }, startMs: 0 },
    steps: [
      s(0, move('A', 'e2', 'e4'), 800),
      s(2, move('B', 'd2', 'd4'), 900),
      s(1, move('A', 'd7', 'd5'), 1500),
      s(3, move('B', 'e7', 'e5'), 1600),
      s(0, move('A', 'e4', 'd5'), 2400), // a pawn to seat 3
      s(2, move('B', 'd4', 'e5'), 2500), // a pawn to seat 1
      s(1, drop('A', 'p', 'e5'), 3100),
      s(3, drop('B', 'p', 'e6'), 3200),
    ],
  },
  // stuck: a back-rank check with an empty pocket; the partner's capture arrives; the player drops
  stuckThenRescued: {
    options: { a: backRank, b: 'r3k3/8/8/8/8/8/8/R3K3 b - - 0 1', timeControl: ONE_MINUTE, startMs: 0 },
    steps: [{ timer: true, now: 5000 }, s(0, move('A', 'h1', 'g1'), 5100), s(3, move('B', 'a8', 'a1'), 6000), s(0, drop('A', 'r', 'g1'), 6500), s(1, move('A', 'a8', 'a7'), 7000)],
  },
  // stuck without a check: a stalemate with an empty pocket, decided by the clock
  stalemateByClock: {
    options: { a: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', timeControl: ONE_MINUTE, startMs: 0 },
    steps: [{ timer: true, now: 30000 }, s(1, move('A', 'h8', 'g8'), 31000), { timer: true, now: 60000 }, { timer: true, now: 70000 }],
  },
  smotheredMate: { options: { a: '6k1/8/8/8/8/3n4/6PP/6RK b - - 0 1', startMs: 0 }, steps: [s(1, move('A', 'd3', 'f2'), 1000), s(0, move('A', 'g1', 'f1'), 1100)] },
  dropMate: { options: { a: '7k/6pp/8/8/2B5/8/8/4K3 w - - 0 1', pockets: { 0: { q: 1 } }, startMs: 0 }, steps: [s(0, drop('A', 'q', 'g8'), 1000)] },
  // a flag against a checkmate: the mate one millisecond before the deadline, at it, and after it
  flagVsMateBefore: { options: { a: mateInOne, b: START, timeControl: ONE_MINUTE, startMs: 0, clocks: { 2: { remainingMs: 10000 } } }, steps: [s(0, move('A', 'b1', 'b7'), 9999), { timer: true, now: 20000 }] },
  flagVsMateAt: { options: { a: mateInOne, b: START, timeControl: ONE_MINUTE, startMs: 0, clocks: { 2: { remainingMs: 10000 } } }, steps: [s(0, move('A', 'b1', 'b7'), 10000)] },
  flagVsMateAfter: { options: { a: mateInOne, b: START, timeControl: ONE_MINUTE, startMs: 0, clocks: { 2: { remainingMs: 10000 } } }, steps: [s(0, move('A', 'b1', 'b7'), 10001)] },
  // the exact-millisecond tie of two flags, both levels of the tie-break
  tieLevelOneLowerSeqLoses: {
    options: { a: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1', b: START, timeControl: ONE_MINUTE, startMs: 0, roomNumber: 3, seq: 9, clocks: { 0: { runningSince: null }, 1: { remainingMs: 7000, runningSince: 0, startSeq: 3 }, 2: { remainingMs: 7000, runningSince: 0, startSeq: 8 } } },
    steps: [{ timer: true, now: 7000 }],
  },
  tieLevelTwoEvenRoom: { options: { timeControl: ONE_MINUTE, startMs: 1000, roomNumber: 8 }, steps: [{ timer: true, now: 61000 }] },
  tieLevelTwoOddRoom: { options: { timeControl: ONE_MINUTE, startMs: 1000, roomNumber: 9 }, steps: [{ timer: true, now: 61000 }] },
  twoFlagsOneMillisecondApart: {
    options: { b: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1', timeControl: ONE_MINUTE, startMs: 0, clocks: { 0: { remainingMs: 5000, runningSince: 0 }, 2: { runningSince: null }, 3: { remainingMs: 5001, runningSince: 0 } } },
    steps: [{ timer: true, now: 5001 }],
  },
  // a promoted queen captured returns as a pawn, to the capturer's partner
  counterfeit: { options: { a: '7r/P3k3/8/8/8/8/8/4K3 w - - 0 1', startMs: 0 }, steps: [s(0, move('A', 'a7', 'a8', 'q'), 1000), s(1, move('A', 'h8', 'a8'), 1100), s(2, move('B', 'e2', 'e4'), 1200)] },
  // B1: a pawn dropped on the 2nd rank double-steps and is taken en passant
  droppedPawnEnPassant: {
    options: { a: '4k3/8/8/8/3p4/8/8/4K3 w - - 0 1', pockets: { 0: { p: 1 } }, startMs: 0 },
    steps: [s(0, drop('A', 'p', 'e2'), 500), s(1, move('A', 'e8', 'd8'), 600), s(0, move('A', 'e2', 'e4'), 700), s(1, move('A', 'd4', 'e3'), 800)],
  },
  // B6: a rook dropped back on its home square does not bring castling back
  droppedRookNoCastling: {
    options: { a: '4k3/8/8/8/8/8/8/R3K3 w Q - 0 1', pockets: { 0: { r: 1 } }, startMs: 0 },
    steps: [s(0, drop('A', 'r', 'h1'), 500), s(1, move('A', 'e8', 'd8'), 600), s(0, move('A', 'e1', 'g1'), 700), s(0, move('A', 'e1', 'c1'), 800)],
  },
  // resignation off turn (the W1 scene `disconnect` was removed in W2: there is no disconnect result, B19)
  resignOffTurn: { options: { startMs: 0 }, steps: [s(3, { kind: 'resign' }, 4000), s(0, move('A', 'e2', 'e4'), 4100)] },
  voided: { options: { startMs: 0 }, steps: [s(0, move('A', 'e2', 'e4'), 500), { void: true, now: 900 }, { void: true, now: 1000 }, s(1, move('A', 'e7', 'e5'), 1100)] },
  // every kind of refusal, in one scene, and the match never changes
  refusals: {
    options: { startMs: 0 },
    steps: [
      s(0, move('A', 'e2', 'e5'), 100),
      s(0, move('B', 'e2', 'e4'), 100),
      s(1, move('A', 'e7', 'e5'), 100),
      s(0, drop('A', 'n', 'e4'), 100),
      s(0, { kind: 'move', board: 'A', from: 'e9', to: 'e4' } as any, 100),
      s(0, move('A', 'e2', 'e4'), 200),
      s(1, move('A', 'e7', 'e5'), 100), // an instant in the past
      s(1, move('A', 'e7', 'e5'), 300),
    ],
  },
  // the increment: 2 | 1 gives a second back to each mover
  increment: { options: { timeControl: { initialMs: 120000, incrementMs: 1000 }, startMs: 0 }, steps: [s(0, move('A', 'g1', 'f3'), 2500), s(1, move('A', 'g8', 'f6'), 4000), s(0, move('A', 'f3', 'g1'), 4100)] },
};

export const BUGHOUSE_SCENE_NAMES: readonly string[] = Object.keys(SCENES);

export function recordBughouseScene(name: string): string {
  const script = SCENES[name];
  if (!script) throw new Error(`unknown scene ${name}`);
  let m = scene(script.options);
  const out: string[] = [`scene ${name}`, serializeMatch(m)];
  for (const step of script.steps) m = run(m, step, out);
  out.push(`final ${m.result === null ? 'no result' : JSON.stringify(m.result)}`);
  return out.join('\n') + '\n';
}

/** The seeds replayed by the gate. */
export const BUGHOUSE_GOLDEN_SEEDS: readonly number[] = Array.from({ length: 40 }, (_, i) => 7000 + i * 53);

export function recordAllBughouseGames(): { hashes: Record<string, string>; coverage: GameCoverage } {
  const coverage = emptyGameCoverage();
  const hashes: Record<string, string> = {};
  for (const seed of BUGHOUSE_GOLDEN_SEEDS) hashes[`game:${seed}`] = sha256(recordBughouseGame(seed, 110, coverage));
  return { hashes, coverage };
}

export function recordAllBughouseHashes(): Record<string, string> {
  const result: Record<string, string> = { ...recordAllBughouseGames().hashes };
  for (const name of BUGHOUSE_SCENE_NAMES) result[`scene:${name}`] = sha256(recordBughouseScene(name));
  return result;
}

// `--record`: rewrite the fixture from the CURRENT engine.
if (process.argv.includes('--record') && process.argv[1]?.includes('bughouseGoldenKit')) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { writeFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs');
  mkdirSync(`${__dirname}/fixtures`, { recursive: true });
  writeFileSync(`${__dirname}/fixtures/bughouseGolden.json`, JSON.stringify(recordAllBughouseHashes(), null, 1) + '\n');
  console.log(`recorded ${BUGHOUSE_GOLDEN_SEEDS.length} games + ${BUGHOUSE_SCENE_NAMES.length} scenes`);
}
