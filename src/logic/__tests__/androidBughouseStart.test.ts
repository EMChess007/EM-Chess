import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUGHOUSE_SETUP_PRESETS, deriveBughouseLayout, presetSeatConfig } from '../bughouseLayout';
import { EXTRA_SCREENS } from '../../../scripts/browser/android-matrix-screens-extra.mjs';
import { JUDGED_BUGHOUSE_SCREENS, START_PLACEMENT, boardIsBotsOnly, boardWaitsForHumans, botSeatsOf, bughouseStartVerdict, isStartFen, plyOfFen } from '../../../scripts/android/lib/bughouseJudge.mjs';

/**
 * Command #67e (PR #51 head f84902c, job 136874638663 "emulator (small-screens-1)", "screen bughouse-game-passplay"): "14 days" tapped at 14:40:30, the pieces read 51 s later, the game had
 * ended by mate on board B (bots, move 44). The judged Bughouse games are judged at their start; the seats that make that possible are pinned here.
 */
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MATED_B = '6nr/p5k1/5p2/p1b2K1p/3nPP1P/3r4/8/8 w - - 2 44';

describe('judged Bughouse screens (command #67e)', () => {
  it('are exactly single, passplay and dual, with the presets their steps tap and the humans those presets make', () => {
    expect(Object.keys(JUDGED_BUGHOUSE_SCREENS).sort()).toEqual(['bughouse-game-dual', 'bughouse-game-passplay', 'bughouse-game-single']);
    expect(JUDGED_BUGHOUSE_SCREENS['bughouse-game-single']).toEqual({ preset: 'solo', humans: [0] });
    expect(JUDGED_BUGHOUSE_SCREENS['bughouse-game-passplay']).toEqual({ preset: 'opponents', humans: [0, 1] });
    expect(JUDGED_BUGHOUSE_SCREENS['bughouse-game-dual']).toEqual({ preset: 'four', humans: [0, 1, 2, 3] });
    for (const [id, judged] of Object.entries(JUDGED_BUGHOUSE_SCREENS)) {
      const screen = EXTRA_SCREENS.find((s: { id: string }) => s.id === id)!;
      expect(screen, id).toBeDefined();
      expect(screen.steps).toContainEqual({ id: `preset-${judged.preset}` });
      expect(screen.pieces?.mode).toBe('bw');
      // the time-control tap is the LAST step: the driver makes it itself (startJudgedBughouse)
      expect(screen.steps[screen.steps.length - 1]).toEqual({ text: '14 days' });
      const preset = BUGHOUSE_SETUP_PRESETS.find((p) => p.id === judged.preset);
      expect([...preset!.humans]).toEqual([...judged.humans]);
    }
  });

  it('dual is ALL-HUMAN: no seat is a bot, nothing moves until the harness moves', () => {
    const dual = JUDGED_BUGHOUSE_SCREENS['bughouse-game-dual'];
    expect(botSeatsOf(dual.humans)).toEqual([]);
    expect(presetSeatConfig('four').every((c) => c.kind === 'human')).toBe(true);
    expect(boardWaitsForHumans(dual.humans, 'A')).toBe(true);
    expect(boardWaitsForHumans(dual.humans, 'B')).toBe(true);
  });

  it('single and passplay cannot be all-human (the layout follows the humans): every human seat makes them the dual screen', () => {
    expect(deriveBughouseLayout(presetSeatConfig('solo')).kind).toBe('standard');
    expect(deriveBughouseLayout(presetSeatConfig('opponents')).kind).toBe('passAndPlay');
    expect(deriveBughouseLayout(presetSeatConfig('four')).kind).toBe('dual');
    // so their board A (White human) waits for the harness, and board B is played by bots only
    for (const id of ['bughouse-game-single', 'bughouse-game-passplay'] as const) {
      const { humans } = JUDGED_BUGHOUSE_SCREENS[id];
      expect(boardWaitsForHumans(humans, 'A'), id).toBe(true);
      expect(boardWaitsForHumans(humans, 'B'), id).toBe(false);
      expect(boardIsBotsOnly(humans, 'B'), id).toBe(true);
    }
  });

  it('reads the start position and the ply from a FEN', () => {
    expect(START_PLACEMENT).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
    expect(isStartFen(START)).toBe(true);
    expect(isStartFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR[] w KQkq - 0 1')).toBe(true);
    expect(isStartFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')).toBe(false);
    expect(isStartFen(null)).toBe(false);
    expect(plyOfFen(START)).toBe(0);
    expect(plyOfFen(MATED_B)).toBe(86);
    expect(plyOfFen('x y')).toBeNull();
  });

  it('the CI failure: board A at the start and board B played on by bots is judged (a note), never "game moved"', () => {
    const v = bughouseStartVerdict({ screenId: 'bughouse-game-passplay', fens: { A: START, B: MATED_B } });
    expect(v.issues).toEqual([]);
    expect(v.notes).toEqual(['board B is played by bots only (ply 86 at its first report): its pieces are judged from the cells that stood still across the photograph']);
  });

  it('a board that waits for the harness but has moved: "game moved before judging"', () => {
    const moved = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(bughouseStartVerdict({ screenId: 'bughouse-game-single', fens: { A: moved, B: START } }).issues).toEqual([
      `game moved before judging: board A reports ply 1 ("${moved}"), not the start position - nothing moves there before the harness does`,
    ]);
    expect(bughouseStartVerdict({ screenId: 'bughouse-game-dual', fens: { A: START, B: moved } }).issues[0]).toMatch(/^game moved before judging: board B reports ply 1/);
    expect(bughouseStartVerdict({ screenId: 'bughouse-game-dual', fens: { A: START, B: START } })).toEqual({ issues: [], notes: [], boards: expect.any(Array) });
    expect(bughouseStartVerdict({ screenId: 'bughouse-game-single', fens: { A: null, B: START } }).issues).toEqual(['board A reported no position after the game started']);
    expect(() => bughouseStartVerdict({ screenId: 'game-2p', fens: {} })).toThrow(RangeError);
  });

  it('the driver starts those games itself and judges them at once (no settled-tree wait on the time-control tap)', () => {
    const e2e = readFileSync(join(__dirname, '../../../scripts/android/e2e.mjs'), 'utf8');
    expect(e2e).toContain("const judgedBughouse = Boolean(JUDGED_BUGHOUSE_SCREENS[s.id]) && s.pieces?.mode === 'bw';");
    expect(e2e).toContain('await dev.runSteps(s.steps.slice(0, -1).map(phoneStep));');
    expect(e2e).toContain('await startJudgedBughouse(dev, s.steps[s.steps.length - 1]);');
    expect(e2e).toContain('verdict = judgedBughouse ? await judgeBughouseStart(dev, s) : await judgeGamePieces(dev, s);');
    const start = e2e.slice(e2e.indexOf('async function startJudgedBughouse('), e2e.indexOf('async function judgeBughouseStart('));
    expect(start).toContain('await dev.tapApp(');
    expect(start).not.toContain('tapStep');
    expect(start).not.toContain('runSteps');
    const judge = e2e.slice(e2e.indexOf('async function judgeBughouseStart('), e2e.indexOf('async function screens('));
    expect(judge).toContain('bughouseStartVerdict({ screenId: screen.id, fens })');
    expect(judge).not.toContain('dev.dump(');
    expect(judge).not.toContain('dev.look(');
  });
});
