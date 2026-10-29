/**
 * The Bughouse screens of the Android device matrix (branch paired/bughouse; android-matrix-screens.mjs describes the step language). The runner loads this file when it exists.
 * The Local game needs no server: the two game screens are the real ones with their bots, driven from a fresh load.
 */
const PLAY = { text: 'Play' };
const SETUP = [PLAY, { label: 'Bughouse local' }];

export const EXTRA_SCREENS = [
  { id: 'bughouse-setup', title: 'Setup: Bughouse (You + 3 bots)', steps: SETUP },
  { id: 'bughouse-setup-four', title: 'Setup: Bughouse (4 players)', steps: [...SETUP, { id: 'preset-four' }] },
  { id: 'bughouse-time', title: 'Time control: Bughouse', steps: [...SETUP, { id: 'preset-four' }, { id: 'bughouse-start' }] },
  { id: 'bughouse-rules', title: 'Rules sheet: Bughouse', steps: [...SETUP, { id: 'how-to-play' }] },
  { id: 'bughouse-game-single', title: 'Game: Bughouse, You + 3 bots (thumbnail layout)', steps: [...SETUP, { id: 'preset-solo' }, { id: 'bughouse-start' }, { text: '3 min' }], boardKind: 'bughouseStandard' },
  { id: 'bughouse-game-dual', title: 'Game: Bughouse, 4 players (two boards)', steps: [...SETUP, { id: 'preset-four' }, { id: 'bughouse-start' }, { text: '3 min' }], boardKind: 'bughouse' },
  { id: 'bughouse-game-dual-teammates', title: 'Game: Bughouse, 2 teammates (two boards)', steps: [...SETUP, { id: 'preset-teammates' }, { id: 'bughouse-start' }, { text: '3 min' }], boardKind: 'bughouse' },
];
