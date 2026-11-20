import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

/**
 * The two Knightmate marks (see knightmate.ts), drawn over the ACTIVE piece theme's own pictures so they work in every theme, a custom one included, without any new art:
 *  - 'royal'    : a gold crown on the theme's KNIGHT  (the royal knight, Piece.type 'k' in Knightmate);
 *  - 'commoner' : a white "M" on the theme's KING     (the Commoner, Piece.type 'm') -- the same letter the notation and the move list use.
 * Both sit in a dark round chip with a light rim, in the top-right corner of the piece, so they read on a white piece, a black piece and every board colour.
 * Pure vector (react-native-svg), no font: a phone's fallback font cannot change it (command #27b).
 */
export type KnightmateBadgeKind = 'royal' | 'commoner';

/** A badge's colours as DATA (a rendered test and the rules-sheet legend read them, never a duplicate). */
export const KNIGHTMATE_BADGE_COLORS = { chip: '#262626', rim: '#f2f2f2', crown: '#f5c542', letter: '#ffffff' } as const;

/** The crown: a flat base, three points and three small balls, in a 24 x 24 box. */
export const KNIGHTMATE_CROWN_PATH = 'M5 17 L4 8 L9 12 L12 6 L15 12 L20 8 L19 17 Z';
/** The letter M as a stroked polyline in the same box. */
export const KNIGHTMATE_M_PATH = 'M6.5 17 L6.5 7 L12 13 L17.5 7 L17.5 17';

function KnightmateBadge({ kind }: { kind: KnightmateBadgeKind }) {
  const c = KNIGHTMATE_BADGE_COLORS;
  // The marker sits on a View wrapper (react-native-web renders its `dataSet` as data-* and its label as aria-label; the SVG does neither): a test and the device matrix find the badge by it.
  return (
    <View style={styles.badge} pointerEvents="none" accessibilityLabel={kind === 'royal' ? 'crown badge' : 'commoner badge'} {...({ dataSet: { badge: kind } } as object)}>
      <Svg width="100%" height="100%" viewBox="0 0 24 24" pointerEvents="none">
        <Circle cx={12} cy={12} r={11} fill={c.chip} stroke={c.rim} strokeWidth={1.5} />
        {kind === 'royal' ? (
          <>
            <Path d={KNIGHTMATE_CROWN_PATH} fill={c.crown} stroke={c.crown} strokeWidth={1} strokeLinejoin="round" />
            <Circle cx={4} cy={7} r={1.6} fill={c.crown} />
            <Circle cx={12} cy={5} r={1.6} fill={c.crown} />
            <Circle cx={20} cy={7} r={1.6} fill={c.crown} />
          </>
        ) : (
          <Path d={KNIGHTMATE_M_PATH} fill="none" stroke={c.letter} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: '-4%',
    right: '-6%',
    width: '40%',
    height: '40%',
  },
});

export default memo(KnightmateBadge);
