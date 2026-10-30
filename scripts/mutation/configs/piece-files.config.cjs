// Mutation set for the BUNDLED piece files, the vector paint, the custom-theme files, the Piece gallery's data, the build identifier and the matrix's progress file (command #27d, branch paired/bughouse).
//
//   npm run mutate -- scripts/mutation/configs/piece-files.config.cjs        (chunks of at most 20 mutants; `--chunk N` runs one)
//
// The registry and the asset rows (a black piece pointed at the white file of its kind) are in piece-themes.config.cjs. This set is the rest of #27d:
//   pieceImageSource.ts   what an Image is handed (an asset id as it is, a file URI as { uri })
//   pieceArt.ts / PieceIcon.tsx   every paint prop of a vector piece, written out
//   customPieceFiles.ts   a custom theme as files (the 12 data URIs of a draft -> 12 files, an old record migrated, a half-written theme removed)
//   pieceGallery.ts       the gallery's grid (rows, cell size)
//   buildInfo.ts / scripts/build-info.cjs   the build identifier
//   android-matrix-progress.mjs   the resumable progress file
// A name that says EQUIVALENT cannot change behaviour; the test named in it pins why. No browser is needed: node and rendered tests only.
const PI = 'src/components/pieceImageSource.ts';
const A = 'src/components/pieceArt.ts';
const PIC = 'src/components/PieceIcon.tsx';
const PC = 'src/components/Piece.tsx';
const CF = 'src/logic/customPieceFiles.ts';
const G = 'src/logic/pieceGallery.ts';
const BI = 'src/logic/buildInfo.ts';
const BC = 'scripts/build-info.cjs';
const PR = 'scripts/browser/android-matrix-progress.mjs';

module.exports = {
  root: process.env.MUTATION_ROOT || undefined,
  copy: ['src', 'assets', 'scripts/browser', 'scripts/generate-piece-assets.mjs', 'scripts/build-info.cjs', 'App.tsx', 'package.json', 'tsconfig.json', 'vitest.config.mts'],
  junction: ['node_modules'],
  cmd:
    'npx vitest run src/logic/__tests__/pieceAssets.test.ts src/logic/__tests__/pieceImageSource.test.ts src/logic/__tests__/customPieceFiles.test.ts src/logic/__tests__/pieceGallery.test.ts ' +
    'src/logic/__tests__/pieceArt.test.ts src/logic/__tests__/pieceThemes.test.ts src/logic/__tests__/androidMatrixProgress.test.ts ' +
    'src/screens/__tests__/pieceIcon.dom.test.tsx src/screens/__tests__/pieceGallery.dom.test.tsx src/screens/__tests__/pieceThemes.dom.test.tsx src/screens/__tests__/pieceColours.dom.test.tsx',
  mutantTimeoutMs: 6 * 60 * 1000,
  mutants: [
    // --- what an Image is handed ---
    ['source: everything is a { uri }', PI, "return typeof image === 'number' ? image : { uri: image };", 'return { uri: image as string };'],
    ['source: everything is passed as it is', PI, "return typeof image === 'number' ? image : { uri: image };", 'return image;'],
    ['source: a string is the asset id', PI, "typeof image === 'number'", "typeof image === 'string'"],
    ['piece: the image goes in as a hand-made { uri }', PC, 'source={pieceImageSource(imageUri)}', 'source={{ uri: imageUri as string }}'],
    // --- the vector paint, prop by prop ---
    ['paint: the fill is half transparent', A, '    fillOpacity: 1,', '    fillOpacity: 0.5,'],
    ['paint: the fill rule is even-odd', A, "    fillRule: 'nonzero',", "    fillRule: 'evenodd',"],
    ['paint: the stroke is half transparent', A, '    strokeOpacity: 1,', '    strokeOpacity: 0.5,'],
    ['paint: the stroke is 2 wide', A, '    strokeWidth: PIECE_OUTLINE_WIDTH,', '    strokeWidth: 2,'],
    ['paint: the outline is 8 wide', A, 'export const PIECE_OUTLINE_WIDTH = 4;', 'export const PIECE_OUTLINE_WIDTH = 8;'],
    ['paint: the join is a miter', A, "    strokeLinejoin: 'round',\n    strokeLinecap: 'round',\n  };", "    strokeLinejoin: 'miter',\n    strokeLinecap: 'round',\n  };"],
    ['paint: the cap is a butt', A, "    strokeLinecap: 'round',\n  };", "    strokeLinecap: 'butt',\n  };"],
    ['paint: the fill is the outline ink', A, '    fill: ink.fill,', '    fill: ink.outline,'],
    ['paint: the stroke is the fill ink', A, '    stroke: ink.outline,', '    stroke: ink.fill,'],
    ['icon: the svg colour is the outline', PIC, 'color={ink.fill}', 'color={ink.outline}'],
    ['icon: the default opacity is half', PIC, 'opacity={opacity ?? 1}', 'opacity={opacity ?? 0.5}'],
    ['icon: the paint is not applied', PIC, '<Path key={d} d={d} {...paint} />', '<Path key={d} d={d} />'],
    ['icon: the opacity is applied as given (undefined stays unset)', PIC, 'opacity={opacity ?? 1}', 'opacity={opacity}'],
    // --- a custom theme as files ---
    ['files: a data URI is kept as it is', CF, 'if (!isDataUri(image)) {', 'if (isDataUri(image)) {'],
    ['files: a file URI is also written', CF, '        out[key] = image;\n        continue;', '        out[key] = image;'],
    ['files: a failed write leaves the folder', CF, 'await store.removeDirectory(themeId).catch(() => undefined);\n    throw error;', 'throw error;'],
    ['files: a bundled asset id is accepted', CF, "if (typeof image !== 'string') throw new Error(`piece image ${key} is not a picked file`);", ''],
    ['files: WebP is not an image', CF, '(png|webp)', '(png)'],
    ['files: the payload is the extension', CF, "extension: match[1] as 'png' | 'webp', base64: match[2]", "extension: match[1] as 'png' | 'webp', base64: match[1]"],
    ['files: every file is a .png', CF, '`${key}.${parts.extension}`', '`${key}.png`'],
    ['files: a record with files is migrated again', CF, 'if (!hasDataUriImages(images)) return null;', ''],
    ['files: a failed migration throws', CF, '  } catch {\n    return null;\n  }', '  } catch (error) {\n    throw error;\n  }'],
    ['files: only an all-data-URI record is old', CF, 'Object.values(images).some(isDataUri)', 'Object.values(images).every(isDataUri)'],
    ['files: removing a theme throws', CF, 'await store.removeDirectory(themeId).catch(() => undefined);\n}', 'await store.removeDirectory(themeId);\n}'],
    // --- the gallery's grid ---
    ['gallery: a cell is at most 60', G, 'export const GALLERY_MAX_CELL = 56;', 'export const GALLERY_MAX_CELL = 60;'],
    ['gallery: a cell is at least 24', G, 'export const GALLERY_MIN_CELL = 28;', 'export const GALLERY_MIN_CELL = 24;'],
    ['gallery: the label column is 60', G, 'export const GALLERY_LABEL_WIDTH = 64;', 'export const GALLERY_LABEL_WIDTH = 60;'],
    ['gallery: the gutter is 12', G, 'export const GALLERY_GUTTER = 16;', 'export const GALLERY_GUTTER = 12;'],
    ['gallery: one gutter is taken off, not two', G, 'windowWidth - 2 * GALLERY_GUTTER - GALLERY_LABEL_WIDTH', 'windowWidth - GALLERY_GUTTER - GALLERY_LABEL_WIDTH'],
    ['gallery: five columns', G, 'room / GALLERY_KINDS.length', 'room / 5'],
    ['gallery: the cell rounds up', G, 'Math.floor(room / GALLERY_KINDS.length)', 'Math.ceil(room / GALLERY_KINDS.length)'],
    ['gallery: black before white', G, "export const GALLERY_COLORS = ['w', 'b'] as const;", "export const GALLERY_COLORS = ['b', 'w'] as const;"],
    ['gallery: dark before light', G, "export const GALLERY_SQUARES = ['light', 'dark'] as const;", "export const GALLERY_SQUARES = ['dark', 'light'] as const;"],
    ['gallery: the queen before the king', G, "export const GALLERY_KINDS = ['k', 'q', 'r', 'b', 'n', 'p'] as const;", "export const GALLERY_KINDS = ['q', 'k', 'r', 'b', 'n', 'p'] as const;"],
    ['gallery: the row label swaps the colours', G, "color === 'w' ? 'White' : 'Black'", "color === 'w' ? 'Black' : 'White'"],
    ['gallery: the cell label swaps the colours', G, "color === 'w' ? 'white' : 'black'", "color === 'w' ? 'black' : 'white'"],
    ['gallery: a pawn is a knight', G, "n: 'knight', p: 'pawn'", "n: 'pawn', p: 'knight'"],
    // --- the build identifier ---
    ['build: a dirty hash is refused', BI, '^[0-9a-f]{7,40}(-dirty)?$', '^[0-9a-f]{7,40}$'],
    ['build: a time with milliseconds is refused', BI, '(\\.\\d+)?Z$', 'Z$'],
    ['build: any hash is accepted', BI, 'COMMIT.test(raw.commit)', 'true'],
    ['build: the time shows seconds', BI, 'builtAt.slice(11, 16)', 'builtAt.slice(11, 19)'],
    ['build: the day is cut short', BI, 'builtAt.slice(0, 10)', 'builtAt.slice(0, 7)'],
    ['build: the label has no commit', BI, 'label: `build ${commit} · ${time}`', 'label: `build · ${time}`'],
    ['build: a missing time reads "unknown"', BI, "'time unknown'", "'unknown'"],
    ['build (bundler): an 8-digit hash', BC, "'--short=7'", "'--short=8'"],
    ['build (bundler): a clean tree is dirty', BC, 'exec([\'status\', \'--porcelain\']).length > 0', "exec(['status', '--porcelain']).length >= 0"],
    ['build (bundler): the dirty mark is dropped', BC, "commit += '-dirty';", "commit += '';"],
    ['build (bundler): a git failure crashes the bundler', BC, '  } catch {\n    // no git: "unknown"\n  }', '  } catch (error) {\n    throw error;\n  }'],
    ['build (bundler): an answer that is not a hash is taken', BC, 'if (/^[0-9a-f]{7,40}$/.test(hash)) {', 'if (hash) {'],
    // --- the matrix's progress file ---
    ['progress: another run\'s file is accepted', PR, 'JSON.stringify(first.header) !== JSON.stringify(header)', 'JSON.stringify(first.header) === JSON.stringify(header)'],
    ['progress: the header line is read as a screen', PR, 'for (const line of lines.slice(1)) {', 'for (const line of lines) {'],
    ['progress: a line of the wrong shape is read', PR, "if (typeof entry.done !== 'string' || !Array.isArray(entry.results)) continue;", ''],
    ['progress: a saved screen is not remembered', PR, '      done.add(key);\n    },', '    },'],
    ['progress: a cut line stops the read', PR, '        continue; // a line cut short by a kill: its screen runs again', '        break;'],
    ['progress: the results are not read back', PR, '      results.push(...entry.results);', ''],
  ],
};
