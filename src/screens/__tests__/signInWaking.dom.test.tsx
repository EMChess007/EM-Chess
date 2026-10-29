import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginScreen from '../LoginScreen';
import RegisterScreen from '../RegisterScreen';

/**
 * LOG IN / SIGN UP ON A SLOW SERVER, RENDERED AGAINST A REAL SERVER (command #27b). The real client, the real fetch and the real clock, pointed at a real local server
 * (scripts/browser/auth-servers.mjs) that holds each request for 7 s before it answers - the cold start of a free-tier service in miniature (the 40 s and 60 s versions, without a
 * screen, are apiAuthRealServers.test.ts). The screen must show Cancel from the first moment, the "Waking up the server" message after the fifth second, sign in when the answer
 * comes, and treat Cancel as the person's own choice: no error, the request really closed, the form usable again.
 *
 * The wall clock appears only as the bound that turns a hang into a failure; every wait ends on the screen showing its state.
 */
const { server } = await vi.hoisted(async () => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  const { startAuthServer } = await import('../../../scripts/browser/auth-servers.mjs');
  const started = await startAuthServer({});
  process.env.EXPO_PUBLIC_API_URL = started.origin; // honoured because this is a development build (apiBaseUrl.ts)
  return { server: started };
});
vi.mock('expo-constants', () => ({ default: { expoConfig: { hostUri: undefined }, expoGoConfig: undefined } }));
vi.mock('../../logic/diagnosticLog', () => ({ logDiagnostic: vi.fn() }));
vi.mock('../../api/authStorage', () => ({ saveAuthSession: vi.fn(async () => {}) }));

const BOUND_MS = 30000;
const WAKING = 'Waking up the server… this can take up to a minute';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  server.set({});
});
afterAll(async () => {
  await server.close();
});

const type = (placeholder: string, value: string) => fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
/** The last "Log In" is the button (the first is the title). */
const pressLogIn = () => fireEvent.click(screen.getAllByText('Log In').at(-1) as HTMLElement);

describe('Log in', () => {
  it('shows Cancel at once, the waking message after 5 s, and signs in when the server finally answers', async () => {
    server.set({ holdEachMs: 7000 });
    const onSuccess = vi.fn();
    render(<LoginScreen onSuccess={onSuccess} onSwitchToRegister={() => {}} onBack={() => {}} />);
    expect(screen.queryByTestId('signin-cancel')).toBeNull(); // nothing is running yet
    type('Email', 'known@example.com');
    type('Password', 'password-1');
    pressLogIn();
    expect(screen.getByTestId('signin-cancel')).toBeTruthy();
    expect(screen.queryByTestId('signin-waking')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('signin-waking')).toBeTruthy(), { timeout: BOUND_MS });
    expect(screen.getByTestId('signin-waking').textContent).toBe(WAKING);
    expect(onSuccess).not.toHaveBeenCalled(); // the message came before the answer
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1), { timeout: BOUND_MS });
    expect(onSuccess.mock.calls[0][0].user.username).toBe('known');
    expect(screen.queryByTestId('signin-waking')).toBeNull();
    expect(screen.queryByTestId('signin-cancel')).toBeNull();
    expect(server.maxConcurrent).toBe(1);
  }, 60000);

  it('Cancel closes the request, shows no error, and the person can sign in again at once', async () => {
    server.set({ neverAnswer: true });
    const abandonedBefore = server.abandoned;
    const onSuccess = vi.fn();
    render(<LoginScreen onSuccess={onSuccess} onSwitchToRegister={() => {}} onBack={() => {}} />);
    type('Email', 'known@example.com');
    type('Password', 'password-1');
    pressLogIn();
    await waitFor(() => expect(server.requests.length).toBeGreaterThan(0), { timeout: BOUND_MS });
    fireEvent.click(screen.getByTestId('signin-cancel'));
    await waitFor(() => expect(screen.queryByTestId('signin-cancel')).toBeNull(), { timeout: BOUND_MS });
    await waitFor(() => expect(server.abandoned).toBe(abandonedBefore + 1), { timeout: BOUND_MS }); // the socket really closed
    expect(screen.queryByText('Cancelled.')).toBeNull();
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();

    server.set({});
    pressLogIn();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1), { timeout: BOUND_MS });
  }, 60000);

  it('leaving the screen while it waits closes the request: nothing keeps running behind a screen that is gone', async () => {
    server.set({ neverAnswer: true });
    const abandonedBefore = server.abandoned;
    const view = render(<LoginScreen onSuccess={() => {}} onSwitchToRegister={() => {}} onBack={() => {}} />);
    type('Email', 'known@example.com');
    type('Password', 'password-1');
    pressLogIn();
    await waitFor(() => expect(server.requests.length).toBeGreaterThan(0), { timeout: BOUND_MS });
    view.unmount();
    await waitFor(() => expect(server.abandoned).toBe(abandonedBefore + 1), { timeout: BOUND_MS });
  }, 60000);

  it('a wrong password is still the server\'s own sentence, with no waking message', async () => {
    render(<LoginScreen onSuccess={() => {}} onSwitchToRegister={() => {}} onBack={() => {}} />);
    type('Email', 'known@example.com');
    type('Password', 'not-the-password');
    pressLogIn();
    await waitFor(() => expect(screen.getByText('Invalid email or password')).toBeTruthy(), { timeout: BOUND_MS });
    expect(screen.queryByTestId('signin-waking')).toBeNull();
    expect(screen.queryByTestId('signin-cancel')).toBeNull();
  }, 30000);
});

describe('Sign up', () => {
  it('shows the same Cancel and waking message and creates the account once', async () => {
    server.set({ holdEachMs: 7000 });
    const onSuccess = vi.fn();
    render(<RegisterScreen onSuccess={onSuccess} onSwitchToLogin={() => {}} onBack={() => {}} />);
    type('Email', 'dom-user@example.com');
    type('Username', 'dom-user');
    type('Password (at least 8 characters)', 'password-7');
    fireEvent.click(screen.getAllByText('Sign Up').at(-1) as HTMLElement);
    expect(screen.getByTestId('signin-cancel')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('signin-waking')).toBeTruthy(), { timeout: BOUND_MS });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1), { timeout: BOUND_MS });
    expect(onSuccess.mock.calls[0][0].user.username).toBe('dom-user');
    expect(server.accounts.has('dom-user@example.com')).toBe(true);
    expect([...server.accounts.keys()].filter((email) => email === 'dom-user@example.com')).toHaveLength(1);
  }, 60000);
});
