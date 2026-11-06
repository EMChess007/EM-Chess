import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from '../../../App';

/**
 * THE REAL NAVIGATION ENTRY (command #37): App.tsx itself is mounted, the Play button on Home is pressed, and the screen the app ACTUALLY renders is read. The other rendered tests mount
 * PlayModeSelectScreen directly, so they could pass while App rendered something else (or while a build shipped an old menu); this one cannot.
 * Only what is native or does I/O is replaced: the socket, the server client, the secure storage, the sentry reporter, the navigation bar and the status bar.
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

describe('App -> Play (the real entry)', () => {
  it('shows the 4 Player Variations card with Crazy Bughouse, and none of the old Bughouse / Chaturaji cards or "Play with a friend"', async () => {
    render(<App />);
    fireEvent.click(await screen.findByText('Play', {}, { timeout: 10_000 }));
    await waitFor(() => expect(screen.queryAllByText('4 Player Variations')).toHaveLength(1), { timeout: 10_000 });
    expect(screen.getByLabelText('Crazy Bughouse')).toBeTruthy();
    expect(screen.queryAllByText('Crazy Bughouse').length).toBeGreaterThan(0);
    expect(screen.queryByText('Play with a friend')).toBeNull();
    expect(screen.queryByText('Join with a code')).toBeNull();
    for (const gone of ['chaturaji-card', 'bughouse-card', 'bughouse-friend-button', 'bughouse-join-button']) expect(screen.queryByTestId(gone), gone).toBeNull();
  });
});
