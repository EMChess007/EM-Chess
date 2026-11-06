import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../logic/__tests__/bughouseTestKit';
import type { SeatConfig, SeatController } from '../../logic/fourPlayer/setup';
import BughouseGameScreen from '../BughouseGameScreen';

/**
 * The `compact` props of the Bughouse screens take effect now that the screens use AppPressable (master's Android text-fit change merged into paired/bughouse). Before the merge they
 * were spread onto react-native's own Pressable, which ignores them; AppPressable turns `compact` into "this control is small on purpose": no 44 dp floor and the matrix's exemption mark
 * (`data-matrix-exempt`). The dual layouts keep slim controls (28 dp + hit slop, BUGHOUSE_SPEC.md 5.6); the standard layout keeps the 44 dp floor.
 */
const H: SeatController = { kind: 'human' };
const B: SeatController = { kind: 'bot', elo: 1200 };
const cfg = (a: string): SeatConfig => [a[0] === 'H' ? H : B, a[1] === 'H' ? H : B, a[2] === 'H' ? H : B, a[3] === 'H' ? H : B];
const TC3 = { initialMs: 180000, incrementMs: 0 };

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const renderGame = (props: Partial<ComponentProps<typeof BughouseGameScreen>> & { seats: SeatConfig }) =>
  render(<BughouseGameScreen timeControl={TC3} onExit={() => {}} rng={mulberry32(11)} clock={() => Date.now()} {...props} />);

describe('compact controls', () => {
  it('the dual layout (humans on both boards): its slim controls are compact (exempt from the 44 dp floor, hit slop instead)', () => {
    renderGame({ seats: cfg('HBHB') }); // A white (Team 1) and B white (Team 2): both boards, both teams
    for (const id of ['bughouse-rules', 'bughouse-resign-team-1', 'bughouse-resign-team-2']) {
      expect(screen.getByTestId(id).getAttribute('data-matrix-exempt'), id).toBe('1');
    }
  });

  it('the standard layout (one human): the controls are ordinary 44 dp controls', () => {
    renderGame({ seats: cfg('HBBB') });
    expect(screen.getByTestId('bughouse-rules').getAttribute('data-matrix-exempt')).toBeNull();
    expect(screen.getByTestId('bughouse-resign').getAttribute('data-matrix-exempt')).toBeNull();
  });
});
