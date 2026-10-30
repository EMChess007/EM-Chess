// Mutation set for the piece THEMES and their colour (command #27c, branch paired/bughouse): the registry (src/logic/pieceThemes.ts), the piece itself (Piece.tsx), the built-in ink
// (pieceArt.ts), the 4-seat key map (fourPlayer/presentation.ts), the image judge of the device matrix (scripts/browser/android-matrix-pieces.mjs) and the ASSETS (src/data/pieceSets.json:
// each black piece's image replaced by the white image of its kind, in all three image sets - the bug the phone showed, planted in the data).
//
//   npm run mutate -- scripts/mutation/configs/piece-themes.config.cjs        (chunks of at most 20 mutants; `--chunk N` runs one)
//
// The suites are the node and rendered tests (no browser): pieceThemes.test.ts (every theme x twelve pieces, the pixels of every asset), pieceThemes.dom.test.tsx (the real Piece, the 2-player
// board and the Bughouse screen under every theme), pieceColours.dom.test.tsx, pieceArt.test.ts and the synthetic photographs of androidMatrixPieces.test.ts. The matrix itself (a real
// Chromium) is NOT in this command; `--screens game-2p-theme-*,bughouse-all-pieces-dual-theme-*` is its own check.
// A name that says EQUIVALENT cannot change behaviour; the test named in it pins why.
const fs = require('node:fs');
const path = require('node:path');

const R = 'src/logic/pieceThemes.ts';
const PC = 'src/components/Piece.tsx';
const A = 'src/components/pieceArt.ts';
const PR = 'src/logic/fourPlayer/presentation.ts';
const M = 'scripts/browser/android-matrix-pieces.mjs';
const J = 'src/data/pieceSets.json';

// The assets are read from the real file (read only): a mutant's `find` is the exact text of one entry, which occurs once because every asset is a different picture.
const root = process.env.MUTATION_ROOT || path.resolve(__dirname, '..', '..', '..');
const sets = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'pieceSets.json'), 'utf8'));
const KINDS = [
  ['k', 'king'],
  ['q', 'queen'],
  ['r', 'rook'],
  ['b', 'bishop'],
  ['n', 'knight'],
  ['p', 'pawn'],
];
const assetMutants = [];
for (const theme of ['cburnett', 'merida', 'checkers']) {
  for (const [kind, word] of KINDS) {
    assetMutants.push([`asset: ${theme}'s black ${word} is the white ${word}`, J, `"b${kind}":"${sets[theme]['b' + kind]}"`, `"b${kind}":"${sets[theme]['w' + kind]}"`]);
  }
}

module.exports = {
  root: process.env.MUTATION_ROOT || undefined,
  copy: ['src', 'assets', 'scripts/browser', 'App.tsx', 'package.json', 'tsconfig.json', 'vitest.config.mts'],
  junction: ['node_modules'],
  cmd: 'npx vitest run src/logic/__tests__/pieceThemes.test.ts src/logic/__tests__/pieceArt.test.ts src/logic/__tests__/androidMatrixPieces.test.ts src/screens/__tests__/pieceThemes.dom.test.tsx src/screens/__tests__/pieceColours.dom.test.tsx',
  mutantTimeoutMs: 6 * 60 * 1000,
  mutants: [
    // --- the registry ---
    ['registry: Cburnett is Merida', R, "{ id: 'cburnett', name: 'Cburnett', images: pieceSetImages.cburnett }", "{ id: 'cburnett', name: 'Cburnett', images: pieceSetImages.merida }"],
    ['registry: Merida is Cburnett', R, "{ id: 'merida', name: 'Merida', images: pieceSetImages.merida }", "{ id: 'merida', name: 'Merida', images: pieceSetImages.cburnett }"],
    ['registry: Chess with Checkers is Cburnett', R, "images: pieceSetImages.checkers }", "images: pieceSetImages.cburnett }"],
    ['registry: the built-in theme has images', R, "{ id: DEFAULT_PIECE_THEME_ID, name: 'Classic' },", "{ id: DEFAULT_PIECE_THEME_ID, name: 'Classic', images: pieceSetImages.cburnett },"],
    ['registry: the default id is another word', R, "export const DEFAULT_PIECE_THEME_ID = 'default';", "export const DEFAULT_PIECE_THEME_ID = 'classic';"],
    ['registry: the built-in theme is called Default', R, "name: 'Classic' }", "name: 'Default' }"],
    ['registry: an unknown id is the second theme', R, '?? AVAILABLE_PIECE_THEMES[0]', '?? AVAILABLE_PIECE_THEMES[1]'],
    ['registry: an unknown id is no theme', R, 'theme.id === id) ?? AVAILABLE_PIECE_THEMES[0]', 'theme.id === id) ?? (undefined as never)'],
    ['registry: removing a missing id removes the last theme', R, 'if (index !== -1) AVAILABLE_PIECE_THEMES.splice(index, 1);', 'AVAILABLE_PIECE_THEMES.splice(index, 1);'],
    ['registry: a custom theme goes first', R, 'AVAILABLE_PIECE_THEMES.push(theme);', 'AVAILABLE_PIECE_THEMES.unshift(theme);'],
    ['registry: removal takes two', R, 'AVAILABLE_PIECE_THEMES.splice(index, 1);', 'AVAILABLE_PIECE_THEMES.splice(index, 2);'],
    // --- the piece ---
    ['piece: the key has the colour flipped', PC, "const key = `${piece.color}${piece.type}`;", "const key = `${piece.color === 'w' ? 'b' : 'w'}${piece.type}`;"],
    ['piece: the key is kind then colour', PC, "const key = `${piece.color}${piece.type}`;", "const key = `${piece.type}${piece.color}`;"],
    ['piece: the label has the colours swapped', PC, "piece.color === 'w' ? 'white' : 'black'", "piece.color === 'w' ? 'black' : 'white'"],
    ['piece: a rook is called a queen', PC, "r: 'rook', q: 'queen'", "r: 'queen', q: 'rook'"],
    ['piece: an image is never used', PC, 'if (imageUri) {', 'if (false) {'],
    ['piece: the marker names the wrong key', PC, '{ dataSet: { piece: key } }', "{ dataSet: { piece: 'wk' } }"],
    ['piece: the image box is 80 %', PC, "width: '85%',\n    height: '85%',", "width: '80%',\n    height: '80%',"],
    ['piece: the image does not fill its box', PC, "width: '100%',\n    height: '100%',", "width: '90%',\n    height: '90%',"],
    ['piece: the image wrapper is no image for a screen reader', PC, '<View style={styles.pieceImage} accessibilityRole="image"', '<View style={styles.pieceImage}'],
    ['piece: the vector is 80 % of its cell', PC, 'Math.floor(size * 0.9)', 'Math.floor(size * 0.8)'],
    ['piece: the vector without a cell is 32', PC, 'size === undefined ? 36 :', 'size === undefined ? 32 :'],
    // --- the built-in ink ---
    ['ink: the white fill is grey', A, "fill: '#fafafa', outline: '#1b1b1b'", "fill: '#c8c8c8', outline: '#1b1b1b'"],
    ['ink: the black fill is grey', A, "fill: '#1d1d1d', outline: '#f1f1f1'", "fill: '#606060', outline: '#f1f1f1'"],
    ['ink: the white outline is the black one', A, "outline: '#1b1b1b'", "outline: '#f1f1f1'"],
    ['ink: the black outline is dark', A, "outline: '#f1f1f1'", "outline: '#1b1b1b'"],
    ['ink: the colours are swapped', A, "color === 'w' ? WHITE_PIECE_INK : BLACK_PIECE_INK", "color === 'w' ? BLACK_PIECE_INK : WHITE_PIECE_INK"],
    ['ink: every piece is white', A, "color === 'w' ? WHITE_PIECE_INK : BLACK_PIECE_INK", 'WHITE_PIECE_INK'],
    ['shapes: the rook is the king', A, "r: ['M26 86 L26 76 L32 70 L32 40 L26 34 L26 18 L38 18 L38 26 L45 26 L45 18 L55 18 L55 26 L62 26 L62 18 L74 18 L74 34 L68 40 L68 70 L74 76 L74 86 Z'],", "r: ['M46 8 L54 8 L54 16 L62 16 L62 24 L54 24 L54 32 C70 38 78 52 74 70 L78 86 L22 86 L26 70 C22 52 30 38 46 32 L46 24 L38 24 L38 16 L46 16 Z'],"],
    // --- the 4-seat boards' key map ---
    ['seats: Blue draws the black set', PR, "export const SEAT_PIECE_SET = ['w', 'w', 'b', 'w'] as const;", "export const SEAT_PIECE_SET = ['w', 'b', 'b', 'w'] as const;"],
    ['seats: Yellow draws the white set', PR, "export const SEAT_PIECE_SET = ['w', 'w', 'b', 'w'] as const;", "export const SEAT_PIECE_SET = ['w', 'w', 'w', 'w'] as const;"],
    ['seats: a promoted queen is a king', PR, "'q', 'k', 'q', 'n', 'b', 'r']", "'q', 'k', 'k', 'n', 'b', 'r']"],
    ['seats: a rook is a bishop', PR, "['', 'p', 'n', 'b', 'r', 'q', 'k'", "['', 'p', 'n', 'b', 'b', 'q', 'k'"],
    // --- the image judge of the device matrix ---
    ['judge: blocks of 4', M, 'export const IMAGE_BLOCK = 8;', 'export const IMAGE_BLOCK = 4;'],
    ['judge: blocks of 16', M, 'export const IMAGE_BLOCK = 8;', 'export const IMAGE_BLOCK = 16;'],
    ['judge: a limit of 40', M, 'export const IMAGE_MAX_DISTANCE = 15;', 'export const IMAGE_MAX_DISTANCE = 40;'],
    ['judge: a limit of 5', M, 'export const IMAGE_MAX_DISTANCE = 15;', 'export const IMAGE_MAX_DISTANCE = 5;'],
    ['judge: the colour of the nearest asset does not matter', M, 'if (nearest[0] !== marker[0]) return', 'if (nearest[0] === "x") return'],
    ['judge: only the opposite colour is a fault', M, 'if (nearest[0] !== marker[0]) return', 'if (nearest[0] === marker[0]) return'],
    ['judge: the limit is not applied', M, 'if (own > IMAGE_MAX_DISTANCE) return', 'if (own > Infinity) return'],
    ['judge: the other colour is looked up with the same colour', M, "distances[(marker[0] === 'w' ? 'b' : 'w') + marker[1]]", 'distances[marker]'],
    ['judge: the asset is looked up by its kind only', M, 'if (!assets[marker]) return', 'if (!assets[marker[0]]) return'],
    ['judge: the square is read from the other corner', M, 'png.data[(1 * png.width + 1) * 4], png.data[(1 * png.width + 1) * 4 + 1], png.data[(1 * png.width + 1) * 4 + 2]', 'png.data[(png.height - 2) * png.width * 4 + (png.width - 2) * 4], png.data[(png.height - 2) * png.width * 4 + (png.width - 2) * 4 + 1], png.data[(png.height - 2) * png.width * 4 + (png.width - 2) * 4 + 2]'],
    ['judge: the piece covers the square without blending', M, 'background[c] * (1 - a)', 'background[c] * (1 - a) * 0'],
    ['judge: the square shows through twice', M, 'background[c] * (1 - a)', 'background[c] * (1 - a) + background[c] * a'],
    ['judge: the rectangle is read from its far corner', M, '((x - rect.x) / rect.w) * asset.width', '((x + rect.x) / rect.w) * asset.width'],
    ['judge: the rectangle height is the width', M, '((y + 1 - rect.y) / rect.h) * asset.height', '((y + 1 - rect.y) / rect.w) * asset.height'],
    ['judge: the blocks round down', M, 'const bw = Math.ceil(image.width / IMAGE_BLOCK);', 'const bw = Math.floor(image.width / IMAGE_BLOCK);'],
    ['judge: the distance is the sum, not the mean', M, 'return sum / x.length;', 'return sum;'],
    ['judge: the distance is signed', M, 'sum += Math.abs(x[i] - y[i]);', 'sum += x[i] - y[i];'],
    ...assetMutants,
  ],
};
