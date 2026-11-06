import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BughouseTeamBar from '../../components/BughouseTeamBar';
import { QUICK_MESSAGES, quickNotice, type TeamChatEntry } from '../../logic/bughouseOnlineUi';

/**
 * THE TEAM BAR, RENDERED (W4b; BUGHOUSE_SPEC.md 5.4 / HP10): the Quick grid of ten one-tap messages, the team-chat panel that says in words who can read it, and the 2.5 s toast a quick message
 * from the partner shows. Fake timers, no wall clock.
 */
beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => vi.restoreAllMocks());

const noChat: readonly TeamChatEntry[] = [];
const bar = (over: Partial<Parameters<typeof BughouseTeamBar>[0]> = {}) =>
  render(<BughouseTeamBar partnerName="Sam" chat={noChat} quick={null} onQuick={() => {}} onChat={() => {}} {...over} />);

describe('the Quick grid', () => {
  it('opens with the ten messages in the spec\'s order; a tap sends its code and closes the grid; a problem is shown in words', () => {
    const onQuick = vi.fn((_code: number, done: (o: string | null) => void) => done('Your partner is a bot.'));
    bar({ onQuick });
    expect(screen.queryByTestId('bughouse-quick-grid')).toBeNull();
    fireEvent.click(screen.getByTestId('bughouse-quick'));
    for (let code = 0; code < 10; code++) expect(screen.getByTestId(`bughouse-quick-${code}`).textContent).toBe(QUICK_MESSAGES[code]);
    fireEvent.click(screen.getByTestId('bughouse-quick-6'));
    expect(onQuick).toHaveBeenCalledTimes(1);
    expect(onQuick.mock.calls[0][0]).toBe(6);
    expect(screen.queryByTestId('bughouse-quick-grid')).toBeNull();
    expect(screen.getByTestId('bughouse-team-problem').textContent).toBe('Your partner is a bot.');
  });
});

describe('the toast', () => {
  it('shows my partner\'s message at the top edge without taking touches, and goes after 2.5 s', () => {
    const notice = quickNotice({ seat: 2, code: 8 }, 1)!;
    bar({ quick: notice });
    const toast = screen.getByTestId('bughouse-quick-toast');
    expect(toast.textContent).toBe('Sam: Hurry!');
    expect(toast.getAttribute('aria-label')).toBe('Sam: Hurry!');
    act(() => void vi.advanceTimersByTime(2499));
    expect(screen.queryByTestId('bughouse-quick-toast')).not.toBeNull();
    act(() => void vi.advanceTimersByTime(2));
    expect(screen.queryByTestId('bughouse-quick-toast')).toBeNull();
  });
});

describe('the team chat', () => {
  it('says who can read it, shows the lines (mine as "You"), counts the unread ones while closed, and sends a trimmed line', () => {
    const onChat = vi.fn((_text: string, done: (o: string | null) => void) => done(null));
    const lines: TeamChatEntry[] = [{ id: 1, seat: 2, name: 'Sam', text: 'take the knight', mine: false }];
    const { rerender } = bar({ onChat });
    expect(screen.getByTestId('bughouse-chat').textContent).toBe('Team chat');
    rerender(<BughouseTeamBar partnerName="Sam" chat={lines} quick={null} onQuick={() => {}} onChat={onChat} />); // a line arrives while the panel is closed
    expect(screen.getByTestId('bughouse-chat').textContent).toBe('Team chat (1)');
    fireEvent.click(screen.getByTestId('bughouse-chat'));
    expect(screen.getByTestId('bughouse-team-chat-header').textContent).toBe('Team chat - only your partner sees this');
    expect(screen.getByTestId('bughouse-team-chat').textContent).toContain('Sam: take the knight');
    expect(screen.getByTestId('bughouse-chat').textContent).toBe('Team chat');
    fireEvent.change(screen.getByTestId('bughouse-team-chat-input'), { target: { value: '  ok  ' } });
    fireEvent.click(screen.getByTestId('bughouse-team-chat-send'));
    expect(onChat.mock.calls[0][0]).toBe('ok');
    rerender(<BughouseTeamBar partnerName="Sam" chat={[...lines, { id: 2, seat: 0, name: 'Me', text: 'ok', mine: true }]} quick={null} onQuick={() => {}} onChat={onChat} />);
    expect(screen.getByTestId('bughouse-team-chat').textContent).toContain('You: ok');
  });

  it('an empty panel says so in words', () => {
    bar();
    fireEvent.click(screen.getByTestId('bughouse-chat'));
    expect(screen.getByTestId('bughouse-team-chat').textContent).toContain('Only your partner sees what you write here.');
  });
});
