import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { START_FEN } from '../../types/chess';
import type { GameHistoryEntry } from '../../types/history';
import type { TimeControl } from '../../types/timeControl';
import { ChessEngine } from '../ChessEngine';
import { buildGamePayload } from '../gamePayload';
import { updateRating } from '../rating';

// Where a threefold-repetition draw goes after the game ends: the saved history row (result + PGN), the per-category rating and its history,
// achievements, and the history labels. The first threefold release made the SCREENS end the game but forgot buildGamePayload, so a repetition
// draw in Local / Bot was never saved to the history at all (Atomic's old repetition draw, which went through chessStatus, regressed with it).

const timeControl: TimeControl = { id: 'x', label: '10 min', initialSeconds: 600, incrementSeconds: 0, category: 'rapid' };

function shuffleHistory(options = {}): GameHistoryEntry[] {
  const plies: [string, string][] = [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8'], ['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8']];
  const history: GameHistoryEntry[] = [];
  let fen = START_FEN;
  for (const [from, to] of plies) {
    const engine = new ChessEngine(fen, options);
    const move = engine.move(from, to)!;
    history.push({ move, fenBefore: fen, fenAfter: engine.getFen() });
    fen = engine.getFen();
  }
  return history;
}
const base = { chessStatus: 'playing' as const, turn: 'w' as const, timeoutWinner: null, initialFen: START_FEN, chess960: false, timeControl, opponentType: 'bot' as const, opponentElo: 1500 };

describe('the saved game', () => {
  it('a draw by repetition is saved as 1/2-1/2, with the PGN carrying the result', () => {
    const payload = buildGamePayload({ ...base, history: shuffleHistory(), repetitionDraw: true });
    expect(payload).not.toBeNull();
    expect(payload!.result).toBe('1/2-1/2');
    expect(payload!.pgn.trim().endsWith('1/2-1/2')).toBe(true);
    expect(payload!.pgn).toContain('4.Ng1 Ng8 1/2-1/2');
    expect(payload!.timeControl).toBe('10 min');
    expect(payload!.opponentElo).toBe(1500);
  });

  it('without the repetition the same position is simply not over (nothing is saved)', () => {
    expect(buildGamePayload({ ...base, history: shuffleHistory() })).toBeNull();
  });

  it('every variant that counts repetitions saves it the same way (Atomic, Giveaway, Duck, Spell, Horde, Crazyhouse keep their PGN tag)', () => {
    for (const [flag, tag] of [['atomic', 'Atomic'], ['giveaway', 'Antichess'], ['duckChess', 'Duck'], ['spellChess', 'Spell Chess'], ['horde', 'Horde'], ['crazyhouse', 'Crazyhouse']] as const) {
      const payload = buildGamePayload({ ...base, history: shuffleHistory(), repetitionDraw: true, [flag]: true });
      expect(payload?.result).toBe('1/2-1/2');
      expect(payload?.pgn).toContain(`[Variant "${tag}"]`);
    }
  });

  it('a decisive result still beats the repetition in the saved row (resignation)', () => {
    expect(buildGamePayload({ ...base, history: shuffleHistory(), repetitionDraw: true, resignedBy: 'b' })?.result).toBe('1-0');
  });
});

// --- ratings ----------------------------------------------------------------------------------------------------------------
const stored = new Map<string, string>();
const historyEntries: [string, number][] = [];
const syncs: [string, number][] = [];
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    setItem: async (k: string, v: string) => void stored.set(k, v),
    getItem: async (k: string) => stored.get(k) ?? null,
    removeItem: async (k: string) => void stored.delete(k),
  },
}));
vi.mock('../ratingHistoryStorage', () => ({ recordRatingHistoryEntry: async (c: string, r: number) => void historyEntries.push([c, r]) }));
vi.mock('../../api/client', () => ({
  api: {
    updateRating: async (_t: string, c: string, r: number) => {
      syncs.push([c, r]);
    },
  },
}));

describe('ratings: a repetition draw is an ordinary draw (0.5)', () => {
  beforeEach(() => {
    stored.clear();
    historyEntries.length = 0;
    syncs.length = 0;
    vi.resetModules();
  });

  it('a draw against a stronger bot raises the rating, against a weaker one lowers it - exactly the Elo draw formula', async () => {
    const { recordRatedGame, getRatings } = await import('../ratingStorage');
    const start = getRatings().rapid;
    expect(await recordRatedGame('rapid', 1800, 0.5)).toBe(updateRating(start, 1800, 0.5));
    expect(getRatings().rapid).toBeGreaterThan(start);
    const mid = getRatings().rapid;
    expect(await recordRatedGame('rapid', 400, 0.5)).toBe(updateRating(mid, 400, 0.5));
    expect(getRatings().rapid).toBeLessThan(mid);
  });

  it('it lands in the rating history and is synced to the leaderboard like any other result', async () => {
    const { recordRatedGame } = await import('../ratingStorage');
    const next = await recordRatedGame('blitz', 1500, 0.5, 'token');
    expect(historyEntries).toEqual([['blitz', next]]);
    expect(syncs).toEqual([['blitz', next]]);
  });
});

describe('the screens feed it correctly', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8').split('\r\n').join('\n');

  it('Local and Bot save the repetition (buildGamePayload gets repetitionDraw, and re-saves when it changes)', () => {
    for (const screen of ['LocalGameScreen', 'BotGameScreen']) {
      const src = read('screens', `${screen}.tsx`);
      expect(src).toContain('crazyhouse,\n        repetitionDraw,\n        history,\n        initialFen,');
      expect(src).toContain('crazyhouse,\n      repetitionDraw,\n      history,\n      initialFen,');
    }
  });

  it('Bot: the rating result comes from the outcome (a repetition is 1/2-1/2 -> 0.5), and only a WIN can unlock Giant Slayer / Comeback', () => {
    const src = read('screens', 'BotGameScreen.tsx');
    expect(src).toContain("const result = outcome.result === '1/2-1/2' ? 0.5 : winnerColor === userColor ? 1 : 0;");
    expect(src).toContain('if (result === 1 && !giveaway && !atomic && !duckChess && !horde && !crazyhouse) {\n      if (bot.elo >= 2000) unlockAchievement(\'giant_slayer\');');
    expect(src).toContain('recordRatedGame(ratingCategory, bot.elo, result, authToken)');
  });

  it('Online: a game_over with no winner (the server\'s repetition included) is 0.5 and unlocks nothing', () => {
    const src = read('screens', 'OnlineGameScreen.tsx');
    expect(src).toContain('const result = payload.winner === null ? 0.5 : payload.winner === myColor ? 1 : 0;');
    expect(src).toContain("if (result === 1 && wasMaterialDownRef.current && !giveaway");
  });

  it('the history labels read the stored result, so a repetition shows as "Draw"', () => {
    for (const screen of ['GameHistoryScreen', 'HomeScreen']) {
      const src = read('screens', `${screen}.tsx`);
      expect(src).toContain("if (game.result === '1/2-1/2') return 'Draw';");
    }
  });

  it('the streak is an app-open streak - no game result feeds it', () => {
    const src = read('logic', 'streakStorage.ts');
    expect(src).toContain('export async function recordAppOpen');
    expect(src).not.toMatch(/outcome|result|GameResult/);
  });
});
