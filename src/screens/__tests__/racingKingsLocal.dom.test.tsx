import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../../App';
import { tapMove } from '../../test/domKit';

/**
 * COMMAND #41: the Android smoke's Racing Kings step, rendered. App.tsx itself is mounted (the real navigation), Play -> Racing Kings (the Local row) -> "5 min" is pressed, and
 * the game screen the app ACTUALLY renders is read: both clocks must say 5:00 and the two taps e2, g3 must play 1.Ng3. Only what is native or does I/O is replaced (as in
 * appPlayEntry.dom.test.tsx). Fake timers: no wall clock is read.
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

/** The Local "Racing Kings" row: the Play menu lists the variant twice (Bots and Local); the smoke taps the one BELOW the "Local" heading, which is the last. */
const localRacingKings = (): HTMLElement => {
  const all = screen.getAllByText('Racing Kings');
  return all[all.length - 1];
};

describe('Local Racing Kings from the real App entry (the Android smoke step)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('5 min opens a game with 5:00 on both clocks, and the two taps e2, g3 play 1.Ng3', async () => {
    render(<App />);
    await flush(50);
    fireEvent.click(screen.getByText('Play'));
    await flush(50);
    fireEvent.click(localRacingKings());
    await flush(50);
    fireEvent.click(screen.getByText('5 min'));
    await flush(50);
    expect(screen.getByText('Black: 5:00')).toBeTruthy();
    expect(screen.getByText('White: 5:00')).toBeTruthy();
    tapMove('e2', 'g3');
    await flush(50);
    expect(screen.getByText(/Last move: Ng3/)).toBeTruthy();
  });
});
