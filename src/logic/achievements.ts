import type { AchievementDef } from '../types/achievements';

// A small, fixed list rather than anything data-driven — each id is unlocked by exactly one call
// to unlockAchievement(id) from wherever that condition is actually detected (see
// BotGameScreen/OnlineGameScreen's rating-update effect for 'giant_slayer'/'comeback_win', and
// PuzzleRushScreen for 'puzzle_streak_10'/'puzzle_rush_10'). Adding a new one later just means
// adding an entry here plus one unlockAchievement() call at the moment it's earned.
export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'giant_slayer',
    title: 'Giant Slayer',
    description: 'Win a game against a bot rated 2000 ELO or higher.',
    icon: '⚔️',
  },
  {
    id: 'comeback_win',
    title: 'Comeback',
    description: 'Win a Bot or Online game after being down 3+ points of material.',
    icon: '🔄',
  },
  {
    id: 'puzzle_streak_10',
    title: 'Puzzle Streak',
    description: 'Solve 10 puzzles in a row without a mistake in a single Puzzle Rush run.',
    icon: '🧩',
  },
  {
    id: 'puzzle_rush_10',
    title: 'Rush Hour',
    description: 'Score 10 or more puzzles solved in a single Puzzle Rush run.',
    icon: '⏱️',
  },
];
