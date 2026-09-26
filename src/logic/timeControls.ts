import type { TimeControl, TimeControlCategory } from '../types/timeControl';

const MINUTE = 60;
const DAY = 86400;

export const TIME_CONTROLS: TimeControl[] = [
  { id: 'unlimited', label: 'No time limit', initialSeconds: 0, incrementSeconds: 0, category: 'unlimited' },

  { id: 'bullet-1', label: '1 min', initialSeconds: 1 * MINUTE, incrementSeconds: 0, category: 'bullet' },
  { id: 'bullet-1-1', label: '1 | 1', initialSeconds: 1 * MINUTE, incrementSeconds: 1, category: 'bullet' },
  { id: 'bullet-2-1', label: '2 | 1', initialSeconds: 2 * MINUTE, incrementSeconds: 1, category: 'bullet' },

  { id: 'blitz-3', label: '3 min', initialSeconds: 3 * MINUTE, incrementSeconds: 0, category: 'blitz' },
  { id: 'blitz-3-2', label: '3 | 2', initialSeconds: 3 * MINUTE, incrementSeconds: 2, category: 'blitz' },
  { id: 'blitz-5', label: '5 min', initialSeconds: 5 * MINUTE, incrementSeconds: 0, category: 'blitz' },
  { id: 'blitz-5-5', label: '5 | 5', initialSeconds: 5 * MINUTE, incrementSeconds: 5, category: 'blitz' },
  { id: 'blitz-5-2', label: '5 | 2', initialSeconds: 5 * MINUTE, incrementSeconds: 2, category: 'blitz' },

  { id: 'rapid-10', label: '10 min', initialSeconds: 10 * MINUTE, incrementSeconds: 0, category: 'rapid' },
  { id: 'rapid-15-10', label: '15 | 10', initialSeconds: 15 * MINUTE, incrementSeconds: 10, category: 'rapid' },
  { id: 'rapid-30', label: '30 min', initialSeconds: 30 * MINUTE, incrementSeconds: 0, category: 'rapid' },
  { id: 'rapid-10-5', label: '10 | 5', initialSeconds: 10 * MINUTE, incrementSeconds: 5, category: 'rapid' },
  { id: 'rapid-20', label: '20 min', initialSeconds: 20 * MINUTE, incrementSeconds: 0, category: 'rapid' },
  { id: 'rapid-60', label: '60 min', initialSeconds: 60 * MINUTE, incrementSeconds: 0, category: 'rapid' },

  { id: 'daily-1', label: '1 day', initialSeconds: 1 * DAY, incrementSeconds: 0, category: 'daily' },
  { id: 'daily-2', label: '2 days', initialSeconds: 2 * DAY, incrementSeconds: 0, category: 'daily' },
  { id: 'daily-3', label: '3 days', initialSeconds: 3 * DAY, incrementSeconds: 0, category: 'daily' },
  { id: 'daily-5', label: '5 days', initialSeconds: 5 * DAY, incrementSeconds: 0, category: 'daily' },
  { id: 'daily-7', label: '7 days', initialSeconds: 7 * DAY, incrementSeconds: 0, category: 'daily' },
  { id: 'daily-14', label: '14 days', initialSeconds: 14 * DAY, incrementSeconds: 0, category: 'daily' },
];

export const TIME_CONTROL_CATEGORIES: { category: TimeControlCategory; label: string }[] = [
  { category: 'bullet', label: 'Bullet' },
  { category: 'blitz', label: 'Blitz' },
  { category: 'rapid', label: 'Rapid' },
  { category: 'daily', label: 'Daily' },
  { category: 'unlimited', label: 'No time limit' },
];

export function getTimeControlsByCategory(category: TimeControlCategory): TimeControl[] {
  return TIME_CONTROLS.filter((tc) => tc.category === category);
}

/**
 * Recovers a preset's category from just its `initialSeconds` — used for online games, where the
 * server only ever gets/returns `{initialSeconds, incrementSeconds}` (see MatchFoundPayload), not
 * the local preset's `category` field. Safe because no two categories in TIME_CONTROLS share an
 * `initialSeconds` value (e.g. every "5 min"-based preset is 'blitz', every "10 min"-based one is
 * 'rapid'), so matching on it alone is unambiguous for every preset this app actually offers.
 */
export function categoryForInitialSeconds(initialSeconds: number): TimeControlCategory | null {
  return TIME_CONTROLS.find((tc) => tc.initialSeconds === initialSeconds)?.category ?? null;
}
