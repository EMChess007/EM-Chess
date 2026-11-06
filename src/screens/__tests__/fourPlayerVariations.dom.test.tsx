import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TIME_CONTROLS } from '../../logic/timeControls';
import ChallengeScreen from '../ChallengeScreen';
import OnlineTimeControlSelectScreen from '../OnlineTimeControlSelectScreen';
import PlayModeSelectScreen from '../PlayModeSelectScreen';
import TimeControlSelectScreen from '../TimeControlSelectScreen';

/**
 * THE 4 PLAYER VARIATIONS MENU AND THE ONLINE PICKERS, RENDERED (command #35): the Play menu has ONE "4 Player Variations" card with four buttons that open the local setups; the Online card's
 * Quick Match and Challenge a Friend offer the same four games as chips next to the 2-player variants, with every time control; the 4-seat games route to their own queue / room. What the
 * pickers show comes from the one list (`TIME_CONTROLS`), compared with the list itself.
 */
vi.mock('../../api/socket', () => ({ connectSocket: () => ({ on: () => {}, off: () => {}, emit: () => {} }), disconnectSocket: () => {} }));

const menu = (over: Record<string, unknown> = {}) => ({ authUser: { id: 'u', username: 'Ann' }, onAuthPress: vi.fn(), onOnline: vi.fn(), onChallengeFriend: vi.fn(), onTournaments: vi.fn(), onSpectate: vi.fn(), ...over }) as unknown as ComponentProps<typeof PlayModeSelectScreen>;

describe('the Play menu', () => {
  it('has the Online card first, and ONE 4 Player Variations card with four buttons in this order; the four old cards are gone', () => {
    render(<PlayModeSelectScreen {...menu()} />);
    const card = screen.getByTestId('four-player-variations-card');
    expect([...card.querySelectorAll('[aria-label]')].map((b) => b.getAttribute('aria-label'))).toEqual(['4 Player Chess', '4 Player Giveaway', 'Chaturaji', 'Crazy Bughouse']);
    expect(screen.getAllByText('4 Player Variations')).toHaveLength(1);
    for (const gone of ['chaturaji-card', 'bughouse-card', 'bughouse-online-button', 'bughouse-friend-button', 'bughouse-join-button', 'chaturaji-rules-link', 'bughouse-rules-link']) expect(screen.queryByTestId(gone), gone).toBeNull();
    expect(screen.queryByText('Free-for-All')).toBeNull();
    expect(screen.queryByText('Local')).not.toBeNull(); // the 2-player Local card is untouched
    const online = screen.getByText('Quick Match').closest('[class]')!;
    expect(online).toBeTruthy();
    expect(screen.getByText('Challenge Friend')).toBeTruthy();
    expect(screen.getByText('Tournaments')).toBeTruthy();
    expect(screen.getByText('Spectate a live game ›')).toBeTruthy();
  });

  it('each button opens its game\'s local setup and needs no login', () => {
    const handlers = { onFourPlayer: vi.fn(), onFourPlayerGiveaway: vi.fn(), onChaturaji: vi.fn(), onBughouse: vi.fn() };
    render(<PlayModeSelectScreen {...menu({ authUser: null, ...handlers })} />);
    for (const [label, handler] of [['4 Player Chess', handlers.onFourPlayer], ['4 Player Giveaway', handlers.onFourPlayerGiveaway], ['Chaturaji', handlers.onChaturaji], ['Crazy Bughouse', handlers.onBughouse]] as const) {
      fireEvent.click(screen.getByLabelText(label));
      expect(handler, label).toHaveBeenCalledTimes(1);
    }
    expect(screen.queryByText('Login required')).toBeNull();
  });

  it('the resume links name the game and sit in the same card', () => {
    render(<PlayModeSelectScreen {...menu({ onFourPlayerResume: vi.fn(), fourPlayerResumeVariant: 'ffa', onBughouseResume: vi.fn() })} />);
    const card = screen.getByTestId('four-player-variations-card');
    expect(within(card).getByText('Return to your 4 Player Chess game ›')).toBeTruthy();
    expect(within(card).getByText('Return to your Crazy Bughouse game ›')).toBeTruthy();
  });
});

describe('Quick Match', () => {
  const picker = (onSelect = vi.fn()) => {
    render(<OnlineTimeControlSelectScreen onSelect={onSelect} onBack={() => {}} />);
    return onSelect;
  };

  it('has the 2-player variants and then the four 4 Player Variations as chips', () => {
    picker();
    for (const label of ['Classic', 'Chess960', 'Crazyhouse', '4 Player Chess', '4 Player Giveaway', 'Chaturaji', 'Crazy Bughouse']) expect(screen.getAllByLabelText(label).length, label).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Bughouse')).toBeNull();
  });

  it('offers every control of the one list, Daily and No time limit included, with the Daily note', () => {
    picker();
    for (const heading of ['Bullet', 'Blitz', 'Rapid', 'Daily', 'No time limit']) expect(screen.getAllByText(heading).length, heading).toBeGreaterThan(0); // ("No time limit" is a heading and a button)
    expect(screen.getByText('A Daily game is kept while the server runs; an app update on the server can end it.')).toBeTruthy();
    for (const tc of TIME_CONTROLS) {
      const label = `${tc.category === 'unlimited' ? 'No time limit' : tc.category[0].toUpperCase() + tc.category.slice(1)} ${tc.label}`;
      expect(screen.getByLabelText(label), label).toBeTruthy();
    }
  });

  it.each([['Classic', 'classic'], ['4 Player Chess', 'fourPlayerChess'], ['4 Player Giveaway', 'fourPlayerGiveaway'], ['Chaturaji', 'chaturaji'], ['Crazy Bughouse', 'crazyBughouse']])('choosing %s then a control hands both to App (%s)', (chip, game) => {
    const onSelect = picker();
    fireEvent.click(screen.getByLabelText(chip));
    fireEvent.click(screen.getByLabelText('Daily 7 days'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][1]).toBe(game);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: 'daily-7', initialSeconds: 604800 });
  });
});

describe('Challenge a Friend', () => {
  const challenge = () => {
    const onFriendRoom = vi.fn();
    render(<ChallengeScreen authToken="t" onMatchFound={() => {}} onFriendRoom={onFriendRoom} onSetupChessPaired={() => {}} onBack={() => {}} />);
    fireEvent.click(screen.getByText('Create Challenge'));
    return onFriendRoom;
  };

  it('has the same chips and every control', () => {
    challenge();
    for (const label of ['Classic', '4 Player Chess', '4 Player Giveaway', 'Chaturaji', 'Crazy Bughouse']) expect(screen.getAllByLabelText(label).length, label).toBeGreaterThan(0);
    for (const heading of ['Bullet', 'Blitz', 'Rapid', 'Daily', 'No time limit']) expect(screen.getAllByText(heading).length, heading).toBeGreaterThan(0);
    expect(screen.getAllByLabelText(/^(Bullet|Blitz|Rapid|Daily|No time limit) /)).toHaveLength(21);
  });

  it.each([
    ['4 Player Chess', { kind: 'createFour', variant: 'ffa' }],
    ['4 Player Giveaway', { kind: 'createFour', variant: 'giveaway' }],
    ['Chaturaji', { kind: 'createFour', variant: 'chaturaji' }],
    ['Crazy Bughouse', { kind: 'createBughouse' }],
  ])('%s: Create Challenge opens a friend ROOM for it (not a challenge code)', (chip, expected) => {
    const onFriendRoom = challenge();
    fireEvent.click(screen.getByLabelText(chip));
    fireEvent.click(screen.getByLabelText('Blitz 5 | 2'));
    expect(onFriendRoom).toHaveBeenCalledTimes(1);
    expect(onFriendRoom.mock.calls[0][0]).toMatchObject({ ...expected, timeControl: { id: 'blitz-5-2', initialSeconds: 300, incrementSeconds: 2 } });
  });

  it('every control can open a 4-seat room (Daily and No time limit too)', () => {
    for (const tc of TIME_CONTROLS) {
      const onFriendRoom = challenge();
      fireEvent.click(screen.getByLabelText('Chaturaji'));
      fireEvent.click(screen.getByLabelText(`${tc.category === 'unlimited' ? 'No time limit' : tc.category[0].toUpperCase() + tc.category.slice(1)} ${tc.label}`));
      expect(onFriendRoom, tc.id).toHaveBeenCalledTimes(1);
      expect(onFriendRoom.mock.calls[0][0].timeControl.id, tc.id).toBe(tc.id);
      document.body.innerHTML = '';
    }
  });
});

describe('the local setups pick a control from the same list', () => {
  it('Select Time Control shows all 21', () => {
    render(<TimeControlSelectScreen onSelect={() => {}} onBack={() => {}} />);
    expect(screen.getAllByLabelText(/^(Bullet|Blitz|Rapid|Daily|No time limit) /)).toHaveLength(21);
    expect(screen.queryByText('A Daily game is kept while the server runs; an app update on the server can end it.')).toBeNull(); // the local picker has no server note
  });
});
