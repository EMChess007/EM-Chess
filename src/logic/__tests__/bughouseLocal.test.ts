import { describe, expect, it } from 'vitest';
import { applyAction, chooseBughouseAction, type BughouseMatch } from '../bughouse';
import { bughouseBotThinkMs, dueBotSeats, localBotAction, localStep, nextDeadline, startLocalGame } from '../bughouseLocal';
import { gameOverSummary } from '../bughouseView';
import type { SeatConfig, SeatController } from '../fourPlayer/setup';
import { mulberry32 } from './bughouseTestKit';
import { drop, move, scene, START } from './bughouseScenes';

/**
 * BUGHOUSE W3a - the state of a Local game: every input through the engine's funnel at one integer instant, the last move of each board, the capture that fed a pocket, the flag timer,
 * the bots' due seats and pace. No clock is read: every instant is passed in.
 */
const H: SeatController = { kind: 'human' };
const B = (elo = 1200): SeatController => ({ kind: 'bot', elo });
const cfg = (a: string): SeatConfig => [a[0] === 'H' ? H : B(), a[1] === 'H' ? H : B(), a[2] === 'H' ? H : B(), a[3] === 'H' ? H : B()];
const TC = { initialMs: 180000, incrementMs: 0 };

describe('a local game through the engine\'s funnel', () => {
  it('starts with both White clocks running at the start instant and nothing highlighted', () => {
    const g = startLocalGame(TC, 5000, 7);
    expect(g.match.nowMs).toBe(5000);
    expect(g.match.roomNumber).toBe(7);
    expect(g.match.clocks.map((c) => c.runningSince)).toEqual([5000, null, 5000, null]);
    expect(g.lastMove).toEqual({ A: null, B: null });
    expect(g.bank).toBeNull();
  });

  it('a move is applied, remembered as the board\'s last move, and does not touch the other board\'s', () => {
    const g = startLocalGame(TC, 0, 0);
    const step = localStep(g, { seat: 0, action: move('A', 'e2', 'e4') }, 1000);
    expect(step.outcome.kind).toBe('applied');
    expect(step.state.match.seq).toBe(1);
    expect(step.state.lastMove).toEqual({ A: { from: 'e2', to: 'e4' }, B: null });
    const second = localStep(step.state, { seat: 2, action: move('B', 'd2', 'd4') }, 2000);
    expect(second.state.lastMove).toEqual({ A: { from: 'e2', to: 'e4' }, B: { from: 'd2', to: 'd4' } });
  });

  it('a capture banks the piece for the capturer\'s PARTNER on the other board, and the flash names that seat and piece', () => {
    const m = scene({ a: 'k7/8/8/3p4/4P3/8/8/K7 w - - 0 1', b: START, startMs: 0 });
    const g = { ...startLocalGame(TC, 0, 0), match: m };
    const step = localStep(g, { seat: 0, action: move('A', 'e4', 'd5') }, 100);
    expect(step.state.bank).toEqual({ seat: 3, piece: 'p', seq: 1 });
    expect(step.state.match.pockets[3].p).toBe(1);
    // a quiet move keeps the old flash (the screen shows it only while its seq is the match's)
    const quiet = localStep(step.state, { seat: 1, action: move('A', 'a8', 'b8') }, 200);
    expect(quiet.state.bank).toEqual({ seat: 3, piece: 'p', seq: 1 });
    expect(quiet.state.match.seq).toBe(2);
  });

  it('a drop is the board\'s last move on its own square', () => {
    const m = scene({ a: 'k7/8/8/8/8/8/8/K7 w - - 0 1', b: START, startMs: 0, pockets: { 0: { n: 1 } } });
    const step = localStep({ ...startLocalGame(TC, 0, 0), match: m }, { seat: 0, action: drop('A', 'n', 'e4') }, 100);
    expect(step.outcome.kind).toBe('applied');
    expect(step.state.lastMove.A).toEqual({ from: 'e4', to: 'e4' });
    expect(step.state.match.pockets[0].n).toBe(0);
  });

  it('a refused input returns the very same state (no seq, no time)', () => {
    const g = startLocalGame(TC, 0, 0);
    for (const input of [{ seat: 1 as const, action: move('A', 'e7', 'e5') }, { seat: 0 as const, action: move('A', 'e2', 'e5') }, { seat: 0 as const, action: drop('A', 'n', 'e4') }]) {
      const step = localStep(g, input, 500);
      expect(step.outcome.kind).toBe('rejected');
      expect(step.state).toBe(g);
    }
  });

  it('an instant behind the match is raised to the match\'s own (a clock that reads a hair late cannot wedge the game)', () => {
    const g = startLocalGame(TC, 5000, 0);
    const step = localStep(g, { seat: 0, action: move('A', 'e2', 'e4') }, 4000);
    expect(step.outcome.kind).toBe('applied');
    expect(step.state.match.nowMs).toBe(5000);
  });

  it('the Local clock settles flags first (no draws): a timer at the earliest deadline ends the match by flag; the move that arrives too late is discarded', () => {
    const g = startLocalGame(TC, 0, 0);
    expect(nextDeadline(g.match)).toBe(180000);
    const early = localStep(g, null, 179999);
    expect(early.outcome.kind).toBe('idle');
    expect(early.state).toBe(g);
    const flagged = localStep(g, null, 180000);
    expect(flagged.outcome.kind).toBe('flag');
    expect(flagged.state.match.result).toMatchObject({ reason: 'flag', winnerTeam: expect.any(Number) });
    expect(nextDeadline(flagged.state.match)).toBeNull();
    const late = localStep(g, { seat: 0, action: move('A', 'e2', 'e4') }, 180000);
    expect(late.outcome.kind).toBe('flag');
    expect(late.state.lastMove).toEqual({ A: null, B: null });
    // the tie-break: seats 0 and 2 both flag at 180000 with the same start seq; room 0 (even) makes board A lose, room 1 board B
    expect(gameOverSummary(flagged.state.match)).toMatchObject({ decidingBoard: 'A', loserSeat: 0, winnerTeam: 2 });
    expect(gameOverSummary(localStep(startLocalGame(TC, 0, 1), null, 180000).state.match)).toMatchObject({ decidingBoard: 'B', loserSeat: 2, winnerTeam: 1 });
  });

  it('the next deadline is the earliest running clock', () => {
    const m = scene({ a: START, b: START, startMs: 1000, clocks: { 2: { remainingMs: 30000 } } });
    expect(nextDeadline(m)).toBe(31000);
  });
});

describe('the bots', () => {
  it('think 200 ms in bullet (up to 2 | 1) and 450 ms above, like the server\'s', () => {
    expect([60000, 120000, 120001, 180000, 300000].map(bughouseBotThinkMs)).toEqual([200, 200, 450, 450, 450]);
  });

  it('the due seats are the bot seats on move, at most one per board, none when stuck or over', () => {
    const start = scene({ a: START, b: START });
    expect(dueBotSeats(cfg('HBBB'), start)).toEqual([2]); // A White is the human; B White is a bot
    expect(dueBotSeats(cfg('BBBB'), start)).toEqual([0, 2]);
    expect(dueBotSeats(cfg('HHHH'), start)).toEqual([]);
    const stuck = scene({ a: 'R6k/6pp/8/8/8/8/8/K7 b - - 0 1', b: START });
    expect(dueBotSeats(cfg('BBBB'), stuck)).toEqual([2]); // seat 1 is stuck: it waits for a pocket
    const over = { ...start, result: { winnerTeam: 1 as const, reason: 'resign' as const, board: 'A' as const, loserSeat: 1 as const } };
    expect(dueBotSeats(cfg('BBBB'), over)).toEqual([]);
  });

  it('a bot seat answers with a legal action for the seat; a human seat answers nothing', () => {
    const start = scene({ a: START, b: START });
    const rng = mulberry32(5);
    const action = localBotAction(cfg('BBBB'), start, 0, rng);
    expect(action).not.toBeNull();
    expect(applyAction(start, 0, action!, start.nowMs).ok).toBe(true);
    expect(localBotAction(cfg('HBBB'), start, 0, mulberry32(5))).toBeNull();
  });

  it('the bot plays at the seat\'s own ELO: a strong seat takes the free queen, with a stream a weak seat would spend on a random move', () => {
    const m = scene({ a: 'k7/8/8/3q4/4P3/8/8/K7 w - - 0 1', b: START, startMs: 0 });
    const half = () => 0.5; // above the weak dial's chance, below the strong dial's
    const strong: SeatConfig = [{ kind: 'bot', elo: 3000 }, B(), B(), B()];
    const weak: SeatConfig = [{ kind: 'bot', elo: 400 }, B(), B(), B()];
    expect(localBotAction(strong, m, 0, half)).toEqual({ kind: 'move', board: 'A', from: 'e4', to: 'd5' });
    expect(localBotAction(strong, m, 0, half)).toEqual(chooseBughouseAction(m, 0, 3000, half));
    expect(localBotAction(weak, m, 0, half)).toEqual(chooseBughouseAction(m, 0, 400, half));
    expect(localBotAction(weak, m, 0, half)).not.toEqual({ kind: 'move', board: 'A', from: 'e4', to: 'd5' });
  });

  it('four bots play a whole match to its end through the Local funnel (seeded; every action accepted; ends by a result)', () => {
    const rng = mulberry32(2024);
    const seats = cfg('BBBB');
    let state = startLocalGame({ initialMs: 60000, incrementMs: 0 }, 0, 0);
    let now = 0;
    let steps = 0;
    while (state.match.result === null && steps < 3000) {
      steps++;
      const due = dueBotSeats(seats, state.match);
      if (due.length === 0) {
        // everyone on move is stuck: time passes until a flag falls
        now = nextDeadline(state.match) ?? now + 1000;
        state = localStep(state, null, now).state;
        continue;
      }
      now += 400;
      const seat = due[Math.floor(rng() * due.length)];
      const action = localBotAction(seats, state.match, seat, rng);
      if (action === null) {
        now = Math.max(now, nextDeadline(state.match) ?? now);
        state = localStep(state, null, now).state;
        continue;
      }
      const step = localStep(state, { seat, action }, now);
      expect(['applied', 'flag'], `step ${steps}`).toContain(step.outcome.kind);
      state = step.state;
    }
    const match = state.match as BughouseMatch;
    expect(match.result).not.toBeNull();
    expect(gameOverSummary(match)).not.toBeNull();
    expect(match.seq).toBeGreaterThan(10);
  });
});
