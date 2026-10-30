import { useState } from 'react';
import { Appearance, Image, PixelRatio, Platform, ScrollView, StyleSheet, useColorScheme, useWindowDimensions, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import PROBE_PNG from '../../assets/diagnostics/probe-black.png';
import { Pressable } from '../components/AppPressable';
import { DenseText as Text } from '../components/AppText';
import Piece from '../components/Piece';
import PieceIcon from '../components/PieceIcon';
import { pieceInk } from '../components/pieceArt';
import ScreenHeader from '../components/ScreenHeader';
import { getBuildInfo } from '../logic/buildInfo';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import {
  GALLERY_COLORS,
  GALLERY_GUTTER,
  GALLERY_KINDS,
  GALLERY_LABEL_WIDTH,
  GALLERY_ROWS,
  KIND_LETTERS,
  galleryCellLabel,
  galleryCellSize,
} from '../logic/pieceGallery';
import { AVAILABLE_PIECE_THEMES } from '../logic/pieceThemes';
import { useActiveBoardTheme, useActivePieceTheme } from '../logic/themeHooks';

interface PieceGalleryScreenProps {
  onBack: () => void;
}

/** The ink of the black piece, which the probes below are painted in: a plain view, a plain SVG shape and a flat PNG of exactly this colour. */
const PROBE_INK = pieceInk('b').fill;

/** react-native-web renders `dataSet` as data-* attributes (a phone ignores it): the matrix and the tests read the square a cell stands for. */
const squareData = (square: string) => ({ dataSet: { gallerySquare: square } }) as object;

/**
 * THE PIECE GALLERY (command #27d; More > Diagnostics > Piece gallery, in release builds too). A browser could not show the two Android-only colour bugs (Merida's black king and queen drawn
 * white, Classic's black pieces drawn light on the dark squares), so the PHONE is the test: for EVERY piece theme - the built-in ones and the custom ones - all twelve pieces on a light and
 * on a dark square of the active board theme, drawn by the very `Piece` the boards use, and the same twelve as pocket chips. The build identifier is in the fixed header, so one screenshot says
 * which commit drew it. At the top, three PROBES in the black piece's own ink (a plain view, a plain SVG shape, a flat PNG) on both square colours: if the phone lightens one kind of drawing on
 * the dark square and not the others, the cause is that kind of drawing, not a piece. The buttons set the app's colour scheme to light (and back): the system's own dark-mode darkening is one
 * candidate cause and this is the one-tap test of it.
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
  const squareColour = { light: board.lightColor, dark: board.darkColor } as const;
  const build = getBuildInfo();

  return (
    <View style={styles.container} testID="piece-gallery">
      <ScreenHeader title="Piece gallery" subtitle={build.label} onBack={onBack} backLabel="‹ Back" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.info} testID="gallery-device">
          {`${Platform.OS} ${String(Platform.Version)} · scale ${PixelRatio.get()} · font ${PixelRatio.getFontScale()} · system scheme ${systemScheme ?? 'none'} · app mode ${colors.mode} · board ${board.name} (${board.lightColor} / ${board.darkColor}) · active pieces ${activeTheme.name}`}
        </Text>
        <View style={styles.buttonRow}>
          <Pressable style={styles.button} onPress={() => Appearance.setColorScheme('light')} testID="gallery-lock-light">
            <Text style={styles.buttonText}>Lock app to light</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => Appearance.setColorScheme('unspecified')} testID="gallery-follow-system">
            <Text style={styles.buttonText}>Follow system</Text>
          </Pressable>
        </View>

        <Text style={styles.themeTitle}>Probes: the black ink #1d1d1d, three ways</Text>
        <View style={styles.probeRow} testID="gallery-probes">
          {(['light', 'dark'] as const).map((square) => (
            <View key={square} style={[styles.probeSquare, { backgroundColor: squareColour[square] }]} {...squareData(square)}>
              <View style={[styles.probe, { backgroundColor: PROBE_INK }]} accessibilityLabel={`plain view on a ${square} square`} />
              <Svg width={32} height={32} viewBox="0 0 32 32" accessibilityLabel={`svg rect on a ${square} square`}>
                <Rect x={0} y={0} width={32} height={32} fill={PROBE_INK} />
              </Svg>
              <Image source={PROBE_PNG} style={styles.probe} accessibilityLabel={`png on a ${square} square`} />
            </View>
          ))}
        </View>
        <Text style={styles.rowLabel}>Each square: plain view, SVG rect, PNG (left to right)</Text>

        {themes.map((theme) => (
          <View key={theme.id} style={styles.theme} testID={`gallery-theme-${theme.id}`}>
            <Text style={styles.themeTitle}>
              {theme.name}
              {theme.isCustom ? ' (custom)' : ''} · {theme.images ? 'image files' : 'vector'}
              {theme.id === activeTheme.id ? ' · active' : ''}
            </Text>
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
            {GALLERY_COLORS.map((color) => (
              <View key={color} style={styles.row} testID={`gallery-chips-${theme.id}-${color}`}>
                <Text style={[styles.rowLabel, { width: GALLERY_LABEL_WIDTH }]}>{color === 'w' ? 'White' : 'Black'} pocket</Text>
                {GALLERY_KINDS.map((kind) => (
                  <View key={kind} style={[styles.chip, { width: cell - 4, height: cell - 4 }]} accessibilityLabel={`${theme.name}: ${color === 'w' ? 'white' : 'black'} ${kind} pocket chip`}>
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
    buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginVertical: 6 },
    button: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, backgroundColor: colors.buttonBackground },
    buttonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
    theme: { marginTop: 14, gap: 4 },
    themeTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 8 },
    row: { flexDirection: 'row', alignItems: 'center' },
    rowLabel: { fontSize: 10, color: colors.textSecondary },
    kindLabel: { fontSize: 11, fontWeight: '700', color: colors.text, textAlign: 'center' },
    probeRow: { flexDirection: 'row', gap: 12 },
    probeSquare: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8 },
    probe: { width: 32, height: 32 },
    chip: { margin: 2, borderRadius: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    countPill: { position: 'absolute', right: -2, bottom: -2, minWidth: 14, height: 14, borderRadius: 7, backgroundColor: colors.buttonBackground, alignItems: 'center', justifyContent: 'center' },
    count: { fontSize: 9, color: '#fff', fontWeight: '700' },
  });
}
