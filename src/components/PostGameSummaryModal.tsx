import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { StockfishEngineAdapter } from '../engine/StockfishEngineAdapter';
import StockfishBridge, { type StockfishBridgeHandle } from '../engine/StockfishBridge';
import { buildStockfishHtml } from '../engine/stockfishHtml';
import MoveQualityBadge from './MoveQualityBadge';
import { MOVE_QUALITY_LABELS, type MoveQuality } from '../logic/analysis';
import { computeGameSummary, type GameAnalysisSummary, type PlayerGameStats } from '../logic/gameSummary';
import type { PieceColor } from '../types/chess';
import type { GameHistoryEntry } from '../types/history';

export interface SummaryPlayer {
  label: string;
  color: PieceColor;
}

interface PostGameSummaryModalProps {
  visible: boolean;
  title: string;
  subtitle: string;
  initialFen: string;
  chess960: boolean;
  history: GameHistoryEntry[];
  /** One entry (Bot/Online: just the user) or two (Local: White and Black). */
  players: SummaryPlayer[];
  onGameReview: () => void;
  /** Omit entirely to hide the button — Online games never offer a same-settings rematch. */
  onRematch?: () => void;
  onNewGame: () => void;
}

function shortQualityLabel(quality: MoveQuality): string {
  return MOVE_QUALITY_LABELS[quality].replace(/ move$/i, '');
}

function topQualities(counts: PlayerGameStats['qualityCounts'], max = 3): [MoveQuality, number][] {
  return (Object.entries(counts) as [MoveQuality, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max);
}

export default function PostGameSummaryModal({
  visible,
  title,
  subtitle,
  initialFen,
  chess960,
  history,
  players,
  onGameReview,
  onRematch,
  onNewGame,
}: PostGameSummaryModalProps) {
  const [summary, setSummary] = useState<GameAnalysisSummary | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  // A dedicated scratch engine + bridge, mounted only while this modal is visible — deliberately
  // NOT the screen's own engineRuntime/bridge (BotGameScreen's opponent, or LocalGameScreen's
  // hint engine): sharing that instance would mean two StockfishBridge mounts both calling
  // attachBridge() on the same engine, and the second one silently steals the connection from the
  // first (same reasoning EngineVsEngineGameScreen documents for reusing one runtime across two
  // engines that happen to share an id — except here we specifically want isolation, not sharing).
  const scratchEngine = useMemo(() => (visible ? new StockfishEngineAdapter() : null), [visible]);
  const bridgeRef = useRef<StockfishBridgeHandle>(null);
  const handleBridgeRef = useCallback(
    (handle: StockfishBridgeHandle | null) => {
      bridgeRef.current = handle;
      scratchEngine?.attachBridge(handle);
    },
    [scratchEngine]
  );
  const handleEngineLine = useCallback((line: string) => scratchEngine?.handleLine(line), [scratchEngine]);

  useEffect(() => {
    if (!scratchEngine || history.length === 0) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    setSummary(null);
    setProgress({ done: 0, total: history.length + 1 });

    (async () => {
      try {
        await scratchEngine.initEngine();
        const result = await computeGameSummary(initialFen, chess960, history, scratchEngine, (done, total) => {
          if (!cancelled) setProgress({ done, total });
        });
        if (!cancelled) setSummary(result);
      } catch {
        // Non-critical: the popup still shows the result/title without accuracy if this fails.
      }
    })();

    return () => {
      cancelled = true;
    };
    // history/initialFen/chess960 are fixed for the lifetime of a finished game; scratchEngine
    // identity is what actually re-triggers this (a fresh one each time the modal opens).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scratchEngine]);

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      {scratchEngine && <StockfishBridge ref={handleBridgeRef} onLine={handleEngineLine} html={buildStockfishHtml()} />}
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        {history.length > 0 &&
          (!summary ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#3a2618" />
              <Text style={styles.loadingText}>
                Analyzing game{progress.total > 0 ? ` (${progress.done}/${progress.total})` : '...'}
              </Text>
            </View>
          ) : (
            <View style={[styles.playersRow, players.length > 1 && styles.playersRowMulti]}>
              {players.map((player) => {
                const stats = player.color === 'w' ? summary.white : summary.black;
                return (
                  <View key={player.color} style={styles.playerBlock}>
                    <Text style={styles.playerLabel}>{player.label}</Text>
                    <Text style={styles.accuracyValue}>{stats.accuracy.toFixed(1)}%</Text>
                    <Text style={styles.accuracyCaption}>Accuracy</Text>
                    <View style={styles.qualityList}>
                      {topQualities(stats.qualityCounts).map(([quality, count]) => (
                        <View key={quality} style={styles.qualityItem}>
                          <MoveQualityBadge quality={quality} size={28} />
                          <Text style={styles.qualityCount}>{count}</Text>
                          <Text style={styles.qualityRow}>{shortQualityLabel(quality)}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          ))}

        <View style={styles.buttonColumn}>
          <Pressable style={styles.primaryButton} onPress={onGameReview}>
            <Text style={styles.primaryButtonText}>Game Review</Text>
          </Pressable>
          {onRematch && (
            <Pressable style={styles.secondaryButton} onPress={onRematch}>
              <Text style={styles.secondaryButtonText}>Rematch</Text>
            </Pressable>
          )}
          <Pressable style={styles.secondaryButton} onPress={onNewGame}>
            <Text style={styles.secondaryButtonText}>New Game</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
    elevation: 999,
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 22,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#3a2618',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#777',
    textAlign: 'center',
    marginTop: -6,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 20,
  },
  loadingText: {
    fontSize: 13,
    color: '#555',
  },
  playersRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  playersRowMulti: {
    gap: 16,
  },
  playerBlock: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#f7f2ea',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 10,
    gap: 2,
  },
  playerLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8a7a63',
    textTransform: 'uppercase',
  },
  accuracyValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#2e6f4f',
    marginTop: 4,
  },
  accuracyCaption: {
    fontSize: 11,
    color: '#999',
    marginBottom: 6,
  },
  qualityList: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 4,
  },
  qualityItem: {
    alignItems: 'center',
    gap: 2,
  },
  qualityCount: {
    fontSize: 14,
    color: '#3a2618',
    fontWeight: '700',
    marginTop: 2,
  },
  qualityRow: {
    fontSize: 11,
    color: '#3a2618',
    fontWeight: '600',
  },
  buttonColumn: {
    gap: 10,
    marginTop: 8,
  },
  primaryButton: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#2e6f4f',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#3a2618',
  },
  secondaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
