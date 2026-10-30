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
  { id: 'game-2p', title: 'Game: 2-player (Local classic)', steps: [PLAY, { text: 'Classic', nth: 1 }, { text: '5 min' }], boardKind: 'twoPlayer', pieces: { mode: 'bw', allKinds: true } },
  { id: 'game-2p-options', title: 'Game: 2-player, Options menu', steps: [PLAY, { text: 'Classic', nth: 1 }, { text: '5 min' }, { text: 'Options' }] },
  { id: 'bot-select', title: 'Setup: 2-player vs a bot', steps: [PLAY, { text: 'Classic', nth: 0 }] },
  { id: 'setup-chess', title: 'Setup: Setup Chess (Local)', steps: [PLAY, { text: 'Setup Chess', nth: 1 }] },
  { id: 'engine-vs-engine', title: 'Setup: Engine vs Engine', steps: [PLAY, { text: 'Classic', nth: 2 }] },
  { id: 'ffa-setup', title: 'Setup: 4 Player Chess', steps: [PLAY, { text: 'Free-for-All' }] },
  { id: 'ffa-time', title: 'Time control: 4 Player', steps: [PLAY, { text: 'Free-for-All' }, { text: 'Choose time control' }] },
  { id: 'game-ffa', title: 'Game: 4 Player Chess', steps: [PLAY, { text: 'Free-for-All' }, { text: 'Choose time control' }, { text: '5 min' }], boardKind: 'fourPlayer', pieces: { mode: 'seat' } },
  { id: 'giveaway-setup', title: 'Setup: 4 Player Giveaway', steps: [PLAY, { text: 'Local', nth: 1 }] },
  { id: 'game-giveaway', title: 'Game: 4 Player Giveaway', steps: [PLAY, { text: 'Local', nth: 1 }, { text: 'Choose time control' }, { text: '5 min' }], boardKind: 'fourPlayer', pieces: { mode: 'seat' } },
  { id: 'chaturaji-setup', title: 'Setup: Chaturaji', steps: [PLAY, { label: 'Chaturaji local' }] },
  { id: 'game-chaturaji', title: 'Game: Chaturaji', steps: [PLAY, { label: 'Chaturaji local' }, { text: 'Choose time control' }, { text: '5 min' }], boardKind: 'chaturaji', pieces: { mode: 'seat' } },
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
  { id: 'piece-gallery', title: 'Diagnostics: Piece gallery (every theme x 12 pieces x large and game size x every board theme)', steps: [{ text: 'More' }, { text: 'Diagnostics' }, { id: 'open-piece-gallery' }] },
];

/**
 * EVERY PIECE THEME the app ships, as literals (command #27c; pieceThemes.test.ts pins that this is exactly the ids of AVAILABLE_PIECE_THEMES, so a theme added to the app without a line here fails
 * a test). A screen that names one of them (`pieceTheme`, with `baseOnly` implied) is opened with that theme as the app's persisted piece theme, and its pieces are photographed on both square
 * colours: the built-in theme by its exact ink, an image theme by its own asset (android-matrix-pieces.mjs `judgeImageCell`).
 */
export const PIECE_THEME_IDS = ['default', 'cburnett', 'merida', 'checkers'];

/** EVERY BOARD THEME the app ships, as literals (command #28: the Ocean squares made Classic's black pieces read white; pieceThemes.test.ts pins this to AVAILABLE_BOARD_THEMES). */
export const BOARD_THEME_IDS = ['default', 'wood', 'green', 'ocean', 'marble'];

/**
 * The 2-player board under every piece theme on EVERY board theme (command #28): the start position, so every kind but the two queens' and kings' second square colour is on both squares (the
 * Bughouse screens cover all twelve on both). The black pieces' BODY must read dark on each (android-matrix-pieces.mjs `bodyLuminance`).
 */
export const THEME_SCREENS = PIECE_THEME_IDS.flatMap((id) =>
  BOARD_THEME_IDS.map((board) => ({
    id: `game-2p-theme-${id}${board === 'default' ? '' : `-${board}`}`,
    title: `Game: 2-player, piece theme ${id}, board theme ${board} (pixels)`,
    steps: [PLAY, { text: 'Classic', nth: 1 }, { text: '5 min' }],
    boardKind: 'twoPlayer',
    pieceTheme: id,
    boardTheme: board,
    pieces: { mode: 'bw', allKinds: true, bothSquares: false },
  }))
);

/** Screens to run: the master list, the piece-theme screens, plus another branch's extra list when given. */
export function allScreens(extra = []) {
  return [...SCREENS, ...THEME_SCREENS, ...extra];
}
