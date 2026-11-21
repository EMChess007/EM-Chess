import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderCount, resetRenderCounts } from '../../test/renderCounter';
import TimeControlSelectScreen from '../TimeControlSelectScreen';

vi.mock('../../components/TimeControlSections', async (importOriginal) => (await import('../../test/renderCounter')).countModule('TimeControlSections', await importOriginal()));

/**
 * COMMAND #67: the large-perf slice judged `tap {"text":"White"}` on the bot setup screen ("Play as") LOST in every run (PR #50, job 136811414001 and the four runs before it), and the
 * lost-tap evidence said "JS SILENT". MEASURED, not assumed:
 *  - the JavaScript thread was NOT blocked: the same evidence line has no stall >= 50 ms in the 20 s after the tap and a busy share of 40 %, the same 40 % the slice reports for an IDLE
 *    Bughouse window in the same run (the 20 ms probe interval fires late on the emulator by that much at rest);
 *  - the screen does no work of its own: this test counts it - no timer, no effect re-run, one render of the screen per colour tap;
 *  - the tap LANDED: the bot then played Black in every one of those runs (the default is Random);
 *  - what was missing is any observable change: the choice changed only a background colour, and the harness compares the words and the selected / checked flags of the tree.
 * The chosen colour is now `aria-selected` (TalkBack announces it; Android's tree carries selected="true"), so the harness sees the tap land.
 */
describe('bot setup: the "Play as" colour pick', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRenderCounts();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const chosen = () => ['b', 'w', 'random'].filter((value) => screen.getByTestId(`play-as-${value}`).getAttribute('aria-selected') === 'true');

  it('the chosen colour is selected for accessibility, and a tap moves the selection', () => {
    render(<TimeControlSelectScreen showColorPicker onSelect={() => {}} onBack={() => {}} subtitle="Kiddo" />);
    expect(chosen()).toEqual(['random']);
    fireEvent.click(screen.getByTestId('play-as-w'));
    expect(chosen()).toEqual(['w']);
    fireEvent.click(screen.getByTestId('play-as-b'));
    expect(chosen()).toEqual(['b']);
  });

  it('the screen schedules no work: no timer after mount or after a tap, and a tap costs one render of the time-control list', () => {
    render(<TimeControlSelectScreen showColorPicker onSelect={() => {}} onBack={() => {}} subtitle="Kiddo" />);
    act(() => void vi.advanceTimersByTime(0));
    expect(vi.getTimerCount()).toBe(0);
    expect(renderCount('TimeControlSections')).toBe(1);
    fireEvent.click(screen.getByTestId('play-as-w'));
    act(() => void vi.advanceTimersByTime(1000));
    expect(vi.getTimerCount()).toBe(0);
    expect(renderCount('TimeControlSections')).toBe(2);
  });

  it('the picked colour reaches the game: a time control after "White" starts the bot game as White', () => {
    const onSelect = vi.fn();
    render(<TimeControlSelectScreen showColorPicker onSelect={onSelect} onBack={() => {}} />);
    fireEvent.click(screen.getByTestId('play-as-w'));
    fireEvent.click(screen.getByText('3 min'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][1]).toBe('w');
  });

  it('local games have no colour pick (and pass no colour)', () => {
    const onSelect = vi.fn();
    render(<TimeControlSelectScreen onSelect={onSelect} onBack={() => {}} />);
    expect(screen.queryByTestId('play-as-w')).toBeNull();
    fireEvent.click(screen.getByText('3 min'));
    expect(onSelect.mock.calls[0][1]).toBeUndefined();
  });
});
