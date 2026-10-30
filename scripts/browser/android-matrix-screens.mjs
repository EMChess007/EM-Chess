/**
 * The screens of the Android device matrix and how to reach each one from a fresh load of the app (no backend, no account: a guest on a Local game).
 *
 * A step is one of: { text, nth? } (click the nth element whose whole text is `text`), { label } (click the element with that aria-label), { id } (click the data-testid),
 * { wait } (ms), { fill: [placeholder, value] }. `boardKind` names the board's minimum cell (android-matrix-def.mjs CRITERIA.minBoardCell).
 * A screen whose steps fail is a FAILED screen of the matrix, never a silent skip.
 *
 * Screens that exist only on another branch (Bughouse is on paired/bughouse) are added there, in android-matrix-screens-extra.mjs (an optional file the runner loads, exporting EXTRA_SCREENS), and merged with `allScreens`.
 */
const PLAY = { text: 'Play' };

export const SCREENS = [
  { id: 'home', title: 'Home (with the tab bar)', steps: [], glyphs: 4 },
  { id: 'streak', title: 'Streak', steps: [{ text: '🔥' }] },
  { id: 'play-menu', title: 'Play menu (full scroll)', steps: [PLAY] },
  { id: 'time-control', title: 'Time control (2-player)', steps: [PLAY, { text: 'Classic', nth: 1 }] },
  { id: 'game-2p', title: 'Game: 2-player (Local classic)', steps: [PLAY, { text: 'Classic', nth: 1 }, { text: '5 min' }], boardKind: 'twoPlayer' },
  { id: 'game-2p-options', title: 'Game: 2-player, Options menu', steps: [PLAY, { text: 'Classic', nth: 1 }, { text: '5 min' }, { text: 'Options' }] },
  { id: 'bot-select', title: 'Setup: 2-player vs a bot', steps: [PLAY, { text: 'Classic', nth: 0 }] },
  { id: 'setup-chess', title: 'Setup: Setup Chess (Local)', steps: [PLAY, { text: 'Setup Chess', nth: 1 }] },
  { id: 'engine-vs-engine', title: 'Setup: Engine vs Engine', steps: [PLAY, { text: 'Classic', nth: 2 }] },
  { id: 'ffa-setup', title: 'Setup: 4 Player Chess', steps: [PLAY, { text: 'Free-for-All' }] },
  { id: 'ffa-time', title: 'Time control: 4 Player', steps: [PLAY, { text: 'Free-for-All' }, { text: 'Choose time control' }] },
  { id: 'game-ffa', title: 'Game: 4 Player Chess', steps: [PLAY, { text: 'Free-for-All' }, { text: 'Choose time control' }, { text: '5 min' }], boardKind: 'fourPlayer' },
  { id: 'giveaway-setup', title: 'Setup: 4 Player Giveaway', steps: [PLAY, { text: 'Local', nth: 1 }] },
  { id: 'game-giveaway', title: 'Game: 4 Player Giveaway', steps: [PLAY, { text: 'Local', nth: 1 }, { text: 'Choose time control' }, { text: '5 min' }], boardKind: 'fourPlayer' },
  { id: 'chaturaji-setup', title: 'Setup: Chaturaji', steps: [PLAY, { label: 'Chaturaji local' }] },
  { id: 'game-chaturaji', title: 'Game: Chaturaji', steps: [PLAY, { label: 'Chaturaji local' }, { text: 'Choose time control' }, { text: '5 min' }], boardKind: 'chaturaji' },
  { id: 'rules-chaturaji', title: 'Rules sheet: Chaturaji', steps: [PLAY, { id: 'chaturaji-rules-link' }] },
  { id: 'dialog-login', title: 'Dialog: login required', steps: [PLAY, { text: 'Quick Match' }] },
  { id: 'puzzles', title: 'Puzzle (daily, with the tab bar)', steps: [{ text: 'Puzzles' }], glyphs: 4 },
  { id: 'puzzle-training', title: 'Puzzle Training', steps: [{ text: 'Puzzles' }, { text: 'Puzzle Training ›' }] },
  { id: 'puzzle-rush', title: 'Puzzle Rush', steps: [{ text: 'Puzzles' }, { text: 'Puzzle Rush ›' }] },
  { id: 'analysis', title: 'Analysis list (with the tab bar)', steps: [{ text: 'Analysis' }], glyphs: 4 },
  { id: 'more', title: 'More (with the tab bar)', steps: [{ text: 'More' }], glyphs: 4 },
  { id: 'more-login', title: 'Log in', steps: [{ text: 'More' }, { text: 'Log in / Sign up' }] },
  { id: 'more-rating-history', title: 'Rating history', steps: [{ text: 'More' }, { text: 'View Rating History' }] },
  { id: 'more-achievements', title: 'Achievements', steps: [{ text: 'More' }, { text: 'View Achievements' }] },
  { id: 'more-engines', title: 'Custom engines', steps: [{ text: 'More' }, { text: 'Manage Custom Engines' }] },
  { id: 'more-themes', title: 'Board & piece themes', steps: [{ text: 'More' }, { text: 'Manage Board & Piece Themes' }] },
  { id: 'more-diagnostics', title: 'Diagnostics', steps: [{ text: 'More' }, { text: 'Diagnostics' }] },
];

/** Screens to run: the master list, plus another branch's extra list when given. */
export function allScreens(extra = []) {
  return [...SCREENS, ...extra];
}
