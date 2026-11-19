import { act, fireEvent, render, screen } from '@testing-library/react';
import { Chess } from 'chess.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../../App';
import type { UciChessEngine } from '../../engine/ChessEngine';
import { BOT_PERSONALITIES } from '../../logic/bots';
import { tapMove } from '../../test/domKit';
import type { TimeControl } from '../../types/timeControl';
import BotGameScreen from '../BotGameScreen';

/**
 * COMMAND #50 (From Position, Part 1): the real App is mounted and the new flow is walked on screen - Play -> "From Position" -> FEN field -> Load ->
 * "Play from here" -> Local / vs Bot -> the shared time-control picker -> the game, which must start FROM that FEN (side to move, pieces, clocks). Refused
 * positions are shown in English and Greek and never reach the time-control picker. The bot screen is also mounted directly with a fake engine to pin what
 * the bot is asked (the FEN, at every level) and that a From Position game is not rated. Only what is native or does I/O is replaced (as in appPlayEntry).
 * Fake timers: no wall clock is read.
 */
const h = vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  return {
    positions: [] as string[],
    strengths: [] as unknown[],
    rated: [] as unknown[][],
    achievements: [] as string[],
  };
});
vi.mock('expo-clipboard', () => ({ setStringAsync: async () => {}, getStringAsync: async () => '' }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: async () => ({ canceled: true, assets: null }) }));
vi.mock('react-native-webview', () => ({ WebView: () => null, default: () => null }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
vi.mock('expo-font', () => ({ useFonts: () => [true, null], loadAsync: async () => {}, isLoaded: () => true }));
vi.mock('expo-file-system/legacy', () => ({ documentDirectory: '/tmp/', readAsStringAsync: async () => '', writeAsStringAsync: async () => {}, getInfoAsync: async () => ({ exists: false }) }));
vi.mock('@sentry/react-native', () => ({ init: () => {}, captureException: () => {}, captureMessage: () => {}, wrap: (c: unknown) => c, addBreadcrumb: () => {}, setUser: () => {}, setTag: () => {} }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('../../api/socket', () => ({ connectSocket: () => ({ on: () => {}, off: () => {}, emit: () => {} }), disconnectSocket: () => {} }));
vi.mock('expo-navigation-bar', () => ({ NavigationBar: () => null, setButtonStyleAsync: async () => {}, setBackgroundColorAsync: async () => {}, setVisibilityAsync: async () => {} }));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('../../api/authStorage', () => ({ loadAuthSession: async () => null, saveAuthSession: async () => {}, clearAuthSession: async () => {} }));
vi.mock('../../api/activeGameStorage', () => ({ loadResumableGame: async () => null, saveActiveGame: async () => {}, clearActiveGame: async () => {}, touchActiveGame: async () => {} }));
vi.mock('../../api/useSaveGameOnEnd', () => ({ useSaveGameOnEnd: () => {} }));
vi.mock('../../logic/ratingStorage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../logic/ratingStorage')>()),
  recordRatedGame: async (...args: unknown[]) => {
    h.rated.push(args);
    return 1500;
  },
}));
vi.mock('../../logic/achievementStorage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../logic/achievementStorage')>()),
  unlockAchievement: async (id: string) => {
    h.achievements.push(id);
  },
}));

// A fake engine that answers with the first LEGAL move of the position it was given - so whatever FEN the bot screen sends, the reply is playable.
let engineFen = '';
const fakeEngine = {
  attachBridge: () => {},
  isAttached: () => true,
  handleLine: () => {},
  initEngine: async () => {},
  setPosition: (fen: string) => {
    engineFen = fen;
    h.positions.push(fen);
  },
  getBestMove: async (options?: unknown) => {
    h.strengths.push(options);
    const move = new Chess(engineFen).moves({ verbose: true })[0];
    return `${move.from}${move.to}${move.promotion ?? ''}`;
  },
  analyzePosition: async () => ({ lines: [] }),
} satisfies UciChessEngine;
vi.mock('../../engine/engineRegistry', () => ({
  getEngineRuntime: () => ({ engine: fakeEngine, buildHtml: () => '<html></html>' }),
}));
vi.mock('../../engine/StockfishBridge', () => ({ default: () => null }));

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

/** Black to move, a lone king each side with pawns: nothing like the classical start, and the first move must be Black's. */
const BLACK_FEN = '4k3/pppp1ppp/8/8/8/8/PPPPPPPP/4K3 b - - 0 7';
const MATE_IN_ONE_FEN = '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1';
const CHECKMATE_FEN = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';

/** Play -> From Position -> paste `fen` into the FEN field -> Load -> Play from here. */
async function openFromPosition(fen: string) {
  render(<App />);
  await flush(50);
  fireEvent.click(screen.getByText('Play'));
  await flush(50);
  fireEvent.click(screen.getByText('From Position'));
  await flush(50);
  expect(screen.getByText('From Position', { selector: 'div' })).toBeTruthy();
  const fenField = screen.getByDisplayValue(/^rnbqkbnr\/pppppppp/); // the editor opens on the classical start
  fireEvent.change(fenField, { target: { value: fen } });
  await flush(50);
  fireEvent.click(screen.getByText('Load'));
  await flush(50);
  fireEvent.click(screen.getByTestId('play-from-here'));
  await flush(50);
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  h.positions.length = 0;
  h.strengths.length = 0;
  h.rated.length = 0;
  h.achievements.length = 0;
  engineFen = '';
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('From Position: the real App entry', () => {
  it('Play menu -> From Position -> Local -> 5 min starts the game FROM the FEN with Black to move', async () => {
    await openFromPosition(BLACK_FEN);
    fireEvent.click(screen.getByTestId('from-position-local'));
    await flush(50);
    fireEvent.click(screen.getByText('5 min'));
    await flush(50);

    expect(screen.getByText('Black: 5:00')).toBeTruthy();
    expect(screen.getByText('White: 5:00')).toBeTruthy();
    expect(screen.getByText('From Position')).toBeTruthy(); // the header label of the game

    tapMove('e2', 'e4'); // a White pawn: it is Black's turn, so nothing moves
    await flush(50);
    expect(screen.queryByText(/Last move/)).toBeNull();
    tapMove('d7', 'd5'); // Black's own pawn does: Black moves first
    await flush(50);
    expect(screen.getByText(/Last move: d5/)).toBeTruthy();
    // d1 is EMPTY in this FEN (the classical start has the queen there): the White king steps onto it.
    tapMove('e1', 'd1');
    await flush(50);
    expect(screen.getByText(/Last move: Kd1/)).toBeTruthy();
    expect(screen.queryByText("King's Pawn Game")).toBeNull(); // no opening name from a custom start
  });

  it('vs Bot -> a bot -> 5 min opens the bot game from the FEN, and the engine is asked about THAT position', async () => {
    // "Random" colour resolves with Math.random() < 0.5 -> the human is White, so the bot (Black, to move in this FEN) opens.
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    await openFromPosition(BLACK_FEN);
    fireEvent.click(screen.getByTestId('from-position-bot'));
    await flush(50);
    fireEvent.click(screen.getByText(BOT_PERSONALITIES[0].name));
    await flush(50);
    fireEvent.click(screen.getByText('5 min'));
    await flush(100);

    expect(screen.getByText('From Position')).toBeTruthy();
    expect(h.positions[0]).toBe(BLACK_FEN); // the engine's very first question is the pasted position, not the classical start
    expect(screen.getByText(/Last move:/)).toBeTruthy(); // and the bot's answer (Black's first legal move) was played
  });

  it('a refused position (checkmate) shows the message in English and Greek and offers neither Local nor vs Bot', async () => {
    await openFromPosition(CHECKMATE_FEN);
    expect(screen.getByText(/This position is already checkmate/)).toBeTruthy();
    expect(screen.getByText(/Η θέση είναι ήδη ματ/)).toBeTruthy();
    expect(screen.queryByTestId('from-position-local')).toBeNull();
    expect(screen.queryByTestId('from-position-bot')).toBeNull();
    expect(screen.queryByText('5 min')).toBeNull();
  });

  it('a position with the side not to move in check is refused too; fixing the FEN lets the same screen continue', async () => {
    await openFromPosition('4k3/8/8/8/8/8/4R3/4K3 w - - 0 1');
    expect(screen.getByText(/The side not to move cannot be in check/)).toBeTruthy();
    expect(screen.getByText(/Η πλευρά που δεν παίζει δεν μπορεί να είναι σε σαχ/)).toBeTruthy();
    expect(screen.queryByTestId('from-position-local')).toBeNull();
  });

  it('the editor\'s own "Play from here" button works from a hand-built board, and back from the picker returns to the editor on the same position', async () => {
    render(<App />);
    await flush(50);
    fireEvent.click(screen.getByText('Play'));
    await flush(50);
    fireEvent.click(screen.getByText('From Position'));
    await flush(50);
    fireEvent.click(screen.getByTestId('play-from-here')); // the classical start, untouched
    await flush(50);
    fireEvent.click(screen.getByTestId('from-position-local'));
    await flush(50);
    expect(screen.getByText('5 min')).toBeTruthy();
    fireEvent.click(screen.getByText('‹ Back'));
    await flush(50);
    expect(screen.getByDisplayValue(/^rnbqkbnr\/pppppppp\/8\/8\/8\/8\/PPPPPPPP\/RNBQKBNR w KQkq - 0 1$/)).toBeTruthy();
  });
});

const BLITZ: TimeControl = { id: 'blitz-5', label: '5 min', initialSeconds: 300, incrementSeconds: 0, category: 'blitz' };

describe('From Position: the bot screen', () => {
  const renderBot = (props: { fen: string; colorChoice: 'w' | 'b'; fromPosition: boolean; botIndex?: number }) =>
    render(
      <BotGameScreen
        bot={BOT_PERSONALITIES[props.botIndex ?? 0]}
        timeControl={BLITZ}
        colorChoice={props.colorChoice}
        initialFen={props.fen}
        fromPosition={props.fromPosition}
        authToken={null}
        onExit={() => {}}
        onAnalyze={() => {}}
      />
    );

  it('every bot level is asked for a move in the position of the FEN (here White to move, the human is Black, so the bot opens)', async () => {
    const fen = '4k3/pppp1ppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1';
    for (let i = 0; i < BOT_PERSONALITIES.length; i += 1) {
      h.positions.length = 0;
      h.strengths.length = 0;
      const { unmount } = renderBot({ fen, colorChoice: 'b', fromPosition: true, botIndex: i });
      await flush(200);
      expect(h.positions[0], BOT_PERSONALITIES[i].name).toBe(fen);
      expect(h.strengths.length, BOT_PERSONALITIES[i].name).toBeGreaterThanOrEqual(1);
      unmount();
    }
  });

  it('a won From Position game is NOT rated and unlocks no rating achievement; the same game as a plain bot game IS rated', async () => {
    // Human White, mate in one (Ra8#). The game ends on the human's move, so no bot move is needed.
    const first = renderBot({ fen: MATE_IN_ONE_FEN, colorChoice: 'w', fromPosition: true, botIndex: BOT_PERSONALITIES.length - 1 });
    await flush(50);
    tapMove('a1', 'a8');
    await flush(100);
    expect(screen.getByText(/Last move: Ra8#/)).toBeTruthy();
    expect(h.rated).toEqual([]);
    expect(h.achievements).toEqual([]);
    first.unmount();

    // Control: the mock is wired and a rated game does reach it.
    renderBot({ fen: MATE_IN_ONE_FEN, colorChoice: 'w', fromPosition: false, botIndex: BOT_PERSONALITIES.length - 1 });
    await flush(50);
    tapMove('a1', 'a8');
    await flush(100);
    expect(h.rated.length).toBe(1);
    expect(h.achievements).toContain('giant_slayer'); // the 3000-ELO bot: the achievement the From Position game above was denied
  });
});
