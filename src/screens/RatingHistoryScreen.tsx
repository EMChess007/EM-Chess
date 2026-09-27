import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import ScreenHeader from '../components/ScreenHeader';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { RATING_CATEGORIES, type RatingCategory } from '../logic/rating';
import { getRatingHistory, useRatingHistory } from '../logic/ratingHistoryStorage';

interface RatingHistoryScreenProps {
  onBack: () => void;
}

const CATEGORY_LABELS: Record<RatingCategory, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
};

const CHART_HEIGHT = 200;
const CHART_PADDING = 16;

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Opens on whichever category actually has the most history, rather than always defaulting to
 * Blitz — a player who only ever plays Bullet/Rapid would otherwise land on an empty Blitz tab
 * and could easily read that as "my history isn't being recorded" when it actually is, just
 * under a different tab. Falls back to 'blitz' when every category is equally empty. */
function pickDefaultCategory(): RatingCategory {
  let best: RatingCategory = 'blitz';
  let bestCount = -1;
  for (const category of RATING_CATEGORIES) {
    const count = getRatingHistory(category).length;
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }
  return best;
}

export default function RatingHistoryScreen({ onBack }: RatingHistoryScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const { width } = useWindowDimensions();
  const chartWidth = Math.min(width - 32, 500);

  const [category, setCategory] = useState<RatingCategory>(pickDefaultCategory);
  const history = useRatingHistory(category);

  const chart = useMemo(() => {
    if (history.length < 2) return null;

    const ratings = history.map((entry) => entry.rating);
    const minRating = Math.min(...ratings);
    const maxRating = Math.max(...ratings);
    const ratingSpan = Math.max(maxRating - minRating, 1);

    const firstTs = history[0].timestamp;
    const lastTs = history[history.length - 1].timestamp;
    const timeSpan = Math.max(lastTs - firstTs, 1);

    const innerWidth = chartWidth - CHART_PADDING * 2;
    const innerHeight = CHART_HEIGHT - CHART_PADDING * 2;

    const points = history.map((entry) => ({
      x: CHART_PADDING + ((entry.timestamp - firstTs) / timeSpan) * innerWidth,
      y: CHART_PADDING + innerHeight - ((entry.rating - minRating) / ratingSpan) * innerHeight,
    }));

    const midIndex = Math.floor((history.length - 1) / 2);

    return { points, minRating, maxRating, dateLabels: [history[0], history[midIndex], history[history.length - 1]] };
  }, [history, chartWidth]);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Rating History" onBack={onBack} backLabel="‹ Menu" />

      <View style={styles.tabRow}>
        {RATING_CATEGORIES.map((cat) => (
          <Pressable key={cat} style={[styles.tab, category === cat && styles.tabActive]} onPress={() => setCategory(cat)}>
            <Text style={[styles.tabText, category === cat && styles.tabTextActive]}>{CATEGORY_LABELS[cat]}</Text>
          </Pressable>
        ))}
      </View>

      {!chart ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>Play more games to see your rating history.</Text>
        </View>
      ) : (
        <View style={styles.chartBox}>
          <View style={styles.chartRow}>
            <View style={styles.yAxisLabels}>
              <Text style={styles.axisLabel}>{chart.maxRating}</Text>
              <Text style={styles.axisLabel}>{chart.minRating}</Text>
            </View>
            <Svg width={chartWidth} height={CHART_HEIGHT}>
              <Line
                x1={CHART_PADDING}
                y1={CHART_HEIGHT - CHART_PADDING}
                x2={chartWidth - CHART_PADDING}
                y2={CHART_HEIGHT - CHART_PADDING}
                stroke={colors.textMuted}
                strokeWidth={1}
              />
              <Line
                x1={CHART_PADDING}
                y1={CHART_PADDING}
                x2={chartWidth - CHART_PADDING}
                y2={CHART_PADDING}
                stroke={colors.textMuted}
                strokeWidth={1}
                strokeDasharray="4,4"
              />
              <Polyline
                points={chart.points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={colors.accent}
                strokeWidth={2}
              />
              {chart.points.map((p, i) => (
                <Circle key={i} cx={p.x} cy={p.y} r={3} fill={colors.accent} />
              ))}
            </Svg>
          </View>
          <View style={styles.xAxisLabels}>
            {chart.dateLabels.map((entry, i) => (
              <Text key={i} style={styles.axisLabel}>
                {formatDate(entry.timestamp)}
              </Text>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    tabRow: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 16,
      marginTop: 4,
      marginBottom: 16,
    },
    tab: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      alignItems: 'center',
      backgroundColor: colors.surface,
    },
    tabActive: {
      backgroundColor: colors.accent,
    },
    tabText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
    tabTextActive: {
      color: '#fff',
    },
    emptyBox: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
    },
    emptyText: {
      fontSize: 15,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    chartBox: {
      paddingHorizontal: 16,
      alignItems: 'center',
    },
    chartRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: 6,
    },
    yAxisLabels: {
      height: CHART_HEIGHT,
      minWidth: 34,
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      paddingVertical: CHART_PADDING - 6,
    },
    xAxisLabels: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
      marginTop: 4,
    },
    axisLabel: {
      fontSize: 11,
      color: colors.textMuted,
    },
  });
}
