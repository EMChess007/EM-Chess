import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { HEURISTIC_BOT_LABELS, heuristicBotLabel } from '../heuristicBots';

const SRC = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');

/** Command #68: the heuristic-bot table follows BotGameScreen's wiring, it is not a guess. */
describe('heuristicBots: the table of variants whose bot is not a UCI engine', () => {
  it('lists exactly the variants BotGameScreen plays with a choose<Variant>BotMove call (Spell Chess is Stockfish + a cast heuristic)', () => {
    const game = read('screens/BotGameScreen.tsx');
    const wired = [...game.matchAll(/choose(\w+)BotMove\(moveEngine/g)].map((match) => match[1]);
    const camel = (name: string) => name[0].toLowerCase() + name.slice(1);
    // BotGameScreen calls them by display name; the flags are camelCase ('Duck' -> duckChess).
    const asFlag = wired.map((name) => (name === 'Duck' ? 'duckChess' : camel(name))).sort();
    expect(asFlag).toEqual(Object.keys(HEURISTIC_BOT_LABELS).sort());
    expect(asFlag).toEqual(['atomic', 'crazyhouse', 'duckChess', 'giveaway', 'horde', 'knightmate', 'racingKings', 'torpedo']);
    expect(game).not.toMatch(/chooseSpellChessBotMove/);
  });

  it('labels (literals)', () => {
    expect(heuristicBotLabel({ giveaway: true })).toBe('Giveaway bot');
    expect(heuristicBotLabel({ atomic: true })).toBe('Atomic search bot');
    expect(heuristicBotLabel({ duckChess: true })).toBe('Duck Chess bot');
    expect(heuristicBotLabel({ horde: true })).toBe('Horde bot');
    expect(heuristicBotLabel({ racingKings: true })).toBe('Racing Kings bot');
    expect(heuristicBotLabel({ torpedo: true })).toBe('Torpedo bot');
    expect(heuristicBotLabel({ knightmate: true })).toBe('Knightmate bot');
    expect(heuristicBotLabel({ crazyhouse: true })).toBe('Crazyhouse bot');
  });

  it('a UCI-engine variant (no flag, or all false) has no heuristic label', () => {
    expect(heuristicBotLabel({})).toBeUndefined();
    expect(heuristicBotLabel({ giveaway: false, atomic: undefined })).toBeUndefined();
  });

  it('BotSelectScreen uses the shared table for both the label and the custom-engine section (no per-variant conditionals)', () => {
    const screen = read('screens/BotSelectScreen.tsx');
    expect(screen).toContain('{engineLabel ?? heuristicLabel ?? getEngineName(getEngineIdForElo(bot.elo))}');
    expect(screen).toContain('{customEngines.length > 0 && !engineLabel && !heuristicLabel && (');
    expect(screen).not.toMatch(/\? '[A-Za-z ]+ bot'/);
  });
});
