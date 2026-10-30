import { useState } from 'react';
import { PixelRatio, Platform, ScrollView, StyleSheet, useColorScheme, useWindowDimensions, View } from 'react-native';
import { DenseText as Text } from '../components/AppText';
import Piece from '../components/Piece';
import PieceIcon from '../components/PieceIcon';
import { PIECE_CHIP_BACKGROUND, PIECE_CHIP_BORDER, pieceInk } from '../components/pieceArt';
import ScreenHeader from '../components/ScreenHeader';
import { AVAILABLE_BOARD_THEMES } from '../logic/boardThemes';
import { getBuildInfo } from '../logic/buildInfo';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import {
  GALLERY_COLORS,
  GALLERY_GAME_CELL,
  GALLERY_GUTTER,
  GALLERY_KINDS,
  GALLERY_LABEL_WIDTH,
  GALLERY_ROWS,
  GALLERY_SQUARES,
  KIND_LETTERS,
  galleryCellLabel,
  galleryCellSize,
  galleryGameCellLabel,
} from '../logic/pieceGallery';
import { AVAILABLE_PIECE_THEMES } from '../logic/pieceThemes';
import { useActiveBoardTheme, useActivePieceTheme } from '../logic/themeHooks';

interface PieceGalleryScreenProps {
  onBack: () => void;
}

/** react-native-web renders `dataSet` as data-* attributes (a phone ignores it): the matrix and the tests read the square a cell stands for. */
const squareData = (square: string) => ({ dataSet: { gallerySquare: square } }) as object;

/**
 * THE PIECE GALLERY (command #27d, reshaped in #28; More > Diagnostics > Piece gallery, in release builds too). A browser could not show the Android-only colour bugs, so the PHONE is the test.
 * For EVERY piece theme - the built-in ones and the custom ones - three views, all drawn by the very `Piece` the boards use:
 *   1. LARGE: all twelve pieces on a light and on a dark square of the ACTIVE board theme (the cell is up to 56 dp);
 *   2. GAME SIZE: the same twelve in 32 dp cells - what a game draws - on a light and a dark square of EVERY board theme (Classic, Wood, Green, Ocean, Marble and any custom one), because the
 *      first phone report was about one board theme's blue squares and not the active one;
 *   3. the pocket chips (the chip's own mid-tone background, pieceArt.ts).
 * The build identifier is in the fixed header, so one screenshot says which commit drew it. (The three colour probes and the "lock to light" buttons of #27d are gone: the phone's screenshots
 * proved Android recolours nothing, TESTING.md section 43.)
 */
export default function PieceGalleryScreen({ onBack }: PieceGalleryScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const board = useActiveBoardTheme();
  const activeTheme = useActivePieceTheme();
  const { width } = useWindowDimensions();
  const cell = galleryCellSize(width);
  const systemScheme = useColorScheme();
  const [themes] = useState(() => [...AVAILABLE_PIECE_THEMES]);
  const [boards] = useState(() => [...AVAILABLE_BOARD_THEMES]);
  const squareColour = { light: board.lightColor, dark: board.darkColor } as const;
  const build = getBuildInfo();

  return (
    <View style={styles.container} testID="piece-gallery">
      <ScreenHeader title="Piece gallery" subtitle={build.label} onBack={onBack} backLabel="‹ Back" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.info} testID="gallery-device">
          {`${Platform.OS} ${String(Platform.Version)} · scale ${PixelRatio.get()} · font ${PixelRatio.getFontScale()} · system scheme ${systemScheme ?? 'none'} · app mode ${colors.mode} · board ${board.name} (${board.lightColor} / ${board.darkColor}) · active pieces ${activeTheme.name}`}
        </Text>

        {themes.map((theme) => (
          <View key={theme.id} style={styles.theme} testID={`gallery-theme-${theme.id}`}>
            <Text style={styles.themeTitle}>
              {theme.name}
              {theme.isCustom ? ' (custom)' : ''} · {theme.images ? 'image files' : 'vector'}
              {theme.id === activeTheme.id ? ' · active' : ''}
            </Text>

            <Text style={styles.sectionTitle}>{`Large, on the active board (${board.name})`}</Text>
            <View style={styles.row}>
              <View style={{ width: GALLERY_LABEL_WIDTH }} />
              {GALLERY_KINDS.map((kind) => (
                <Text key={kind} style={[styles.kindLabel, { width: cell }]}>
                  {KIND_LETTERS[kind]}
                </Text>
              ))}
            </View>
            {GALLERY_ROWS.map((row) => (
              <View key={`${row.color}-${row.square}`} style={styles.row}>
                <Text style={[styles.rowLabel, { width: GALLERY_LABEL_WIDTH }]}>{row.label}</Text>
                {GALLERY_KINDS.map((kind) => (
                  <View
                    key={kind}
                    style={{ width: cell, height: cell, backgroundColor: squareColour[row.square], alignItems: 'center', justifyContent: 'center' }}
                    accessibilityLabel={galleryCellLabel(theme.name, row.color, kind, row.square)}
                    testID={`gallery-${theme.id}-${row.color}${kind}-${row.square}`}
                    {...squareData(row.square)}
                  >
                    <Piece piece={{ color: row.color, type: kind } as never} images={theme.images} size={cell} />
                  </View>
                ))}
              </View>
            ))}

            <Text style={styles.sectionTitle}>{`Game size (${GALLERY_GAME_CELL} dp), on every board theme`}</Text>
            {boards.map((b) => (
              <View key={b.id} style={styles.gameBoard} testID={`gallery-game-${theme.id}-${b.id}`}>
                <Text style={styles.rowLabel}>{`${b.name} board (${b.lightColor} / ${b.darkColor})`}</Text>
                {GALLERY_SQUARES.map((square) => (
                  <View key={square} style={styles.gameRow}>
                    {GALLERY_COLORS.map((color) => (
                      <View key={color} style={styles.row}>
                        {GALLERY_KINDS.map((kind) => (
                          <View
                            key={kind}
                            style={{ width: GALLERY_GAME_CELL, height: GALLERY_GAME_CELL, backgroundColor: square === 'light' ? b.lightColor : b.darkColor, alignItems: 'center', justifyContent: 'center' }}
                            accessibilityLabel={galleryGameCellLabel(theme.name, b.name, color, kind, square)}
                            testID={`gallery-game-${theme.id}-${b.id}-${color}${kind}-${square}`}
                            {...squareData(square)}
                          >
                            <Piece piece={{ color, type: kind } as never} images={theme.images} size={GALLERY_GAME_CELL} />
                          </View>
                        ))}
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            ))}

            <Text style={styles.sectionTitle}>Pocket chips</Text>
            {GALLERY_COLORS.map((color) => (
              <View key={color} style={styles.row} testID={`gallery-chips-${theme.id}-${color}`}>
                <Text style={[styles.rowLabel, { width: GALLERY_LABEL_WIDTH }]}>{color === 'w' ? 'White' : 'Black'} pocket</Text>
                {GALLERY_KINDS.map((kind) => (
                  <View key={kind} style={[styles.chip, { width: cell - 4, height: cell - 4, backgroundColor: PIECE_CHIP_BACKGROUND }]} accessibilityLabel={`${theme.name}: ${color === 'w' ? 'white' : 'black'} ${kind} pocket chip`}>
                    <PieceIcon type={kind} ink={pieceInk(color)} size={cell - 16} />
                    <View style={styles.countPill}>
                      <Text style={styles.count}>1</Text>
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </View>
        ))}
        <Text style={styles.info}>Pocket chips are always the vector set, as in a Bughouse game.</Text>
      </ScrollView>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: GALLERY_GUTTER, paddingBottom: 48, gap: 6 },
    info: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
    theme: { marginTop: 14, gap: 4 },
    themeTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 8 },
    sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.text, marginTop: 8 },
    row: { flexDirection: 'row', alignItems: 'center' },
    gameBoard: { gap: 2, marginTop: 4 },
    // the white group and the black group of a row sit side by side when the window is wide enough and wrap as whole groups of six when it is not
    gameRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 0 },
    rowLabel: { fontSize: 10, color: colors.textSecondary },
    kindLabel: { fontSize: 11, fontWeight: '700', color: colors.text, textAlign: 'center' },
    chip: { margin: 2, borderRadius: 6, backgroundColor: PIECE_CHIP_BACKGROUND, borderWidth: 1, borderColor: PIECE_CHIP_BORDER, alignItems: 'center', justifyContent: 'center' },
    countPill: { position: 'absolute', right: -2, bottom: -2, minWidth: 14, height: 14, borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
    count: { fontSize: 9, color: '#2a1d10', fontWeight: '700' },
  });
}
