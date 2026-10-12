import { useCallback, useEffect, useRef, useState } from 'react';
import type { TimeControl } from '../types/timeControl';
import { clockTick, createClock, type FourPlayerClock, type FourPlayerState, type GameEvent } from './fourPlayer';
import { hasLiveClock } from './useChessClock';

/** How often real time is converted into clock time. The clock itself is exact (it works from timestamps); this only bounds how late a flag-fall is noticed. */
const TICK_MS = 200;

export function clockForTimeControl(timeControl: TimeControl): FourPlayerClock {
  return createClock(timeControl.initialSeconds, timeControl.incrementSeconds, hasLiveClock(timeControl.category));
}

/**
 * Drives the four independent 4 Player Chess clocks from a timer — the 4-seat counterpart of useChessClock (which is two-seat all the way
 * down: white/black state, a single `turn`, a single "timeout winner"; the 4-seat rules live in the pure model, fourPlayer/clock.ts, and
 * this hook is just the timer around it). Only the seat to move loses time. When a seat's clock reaches zero the engine eliminates it
 * (`resign(..., 'timeout')`) and `onTimeout` receives the resulting game state and events so the screen can adopt them.
 *
 * `game` must be the game state currently on screen; the interval reads it (and the clock) through refs so it never acts on a stale one.
 */
export function useFourPlayerClock(
  timeControl: TimeControl,
  game: FourPlayerState,
  onTimeout: (next: FourPlayerState, events: GameEvent[]) => void
) {
  const [clock, setClock] = useState<FourPlayerClock>(() => clockForTimeControl(timeControl));
  const gameRef = useRef(game);
  const clockRef = useRef(clock);
  const onTimeoutRef = useRef(onTimeout);
  gameRef.current = game;
  clockRef.current = clock;
  onTimeoutRef.current = onTimeout;

  const running = clock.enabled && !game.result;
  useEffect(() => {
    if (!running) return;
    let last = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - last) / 1000;
      last = now;
      const tick = clockTick(gameRef.current, clockRef.current, elapsed);
      clockRef.current = tick.clock;
      setClock(tick.clock);
      if (tick.state !== gameRef.current) onTimeoutRef.current(tick.state, tick.events);
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [running]);

  const reset = useCallback(() => {
    const fresh = clockForTimeControl(timeControl);
    clockRef.current = fresh;
    setClock(fresh);
  }, [timeControl]);

  return { clock, setClock, reset };
}
