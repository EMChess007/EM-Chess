/**
 * The Bughouse screens of the Android device matrix (branch paired/bughouse; android-matrix-screens.mjs describes the step language). The runner loads this file when it exists.
 * The Local game needs no server: the two game screens are the real ones with their bots, driven from a fresh load.
 *
 * Extra keys of a screen (command #27b):
 *   fixture   a position the game screen starts from instead of the standard one (src/logic/bughouseFixture.ts, test-only: web, development build): 'fullPockets' (every pocket holds all five
 *             kinds with high counts, a promoted piece on each board) or 'allPieces' (all twelve kinds of piece on light and dark squares);
 *   pockets   the pocket check applies: one row, inside its strip, never on the board, a clock, a status line or the name beside it (android-matrix-checks.mjs);
 *   pieces    the piece-colour check applies (android-matrix-pieces.mjs): { mode: 'bw' | 'seat', allKinds, bothSquares }.
 *
 * THE FULL-POCKETS SCREENS ARE PERMANENT. They are the phone's worst case, run by every profile (mini, quick, full): the pockets that the earlier fix was checked with were a temporary patch
 * and the first real game on a phone showed the chips stacked over the board.
 */
import { PIECE_THEME_IDS } from './android-matrix-screens.mjs';

const PLAY = { text: 'Play' };
const SETUP = [PLAY, { label: 'Bughouse local' }];
const startWith = (preset) => [...SETUP, { id: preset }, { id: 'bughouse-start' }, { text: '3 min' }];
const BW_PIECES = { mode: 'bw', allKinds: true };
/** A screen where bots keep playing: a photograph can catch a cell between two renders, so an empty cell is inconclusive there (android-matrix-pieces.mjs `liveBots`); a wrong colour still fails. */
const BW_PIECES_BOTS = { ...BW_PIECES, liveBots: true };

export const EXTRA_SCREENS = [
  { id: 'bughouse-setup', title: 'Setup: Bughouse (You + 3 bots)', steps: SETUP },
  { id: 'bughouse-setup-four', title: 'Setup: Bughouse (4 players)', steps: [...SETUP, { id: 'preset-four' }] },
  { id: 'bughouse-time', title: 'Time control: Bughouse', steps: [...SETUP, { id: 'preset-four' }, { id: 'bughouse-start' }] },
  { id: 'bughouse-rules', title: 'Rules sheet: Bughouse', steps: [...SETUP, { id: 'how-to-play' }] },
  { id: 'bughouse-game-single', title: 'Game: Bughouse, You + 3 bots (thumbnail layout)', steps: startWith('preset-solo'), boardKind: 'bughouseStandard', pockets: true, pieces: BW_PIECES_BOTS },
  { id: 'bughouse-game-passplay', title: 'Game: Bughouse, 2 opponents (one shared board, pass and play)', steps: startWith('preset-opponents'), boardKind: 'bughouseStandard', pockets: true, pieces: BW_PIECES_BOTS },
  { id: 'bughouse-game-dual', title: 'Game: Bughouse, 4 players (two boards)', steps: startWith('preset-four'), boardKind: 'bughouse', pockets: true, pieces: BW_PIECES },
  { id: 'bughouse-game-dual-teammates', title: 'Game: Bughouse, 2 teammates (two boards)', steps: startWith('preset-teammates'), boardKind: 'bughouse', pockets: true, pieces: BW_PIECES_BOTS },
  // --- the worst case: every pocket full (all five kinds, counts up to 16), both colours, both boards, a promoted piece on each ---
  { id: 'bughouse-full-pockets-single', title: 'Game: Bughouse, full pockets, You + 3 bots', steps: startWith('preset-solo'), fixture: 'fullPockets', boardKind: 'bughouseStandard', pockets: true },
  { id: 'bughouse-full-pockets-passplay', title: 'Game: Bughouse, full pockets, 2 opponents (pass and play)', steps: startWith('preset-opponents'), fixture: 'fullPockets', boardKind: 'bughouseStandard', pockets: true },
  { id: 'bughouse-full-pockets-dual', title: 'Game: Bughouse, full pockets, 4 players (stacked or side by side)', steps: startWith('preset-four'), fixture: 'fullPockets', boardKind: 'bughouse', pockets: true },
  { id: 'bughouse-full-pockets-teammates', title: 'Game: Bughouse, full pockets, 2 teammates', steps: startWith('preset-teammates'), fixture: 'fullPockets', boardKind: 'bughouse', pockets: true },
  // --- every kind of piece, in both colours, on both square colours: the pixels are read ---
  { id: 'bughouse-all-pieces-dual', title: 'Game: Bughouse, all twelve pieces on light and dark squares (pixels)', steps: startWith('preset-four'), fixture: 'allPieces', boardKind: 'bughouse', pockets: true, pieces: { mode: 'bw', allKinds: true, bothSquares: true } },
  // --- the same, under EVERY piece theme the app ships (command #27c): the dual screen with all twelve kinds on light and dark squares, the pixels compared with the theme's own images ---
  ...PIECE_THEME_IDS.map((id) => ({
    id: `bughouse-all-pieces-dual-theme-${id}`,
    title: `Game: Bughouse, all twelve pieces on light and dark squares, piece theme ${id} (pixels)`,
    steps: startWith('preset-four'),
    fixture: 'allPieces',
    boardKind: 'bughouse',
    pockets: true,
    pieceTheme: id,
    pieces: { mode: 'bw', allKinds: true, bothSquares: true },
  })),
];
