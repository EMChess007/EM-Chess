import { StyleSheet, Text, View } from 'react-native';
import { MOVE_QUALITY_COLORS, MOVE_QUALITY_SYMBOLS, type MoveQuality } from '../logic/analysis';

interface MoveQualityBadgeProps {
  quality: MoveQuality;
  /** Circle diameter in px. Font size scales with it. */
  size?: number;
}

/** Small colored circle with the move-quality symbol inside, chess.com/Lichess-style. Reuses the
 * app's existing MOVE_QUALITY_COLORS/SYMBOLS mapping so it always matches AnalysisScreen. */
export default function MoveQualityBadge({ quality, size = 22 }: MoveQualityBadgeProps) {
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: MOVE_QUALITY_COLORS[quality] },
      ]}
    >
      <Text style={[styles.symbol, { fontSize: size * 0.52 }]} numberOfLines={1}>
        {MOVE_QUALITY_SYMBOLS[quality]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  symbol: {
    color: '#fff',
    fontWeight: '700',
  },
});
