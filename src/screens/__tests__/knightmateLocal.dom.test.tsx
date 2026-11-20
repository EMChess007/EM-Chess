import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../../App';
import { tapMove } from '../../test/domKit';

/**
 * Knightmate (Local), rendered: App.tsx itself is mounted (the real navigation), Play -> Knightmate (the Local row) -> "5 min", and the board the app ACTUALLY renders draws the
 * royal knight with its crown badge and the Commoners with their "M" badge, offers the royal knight's jumps and lets it play ("Kf3" in the move list). Only what is native or does I/O
 * is replaced (as in torpedoLocal.dom.test.tsx). Fake timers: no wall clock is read.
 */
vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
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

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

/** The Play menu lists Knightmate twice (Bots and Local); the Local row is the last. */
const localKnightmate = (): HTMLElement => {
  const all = screen.getAllByText('Knightmate');
  return all[all.length - 1];
};

async function openLocalGame() {
  render(<App />);
  await flush(50);
  fireEvent.click(screen.getByText('Play'));
  await flush(50);
  fireEvent.click(localKnightmate());
  await flush(50);
  fireEvent.click(screen.getByText('5 min'));
  await flush(50);
}

describe('Local Knightmate from the real App entry', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the menu has Knightmate in both the Bots and the Local row', async () => {
    render(<App />);
    await flush(50);
    fireEvent.click(screen.getByText('Play'));
    await flush(50);
    expect(screen.getAllByText('Knightmate')).toHaveLength(2);
  });

  it('5 min opens the game: 2 royal knights (a crown badge each) and 4 commoners (an "M" badge each), drawn from the theme\'s knight and king', async () => {
    await openLocalGame();
    expect(screen.getByText('White: 5:00')).toBeTruthy();
    const count = (selector: string) => document.querySelectorAll(selector).length;
    expect(count('[data-piece="wk"]')).toBe(1);
    expect(count('[data-piece="bk"]')).toBe(1);
    expect(count('[data-piece="wm"]')).toBe(2);
    expect(count('[data-piece="bm"]')).toBe(2);
    expect(count('[data-piece="wn"]') + count('[data-piece="bn"]')).toBe(0); // there is no ordinary knight
    // A badge per royal knight / commoner, nothing else: the pawns and the other pieces carry none.
    expect(count('[aria-label="crown badge"]')).toBe(2);
    expect(count('[aria-label="commoner badge"]')).toBe(4);
    // The accessibility labels name the pieces for what they are.
    expect(screen.getAllByLabelText('white royal knight')).toHaveLength(1);
    expect(screen.getAllByLabelText('black commoner')).toHaveLength(2);
  });

  it('the royal knight plays e1 -> f3 ("Kf3" in the move list) and a commoner b8 -> a7... after it is free ("Ma7")', async () => {
    await openLocalGame();
    tapMove('e2', 'e4');
    await flush(50);
    tapMove('a7', 'a6');
    await flush(50);
    tapMove('e1', 'f3');
    await flush(50);
    expect(screen.getByText(/Last move: Kf3/)).toBeTruthy();
    tapMove('b8', 'a7');
    await flush(50);
    expect(screen.getByText(/Last move: Ma7/)).toBeTruthy();
    // The pieces moved with their badges: still one crown per side, the commoner now on a7.
    expect(document.querySelectorAll('[aria-label="crown badge"]').length).toBe(2);
    expect(document.querySelectorAll('[aria-label="commoner badge"]').length).toBe(4);
  });
});
