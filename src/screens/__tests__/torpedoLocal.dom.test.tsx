import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../../App';
import { tapMove } from '../../test/domKit';

/**
 * Torpedo (Local), rendered: App.tsx itself is mounted (the real navigation), Play -> Torpedo (the Local row) -> "5 min", and the board the app ACTUALLY renders lets a pawn
 * on the 3rd rank step two squares (the one thing that is new in this variant: the tap e3 -> e5 plays; it would be ignored in standard chess). Only what is native or does I/O is replaced (as in
 * racingKingsLocal.dom.test.tsx). Fake timers: no wall clock is read.
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

/** The Play menu lists Torpedo twice (Bots and Local); the Local row is the last. */
const localTorpedo = (): HTMLElement => {
  const all = screen.getAllByText('Torpedo');
  return all[all.length - 1];
};

describe('Local Torpedo from the real App entry', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the menu has Torpedo in both the Bots and the Local row', async () => {
    render(<App />);
    await flush(50);
    fireEvent.click(screen.getByText('Play'));
    await flush(50);
    expect(screen.getAllByText('Torpedo')).toHaveLength(2);
  });

  it('5 min opens a game; a pawn on the 3rd rank plays the double step e3-e5 (SAN e5)', async () => {
    render(<App />);
    await flush(50);
    fireEvent.click(screen.getByText('Play'));
    await flush(50);
    fireEvent.click(localTorpedo());
    await flush(50);
    fireEvent.click(screen.getByText('5 min'));
    await flush(50);
    expect(screen.getByText('White: 5:00')).toBeTruthy();
    expect(screen.getByText('Black: 5:00')).toBeTruthy();

    tapMove('e2', 'e3');
    await flush(50);
    tapMove('a7', 'a6');
    await flush(50);
    expect(screen.getByText(/Last move: a6/)).toBeTruthy();
    tapMove('e3', 'e5'); // a two-square step from the 3rd rank: an ordinary pawn would not be allowed it
    await flush(50);
    expect(screen.getByText(/Last move: e5/)).toBeTruthy();
  });
});
