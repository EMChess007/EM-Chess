import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addCustomEngineOption, removeCustomEngineOption } from '../../logic/engines';
import BotSelectScreen from '../BotSelectScreen';

/**
 * Command #68 (TODO "Giveaway bot picker still says Stockfish 11"): a variant whose bot is a heuristic (BotGameScreen's choose<Variant>BotMove,
 * heuristicBots.ts) shows that bot's own name on every card, never "Stockfish", and offers no "My Engines" card (a UCI engine is never asked for
 * a move there). Classic keeps both. Labels are LITERALS here, not read from the table under test.
 */
const HEURISTIC_CASES: Array<[string, Record<string, boolean>, string]> = [
  ['Giveaway', { giveaway: true }, 'Giveaway bot'],
  ['Atomic', { atomic: true }, 'Atomic search bot'],
  ['Duck Chess', { duckChess: true }, 'Duck Chess bot'],
  ['Horde', { horde: true }, 'Horde bot'],
  ['Racing Kings', { racingKings: true }, 'Racing Kings bot'],
  ['Torpedo', { torpedo: true }, 'Torpedo bot'],
  ['Knightmate', { knightmate: true }, 'Knightmate bot'],
  ['Crazyhouse', { crazyhouse: true }, 'Crazyhouse bot'],
];

const CUSTOM_ID = 'custom-test-engine-68';

describe('BotSelectScreen: honest bot labels for heuristic-bot variants', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    addCustomEngineOption({ id: CUSTOM_ID, name: 'My Test Engine', isCustom: true } as Parameters<typeof addCustomEngineOption>[0]);
  });
  afterEach(() => {
    removeCustomEngineOption(CUSTOM_ID);
    vi.useRealTimers();
  });

  it.each(HEURISTIC_CASES)('%s: every card names its own bot, no "Stockfish" anywhere, no custom-engine card', (_name, flags, label) => {
    render(<BotSelectScreen onSelect={() => {}} onBack={() => {}} {...flags} />);
    expect(screen.queryAllByText(/Stockfish/)).toHaveLength(0);
    expect(screen.getAllByText(label).length).toBeGreaterThan(1);
    expect(screen.queryByText('My Engines')).toBeNull();
    expect(screen.queryByText('My Test Engine')).toBeNull();
    expect(screen.queryByText('Custom engine')).toBeNull();
  });

  it('Classic: the cards name Stockfish and the custom-engine card is offered', () => {
    render(<BotSelectScreen onSelect={() => {}} onBack={() => {}} />);
    expect(screen.getAllByText(/Stockfish/).length).toBeGreaterThan(0);
    expect(screen.getByText('My Engines')).toBeTruthy();
    expect(screen.getByText('My Test Engine')).toBeTruthy();
    expect(screen.getByText('Custom engine')).toBeTruthy();
  });

  it('Spell Chess (Stockfish plays the move) keeps the engine names and the custom-engine card', () => {
    render(<BotSelectScreen onSelect={() => {}} onBack={() => {}} spellChess />);
    expect(screen.getAllByText(/Stockfish/).length).toBeGreaterThan(0);
    expect(screen.getByText('My Test Engine')).toBeTruthy();
  });

  it('an explicit engineLabel (4 Player Chess) still wins and hides the custom-engine card', () => {
    render(<BotSelectScreen onSelect={() => {}} onBack={() => {}} engineLabel="4 Player Chess bot" />);
    expect(screen.queryAllByText(/Stockfish/)).toHaveLength(0);
    expect(screen.queryByText('My Test Engine')).toBeNull();
  });
});
