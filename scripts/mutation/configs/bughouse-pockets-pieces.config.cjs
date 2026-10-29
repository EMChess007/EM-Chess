// Mutation set for the Bughouse pocket strip and the vector pieces (command #27b, branch paired/bughouse): the pocket geometry (src/logic/bughousePocket.ts), the strip and its chips
// (BughouseBoardBlock), the piece art and its ink (pieceArt.ts, Piece, PieceIcon, FourPlayerBoard's seat pieces), the test-only fixture switch (bughouseFixture.ts) and the pixel judgement of the
// device matrix (scripts/browser/android-matrix-pieces.mjs).
//
//   npm run mutate -- scripts/mutation/configs/bughouse-pockets-pieces.config.cjs        (chunks of at most 20 mutants; `--chunk N` runs one)
//
// The suites are the node and rendered tests (no browser): the geometry as literals, the fixtures, the ink of all twelve kinds, the rendered pockets (counts, colours, styles, the measured
// strip and row through the layout handler react-native-web keeps on each node, drops on both input paths) and the synthetic-image tests of the pixel judgement. The device matrix itself
// (rectangles and pixels in a real Chromium) is NOT in this command; its self-test covers its checks.
// A name that says EQUIVALENT cannot change behaviour; the test named in it pins why.
const P = 'src/logic/bughousePocket.ts';
const B = 'src/components/BughouseBoardBlock.tsx';
const A = 'src/components/pieceArt.ts';
const PI = 'src/components/PieceIcon.tsx';
const PC = 'src/components/Piece.tsx';
const F = 'src/logic/bughouseFixture.ts';
const M = 'scripts/browser/android-matrix-pieces.mjs';
const FP = 'src/components/FourPlayerBoard.tsx';
const BB = 'src/components/BughouseBoard.tsx';

module.exports = {
  root: process.env.MUTATION_ROOT || undefined,
  copy: ['src', 'assets', 'scripts/browser', 'App.tsx', 'package.json', 'tsconfig.json', 'vitest.config.mts'],
  junction: ['node_modules'],
  cmd:
    'npx vitest run src/logic/__tests__/bughousePocket.test.ts src/logic/__tests__/bughouseFixture.test.ts src/logic/__tests__/pieceArt.test.ts src/logic/__tests__/androidMatrixPieces.test.ts src/screens/__tests__/bughousePockets.dom.test.tsx src/screens/__tests__/pieceColours.dom.test.tsx',
  mutantTimeoutMs: 6 * 60 * 1000,
  mutants: [
    // --- the geometry ---
    ['pocket: four chips at most', P, 'export const POCKET_MAX_CHIPS = 5;', 'export const POCKET_MAX_CHIPS = 4;'],
    ['pocket: a taller chip', P, 'export const POCKET_CHIP_HEIGHT = 26;', 'export const POCKET_CHIP_HEIGHT = 28;'],
    ['pocket: a shorter compact chip', P, 'export const POCKET_CHIP_HEIGHT_COMPACT = 24;', 'export const POCKET_CHIP_HEIGHT_COMPACT = 22;'],
    ['pocket: the smallest chip is 22', P, 'export const POCKET_CHIP_MIN_WIDTH = 24;', 'export const POCKET_CHIP_MIN_WIDTH = 22;'],
    ['pocket: the widest chip is 44', P, 'export const POCKET_CHIP_MAX_WIDTH = 40;', 'export const POCKET_CHIP_MAX_WIDTH = 44;'],
    ['pocket: the gap is 3', P, 'export const POCKET_GAP = 2;', 'export const POCKET_GAP = 3;'],
    ['pocket: the padding is 3', P, 'export const POCKET_PADDING = 2;', 'export const POCKET_PADDING = 3;'],
    ['pocket: the compact chip is not shorter', P, 'compact ? POCKET_CHIP_HEIGHT_COMPACT : POCKET_CHIP_HEIGHT', 'compact ? POCKET_CHIP_HEIGHT : POCKET_CHIP_HEIGHT'],
    ['pocket: the piece is 4 smaller than the chip', P, 'pocketChipHeight(compact) - 6', 'pocketChipHeight(compact) - 4'],
    ['pocket: no pocket needs 1', P, 'if (chips <= 0) return 0;', 'if (chips < 0) return 0;'],
    ['pocket: the minimum forgets the padding', P, '2 * POCKET_PADDING + chips * POCKET_CHIP_MIN_WIDTH', 'chips * POCKET_CHIP_MIN_WIDTH'],
    ['pocket: the minimum forgets a gap', P, '(chips - 1) * POCKET_GAP;\n}\n\n/**\n * The width of each chip', 'chips * POCKET_GAP;\n}\n\n/**\n * The width of each chip'],
    ['pocket: an unmeasured row gets the widest chips', P, 'if (rowWidth === null || chips <= 0) return POCKET_CHIP_MIN_WIDTH;', 'if (rowWidth === null || chips <= 0) return POCKET_CHIP_MAX_WIDTH;'],
    ['pocket: an unmeasured row is measured as 0', P, 'if (rowWidth === null || chips <= 0) return POCKET_CHIP_MIN_WIDTH;', 'if (chips <= 0) return POCKET_CHIP_MIN_WIDTH;'],
    ['pocket: no chips gets the widest', P, 'if (rowWidth === null || chips <= 0) return', 'if (rowWidth === null) return'],
    ['pocket: the room forgets the padding', P, 'const room = rowWidth - 2 * POCKET_PADDING - (chips - 1) * POCKET_GAP;', 'const room = rowWidth - (chips - 1) * POCKET_GAP;'],
    ['pocket: the room forgets the gaps', P, 'const room = rowWidth - 2 * POCKET_PADDING - (chips - 1) * POCKET_GAP;', 'const room = rowWidth - 2 * POCKET_PADDING;'],
    ['pocket: the width is rounded, not floored', P, 'Math.floor(room / chips)', 'Math.round(room / chips)'],
    ['pocket: the width is rounded up', P, 'Math.floor(room / chips)', 'Math.ceil(room / chips)'],
    ['pocket: no floor', P, 'Math.max(POCKET_CHIP_MIN_WIDTH, Math.min(POCKET_CHIP_MAX_WIDTH, Math.floor(room / chips)))', 'Math.min(POCKET_CHIP_MAX_WIDTH, Math.floor(room / chips))'],
    ['pocket: no ceiling', P, 'Math.max(POCKET_CHIP_MIN_WIDTH, Math.min(POCKET_CHIP_MAX_WIDTH, Math.floor(room / chips)))', 'Math.max(POCKET_CHIP_MIN_WIDTH, Math.floor(room / chips))'],
    ['pocket: floor and ceiling swapped', P, 'Math.max(POCKET_CHIP_MIN_WIDTH, Math.min(POCKET_CHIP_MAX_WIDTH, Math.floor(room / chips)))', 'Math.min(POCKET_CHIP_MIN_WIDTH, Math.max(POCKET_CHIP_MAX_WIDTH, Math.floor(room / chips)))'],
    // --- the strip ---
    ['strip: padding 6', P, 'export const STRIP_PADDING = 4;', 'export const STRIP_PADDING = 6;'],
    ['strip: gap 6', P, 'export const STRIP_GAP = 4;', 'export const STRIP_GAP = 6;'],
    ['strip: dot 12', P, 'export const STRIP_DOT = 10;', 'export const STRIP_DOT = 12;'],
    ['strip: shape 14', P, 'export const STRIP_SHAPE = 12;', 'export const STRIP_SHAPE = 14;'],
    ['strip: clock 58', P, 'export const STRIP_CLOCK_MIN_WIDTH = 46;', 'export const STRIP_CLOCK_MIN_WIDTH = 58;'],
    ['strip: name 40', P, 'export const STRIP_NAME_MIN_WIDTH = 56;', 'export const STRIP_NAME_MIN_WIDTH = 40;'],
    ['strip: three gaps', P, '+ 4 * STRIP_GAP;', '+ 3 * STRIP_GAP;'],
    ['strip: the padding counted once', P, '2 * STRIP_PADDING + STRIP_DOT', 'STRIP_PADDING + STRIP_DOT'],
    ['strip: the name threshold forgets the pocket', P, 'STRIP_FIXED_WIDTH + pocketMinWidth(POCKET_MAX_CHIPS) + STRIP_NAME_MIN_WIDTH', 'STRIP_FIXED_WIDTH + STRIP_NAME_MIN_WIDTH'],
    ['strip: the name threshold is for a pocket of four', P, 'pocketMinWidth(POCKET_MAX_CHIPS) + STRIP_NAME_MIN_WIDTH', 'pocketMinWidth(4) + STRIP_NAME_MIN_WIDTH'],
    ['strip: the name is hidden at exactly the threshold', P, 'stripWidth === null || stripWidth >= NAME_MIN_STRIP_WIDTH', 'stripWidth === null || stripWidth > NAME_MIN_STRIP_WIDTH'],
    ['strip: the name is hidden before the first measurement', P, 'stripWidth === null || stripWidth >= NAME_MIN_STRIP_WIDTH', 'stripWidth !== null && stripWidth >= NAME_MIN_STRIP_WIDTH'],
    ['strip: the name is always shown', P, 'stripWidth === null || stripWidth >= NAME_MIN_STRIP_WIDTH', 'true'],
    // --- the narrow strip ---
    ['narrow: the narrow chip is 18', P, 'export const POCKET_CHIP_MIN_WIDTH_NARROW = 20;', 'export const POCKET_CHIP_MIN_WIDTH_NARROW = 18;'],
    ['narrow: the narrow clock is 46', P, 'export const STRIP_CLOCK_MIN_WIDTH_NARROW = 40;', 'export const STRIP_CLOCK_MIN_WIDTH_NARROW = 46;'],
    ['narrow: the narrow fixed part forgets the gap', P, '2 * STRIP_PADDING + STRIP_CLOCK_MIN_WIDTH_NARROW + STRIP_GAP', '2 * STRIP_PADDING + STRIP_CLOCK_MIN_WIDTH_NARROW'],
    ['narrow: the narrow threshold forgets the pocket', P, 'STRIP_FIXED_WIDTH + pocketMinWidth(POCKET_MAX_CHIPS);', 'STRIP_FIXED_WIDTH;'],
    ['narrow: the narrowest strip counts 24 dp chips', P, 'pocketMinWidth(POCKET_MAX_CHIPS, POCKET_CHIP_MIN_WIDTH_NARROW);', 'pocketMinWidth(POCKET_MAX_CHIPS);'],
    ['narrow: a strip of exactly 224 is narrow', P, 'stripWidth !== null && stripWidth < NARROW_STRIP_WIDTH', 'stripWidth !== null && stripWidth <= NARROW_STRIP_WIDTH'],
    ['narrow: an unmeasured strip is narrow', P, 'stripWidth !== null && stripWidth < NARROW_STRIP_WIDTH', 'stripWidth === null || stripWidth < NARROW_STRIP_WIDTH'],
    ['narrow: no strip is narrow', P, 'stripWidth !== null && stripWidth < NARROW_STRIP_WIDTH', 'false'],
    ['narrow: the marks stay', P, 'export const showStripMarks = (stripWidth: number | null): boolean => !isNarrowStrip(stripWidth);', 'export const showStripMarks = (stripWidth: number | null): boolean => true;'],
    ['narrow: the chips stay 24', P, 'isNarrowStrip(stripWidth) ? POCKET_CHIP_MIN_WIDTH_NARROW : POCKET_CHIP_MIN_WIDTH', 'POCKET_CHIP_MIN_WIDTH'],
    ['narrow: the clock stays 46', P, 'isNarrowStrip(stripWidth) ? STRIP_CLOCK_MIN_WIDTH_NARROW : STRIP_CLOCK_MIN_WIDTH', 'STRIP_CLOCK_MIN_WIDTH'],
    ['narrow: the chip minimum argument is ignored by the width', P, 'return Math.max(chipMin, Math.min(POCKET_CHIP_MAX_WIDTH, Math.floor(room / chips)));', 'return Math.max(POCKET_CHIP_MIN_WIDTH, Math.min(POCKET_CHIP_MAX_WIDTH, Math.floor(room / chips)));'],
    ['narrow: the chip minimum argument is ignored when unmeasured', P, 'if (rowWidth === null || chips <= 0) return chipMin;', 'if (rowWidth === null || chips <= 0) return POCKET_CHIP_MIN_WIDTH;'],
    ['narrow: the chip minimum argument is ignored by the pocket minimum', P, '2 * POCKET_PADDING + chips * chipMin + (chips - 1) * POCKET_GAP', '2 * POCKET_PADDING + chips * POCKET_CHIP_MIN_WIDTH + (chips - 1) * POCKET_GAP'],
    ['narrow: the piece may outgrow a narrow chip', P, 'Math.min(pocketChipHeight(compact) - 6, chipWidth - 4)', 'pocketChipHeight(compact) - 6'],
    ['narrow: the piece is 2 less than the chip, not 4', P, 'Math.min(pocketChipHeight(compact) - 6, chipWidth - 4)', 'Math.min(pocketChipHeight(compact) - 6, chipWidth - 2)'],
    ['block: the dot and the shape are always drawn', B, '{showStripMarks(stripWidth) && <View style={[styles.colourDot', '{true && <View style={[styles.colourDot'],
    ['block: the shape is always drawn', B, '{showStripMarks(stripWidth) && (\n        <Text maxFontSizeMultiplier={1} style={styles.shape}>', '{true && (\n        <Text maxFontSizeMultiplier={1} style={styles.shape}>'],
    ['block: the pocket does not reserve its room', B, '{ flexBasis: pocketMinWidth(POCKET_MAX_CHIPS, stripChipMin(stripWidth)) },', ''],
    ['block: the pocket reserves 24 dp chips in a narrow strip', B, 'flexBasis: pocketMinWidth(POCKET_MAX_CHIPS, stripChipMin(stripWidth))', 'flexBasis: pocketMinWidth(POCKET_MAX_CHIPS)'],
    ['block: the pocket may shrink', B, 'pocket: { flexGrow: 1, flexShrink: 0,', 'pocket: { flexGrow: 1, flexShrink: 1,'],
    ['block: the clock ignores the narrow strip', B, '{ minWidth: stripClockMin(stripWidth) },', ''],
    ['block: the chip ignores the narrow minimum', B, 'pocketChipWidth(rowWidth, chips.length, stripChipMin(stripWidth))', 'pocketChipWidth(rowWidth, chips.length)'],
    ['block: the piece ignores its chip', B, 'size={pocketPieceSize(Boolean(compact), chipWidth)}', 'size={pocketPieceSize(Boolean(compact))}'],
    // --- the strip and the chips on the screen ---
    ['block: the name is always drawn', B, '{showSeatName(stripWidth) && <Text style={styles.name}>', '{true && <Text style={styles.name}>'],
    ['block: the strip is never measured', B, 'onLayout={(e) => setStripWidth(Math.round(e.nativeEvent.layout.width))}', ''],
    ['block: the pocket row is never measured', B, 'onLayout={(e) => setRowWidth(Math.round(e.nativeEvent.layout.width))}', ''],
    ['block: the chips ignore the measured row', B, 'pocketChipWidth(rowWidth, chips.length)', 'pocketChipWidth(null, chips.length)'],
    ['block: the chips are not given their width', B, 'style: [styles.chip, { width: chipWidth },', 'style: [styles.chip,'],
    ['block: the pocket wraps', B, "flexWrap: 'nowrap', alignItems: 'center', justifyContent: 'flex-start', gap: POCKET_GAP", "flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-start', gap: POCKET_GAP"],
    ['block: the strip does not clip', B, "borderColor: 'transparent', overflow: 'hidden' },\n    barRunning", "borderColor: 'transparent' },\n    barRunning"],
    ['block: the chips may shrink', B, 'chip: { height: pocketChipHeight(compact), flexShrink: 0,', 'chip: { height: pocketChipHeight(compact),'],
    ['block: a chip of the wrong colour', B, '<PieceIcon type={chip.piece} ink={pieceInk(place.color)}', "<PieceIcon type={chip.piece} ink={pieceInk('w')}"],
    ['block: the chip piece is the wrong kind', B, '<PieceIcon type={chip.piece}', "<PieceIcon type={'p'}"],
    ['block: the count is not on the chip', B, '<Text maxFontSizeMultiplier={1} style={styles.count}>{chip.count}</Text>', '<Text maxFontSizeMultiplier={1} style={styles.count}>{1}</Text>'],
    ['block: the strip has no name for a screen reader', B, 'accessibilityLabel={`${seatName(seat)}, board ${place.board} ${word}`}', ''],
    ['block: the pocket is as tall as the strip needs only when it has chips', B, 'height: pocketChipHeight(compact) + 2,', 'minHeight: pocketChipHeight(compact) + 2,'],
    ['block: the compact strip is as tall as the other', B, 'minHeight: compact ? 30 : 36,', 'minHeight: 36,'],
    ['block: the promotion choice is drawn in White always', B, 'ink={pieceInk(match.verdicts[board].turn)} size={30}', "ink={pieceInk('w')} size={30}"],
    // --- the pieces ---
    ['art: the white fill is not white', A, "fill: '#fafafa', outline: '#1b1b1b'", "fill: '#c0c0c0', outline: '#1b1b1b'"],
    ['art: the black fill is not black', A, "fill: '#1d1d1d', outline: '#f1f1f1'", "fill: '#909090', outline: '#f1f1f1'"],
    ['art: white and black are swapped', A, "return color === 'w' ? WHITE_PIECE_INK : BLACK_PIECE_INK;", "return color === 'w' ? BLACK_PIECE_INK : WHITE_PIECE_INK;"],
    ['art: the king is the queen\'s shape', A, "  k: ['M46 8 L54 8", "  k: [...['M24 86 L18 34 L36 52 L50 22 L64 52 L82 34 L76 86 Z'], 'M46 8 L54 8"],
    ['art: the outline is 2', A, 'export const PIECE_OUTLINE_WIDTH = 4;', 'export const PIECE_OUTLINE_WIDTH = 2;'],
    ['piece: the colour is always white', PC, '<PieceIcon type={piece.type} ink={pieceInk(piece.color)} size={side} />', "<PieceIcon type={piece.type} ink={pieceInk('w')} size={side} />"],
    ['piece: the piece has no marker', PC, '{...pieceData(key)}', ''],
    ['piece: the label says the wrong colour', PC, "`${piece.color === 'w' ? 'white' : 'black'} ${PIECE_WORDS[piece.type]}`", "`${piece.color === 'w' ? 'black' : 'white'} ${PIECE_WORDS[piece.type]}`"],
    ['piece: a themed piece is drawn as a vector', PC, 'if (imageUri) {', 'if (false && imageUri) {'],
    ['icon: the fill is the outline', PI, 'fill={ink.fill} stroke={ink.outline}', 'fill={ink.outline} stroke={ink.outline}'],
    ['icon: the outline is the fill', PI, 'fill={ink.fill} stroke={ink.outline}', 'fill={ink.fill} stroke={ink.fill}'],
    ['icon: only the first path of a piece is drawn', PI, '{PIECE_PATHS[type].map((d) => (', '{PIECE_PATHS[type].slice(0, 1).map((d) => ('],
    ['seat piece: every seat is drawn red', FP, 'fill: dead ? DEAD_COLOR : SEAT_COLORS[seat]', 'fill: dead ? DEAD_COLOR : SEAT_COLORS[0]'],
    ['seat piece: the queen shape for every piece', FP, "const SHAPE_OF_TYPE: readonly PieceShapeType[] = ['p', 'p', 'n', 'b', 'r', 'q', 'k', 'q', 'n', 'b', 'r'];", "const SHAPE_OF_TYPE: readonly PieceShapeType[] = ['p', 'q', 'q', 'q', 'q', 'q', 'q', 'q', 'q', 'q', 'q'];"],
    ['board: the squares are the wrong way round', BB, 'const light = (file + rank) % 2 === 0;', 'const light = (file + rank) % 2 === 1;'],
    ['board: the piece is not sized from its cell', BB, '<Piece piece={{ color, type } as never} images={images} size={cell} />', '<Piece piece={{ color, type } as never} images={images} />'],
    // --- the fixtures ---
    ['fixture: honoured in a release build', F, "if (!dev || platform !== 'web') {", "if (false) {"],
    ['fixture: honoured on a phone', F, "if (!dev || platform !== 'web') {", "if (!dev) {"],
    ['fixture: honoured on the web in a release build', F, "if (!dev || platform !== 'web') {", "if (platform !== 'web') {"],
    ['fixture: any string is a fixture', F, "if (typeof raw === 'string' && (BUGHOUSE_FIXTURE_NAMES as readonly string[]).includes(raw)) return raw as BughouseFixtureName;", 'if (typeof raw === \'string\') return raw as BughouseFixtureName;'],
    ['fixture: an unset switch warns', F, 'if (raw === undefined || raw === null) return null;', ''],
    ['fixture: the warning prints the value', F, "warn('[bughouse] a test-only fixture switch was set and is ignored (it works only on the web in a development build)');", "warn('[bughouse] a test-only fixture switch was set and is ignored: ' + String(raw));"],
    ['fixture: the pocket of seat 1 is empty', F, '1: { p: 16, n: 9, b: 12, r: 10, q: 1 },', '1: {},'],
    ['fixture: no promoted piece on A', F, "promotedA: ['b7'],", 'promotedA: [],'],
    ['fixture: Black to move on A', F, "a: 'r3k2r/pQp2ppp/2n5/8/8/5N2/PP1PPPPP/R3K2R w KQkq - 0 1',", "a: 'r3k2r/pQp2ppp/2n5/8/8/5N2/PP1PPPPP/R3K2R b KQkq - 0 1',"],
    ['fixture: the clocks start at 1000', F, 'runningSince: verdicts[place.board].turn === place.color ? 0 : null', 'runningSince: verdicts[place.board].turn === place.color ? 1000 : null'],
    ['fixture: a queen only on one square colour', F, "b: '3k4/8/2q5/4Q3/8/8/8/3K4 w - - 0 1',", "b: '3k4/8/2q5/3Q4/8/8/8/3K4 w - - 0 1',"],
    // --- the pixel judgement ---
    ['pixels: white ink is not white', M, 'w: [0xfa, 0xfa, 0xfa],', 'w: [0xc0, 0xc0, 0xc0],'],
    ['pixels: black ink is not black', M, 'b: [0x1d, 0x1d, 0x1d],', 'b: [0x60, 0x60, 0x60],'],
    ['pixels: yellow seat is another yellow', M, '[0xf9, 0xa8, 0x25],', '[0xf9, 0xa8, 0x80],'],
    ['pixels: the tolerance is 80', M, 'export const INK_TOLERANCE = 40;', 'export const INK_TOLERANCE = 80;'],
    ['pixels: the tolerance is 10', M, 'export const INK_TOLERANCE = 40;', 'export const INK_TOLERANCE = 10;'],
    ['pixels: a distance of 40 is a match only below', M, 'distance(measured, ink) <= INK_TOLERANCE', 'distance(measured, ink) < INK_TOLERANCE'],
    ['pixels: a black king drawn white passes', M, 'if (!inkMatches(piece, ink))', 'if (false)'],
    ['pixels: no piece is not a problem', M, 'if (piece === null || fraction < MIN_PIECE_FRACTION)', 'if (piece === null)'],
    ['pixels: the background is the centre pixel', M, 'const background = at(1, 1);', 'const background = at(width >> 1, height >> 1);'],
    ['pixels: the square colour counts as the piece', M, 'if (distance(pixel, background) <= BACKGROUND_DISTANCE) continue;', ''],
    ['pixels: the outline is the piece', M, 'if (best === null || bin.n > best.n) best = bin;', 'if (best === null || bin.n <= best.n) best = bin;'],
    ['pixels: a marker nobody knows is judged', M, 'if (ink === null) return `unknown piece marker "${marker}"`;', ''],
    ['pixels: a seat marker of seat 4', M, '/^([0-3]):[pnbrqk]$/', '/^([0-4]):[pnbrqk]$/'],
    ['pixels: a pawn is not a piece kind', M, '/^[wb][pnbrqk]$/', '/^[wb][nbrqk]$/'],
  ],
};
