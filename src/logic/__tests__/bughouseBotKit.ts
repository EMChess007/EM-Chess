import { BUGHOUSE_TIME_CONTROLS, chooseBughouseAction, conservationProblems, createMatch, seatPlace, settle, type BughouseAction, type BughouseMatch, type BughouseSeat, type BughouseTimeControl } from '../bughouse';
import { mulberry32 } from './bughouseTestKit';

/**
 * A bot arena for Bughouse (W2): four bots (any ELO per seat) play a whole match through the real funnel `settle`, on a SIMULATED clock (each decision "takes" 1-3 s of match time, so a
 * 1-minute control ends in at most a few hundred commits), with every random choice from one seed. Used by the unit tests here and mirrored by backend/scripts/test-bughouse-bot.mjs.
 */
export interface ArenaDecision {
  seat: BughouseSeat;
  elo: number;
  kind: 'move' | 'drop' | 'none';
  /** Wall-clock cost of the decision in ms (reported, never asserted exactly). */
  ms: number;
}

export interface ArenaResult {
  match: BughouseMatch;
  decisions: ArenaDecision[];
  /** Actions the engine refused (must stay 0: a bot only ever plays legal turns). */
  refused: { seat: BughouseSeat; action: BughouseAction; reason: string }[];
  commits: number;
  conservation: string[];
}

export interface ArenaOptions {
  seed: number;
  elos?: [number, number, number, number];
  timeControl?: BughouseTimeControl;
  /** A safety valve for the test itself; a match normally ends long before. */
  maxCommits?: number;
  /** Called with every decision's wall-clock cost; the arena itself asserts nothing about it. */
  timer?: () => number;
  /** How many times each decision is timed (the cost reported is the fastest); default 1. */
  repeat?: number;
}

export function runArena(options: ArenaOptions): ArenaResult {
  const rng = mulberry32(options.seed);
  const elos = options.elos ?? [1200, 1200, 1200, 1200];
  const clock = options.timer ?? (() => Number(process.hrtime.bigint()) / 1e6);
  let match = createMatch({ timeControl: options.timeControl ?? BUGHOUSE_TIME_CONTROLS[0], roomNumber: options.seed, startMs: 0 });
  const decisions: ArenaDecision[] = [];
  const refused: ArenaResult['refused'] = [];
  const maxCommits = options.maxCommits ?? 2000;
  let now = 0;
  for (let guard = 0; match.result === null && guard < maxCommits * 3; guard++) {
    const toMove = ([0, 1, 2, 3] as BughouseSeat[]).filter((s) => match.verdicts[seatPlace(s).board].turn === seatPlace(s).color);
    const seat = toMove[Math.floor(rng() * toMove.length)];
    now += 1000 + Math.floor(rng() * 2000);
    // every decision has its own seeded stream, so the same call can be timed again and gives the same answer: the cost reported is the BEST of `repeat` runs (a busy machine's
    // hiccup is not the bot's cost; the repo's other bot budgets are measured the same way)
    const decisionSeed = (options.seed * 1000003 + decisions.length) >>> 0;
    let action: BughouseAction | null = null;
    let ms = Infinity;
    for (let run = 0; run < (options.repeat ?? 1); run++) {
      const started = clock();
      action = chooseBughouseAction(match, seat, elos[seat], mulberry32(decisionSeed));
      ms = Math.min(ms, clock() - started);
    }
    decisions.push({ seat, elo: elos[seat], kind: action === null ? 'none' : action.kind === 'drop' ? 'drop' : 'move', ms });
    // a bot with nothing to do ("stuck") lets time pass; its clock keeps running and may flag
    const outcome = settle(match, action === null ? null : { seat, action }, now);
    if (outcome.kind === 'rejected') refused.push({ seat, action: action as BughouseAction, reason: outcome.reason });
    else match = outcome.match;
    if (match.seq >= maxCommits) break;
  }
  return { match, decisions, refused, commits: match.seq, conservation: conservationProblems(match) };
}
