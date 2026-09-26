import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import ChessBoard from '../components/ChessBoard';
import { getBoardSize } from '../components/boardSize';
import EvalBar from '../components/EvalBar';
import MoveQualityBadge from '../components/MoveQualityBadge';
import ScreenHeader from '../components/ScreenHeader';
import type { AnalysisResult } from '../engine/ChessEngine';
import { getEngineRuntime } from '../engine/engineRegistry';
import StockfishBridge, { type StockfishBridgeHandle } from '../engine/StockfishBridge';
import {
  classifyMove,
  formatEvaluation,
  isBookMove,
  MOVE_QUALITY_COLORS,
  MOVE_QUALITY_LABELS,
  toWhitePerspective,
  type MoveQuality,
} from '../logic/analysis';
import { ChessEngine } from '../logic/ChessEngine';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { AVAILABLE_ENGINES, DEFAULT_ENGINE_ID } from '../logic/engines';
import { generateExplanation } from '../logic/moveExplanations';
import { parseUciMove, uciMoveToSan, uciSequenceToSan } from '../logic/uciMove';
import type { PieceColor } from '../types/chess';
import type { GameHistoryEntry } from '../types/history';

interface AnalysisScreenProps {
  initialFen: string;
  chess960: boolean;
  history: GameHistoryEntry[];
  onExit: () => void;
}

interface PlyAnalysis {
  san: string;
  quality: MoveQuality;
  wasBestMove: boolean;
  bestMoveSan: string | null;
  /** Rule-based explanation of why this move got that quality — see moveExplanations.ts. */
  explanation: string;
}

// A fixed time budget per position rather than a fixed depth: some positions (especially the
// symmetric starting position) can take a lite/single-threaded engine far longer than others to
// reach a given depth, so movetime keeps analysis time predictable across an entire game.
const ANALYSIS_MOVETIME_MS = 1000;
const MULTI_PV = 3;
const PV_DISPLAY_PLIES = 6;

export default function AnalysisScreen({ initialFen, chess960, history, onExit }: AnalysisScreenProps) {
  const { width } = useWindowDimensions();
  const boardSize = getBoardSize(width);
  const colors = useAppColors();
  const styles = createStyles(colors);

  // Always defaults to the strongest engine, regardless of which engine played the bot's moves
  // in this game — analysis wants the most accurate read of the position, not a rematch of
  // whatever the bot happened to be. The small toggle below lets the player switch to the
  // classical engine deliberately, for comparison, but never starts there.
  const [analysisEngineId, setAnalysisEngineId] = useState(DEFAULT_ENGINE_ID);
  const engineRuntime = useMemo(() => getEngineRuntime(analysisEngineId), [analysisEngineId]);

  const positions = useMemo(() => [initialFen, ...history.map((h) => h.fenAfter)], [initialFen, history]);
  const sanHistory = useMemo(() => history.map((h) => h.move.san), [history]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [previewLineIndex, setPreviewLineIndex] = useState<number | null>(null);
  const [evaluations, setEvaluations] = useState<(AnalysisResult | null)[]>(() =>
    new Array(positions.length).fill(null)
  );
  const [analyzedCount, setAnalyzedCount] = useState(0);
  const [analyzing, setAnalyzing] = useState(true);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const bridgeRef = useRef<StockfishBridgeHandle>(null);
  // Memoized so React doesn't treat this as a "new" ref callback on every re-render — a
  // changing ref identity forces a detach+reattach cycle each render, which was resetting the
  // engine's internal ready-state mid-flight (this screen re-renders constantly while analysis
  // progresses: evaluations/analyzedCount update after every position).
  const handleBridgeRef = useCallback(
    (handle: StockfishBridgeHandle | null) => {
      bridgeRef.current = handle;
      engineRuntime.engine.attachBridge(handle);
    },
    [engineRuntime]
  );
  const handleEngineLine = useCallback((line: string) => engineRuntime.engine.handleLine(line), [engineRuntime]);

  // Auto-run the analysis for the whole game, position by position, as soon as the engine is ready.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setAnalyzing(true);
      setAnalysisError(null);
      try {
        await engineRuntime.engine.initEngine();
        const results: (AnalysisResult | null)[] = new Array(positions.length).fill(null);
        for (let i = 0; i < positions.length; i++) {
          if (cancelled) return;

          // A checkmate/stalemate position has no legal moves, so the engine has nothing to
          // search — "go" returns "bestmove (none)" with no score/pv at all. Synthesize the
          // (unambiguous) result ourselves instead of asking the engine.
          const positionEngine = new ChessEngine(positions[i], { chess960, initialFen });
          const result: AnalysisResult = positionEngine.isGameOver()
            ? {
                lines: [
                  {
                    evaluation: positionEngine.getStatus() === 'checkmate' ? { type: 'mate', value: 0 } : { type: 'cp', value: 0 },
                    moves: [],
                  },
                ],
              }
            : await engineRuntime.engine.analyzePosition(positions[i], {
                movetimeMs: ANALYSIS_MOVETIME_MS,
                multiPv: MULTI_PV,
              });
          if (cancelled) return;
          results[i] = result;
          setEvaluations([...results]);
          setAnalyzedCount(i + 1);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          console.log('[Analysis] engine error:', message);
          setAnalysisError(message);
        }
      } finally {
        if (!cancelled) setAnalyzing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Re-runs whenever the game itself changes (shouldn't happen mid-screen) or the player
    // switches the analysis engine via the toggle below — both cases should restart analysis
    // from scratch with whichever engine is now current.
  }, [positions, engineRuntime, chess960, initialFen]);

  useEffect(() => {
    setPreviewLineIndex(null);
  }, [currentIndex]);

  const plyAnalyses = useMemo<(PlyAnalysis | null)[]>(() => {
    return history.map((entry, i) => {
      const before = evaluations[i];
      const after = evaluations[i + 1];
      if (!before || !after) return null;

      const moverColor: PieceColor = i % 2 === 0 ? 'w' : 'b';
      const isBook = isBookMove(sanHistory, i, chess960);
      const classification = classifyMove({
        linesBefore: before.lines,
        linesAfter: after.lines,
        move: entry.move,
        moverColor,
        fenBefore: entry.fenBefore,
        chess960,
        initialFen,
        isBook,
      });

      const showAlternative = !classification.wasBestMove && classification.quality !== 'book';
      const bestMoveSan = showAlternative
        ? uciMoveToSan(before.lines[0].moves[0], entry.fenBefore, { chess960, initialFen })
        : null;

      const explanation = generateExplanation({
        fenBefore: entry.fenBefore,
        fenAfter: entry.fenAfter,
        move: entry.move,
        moverColor,
        quality: classification.quality,
        evalBeforeForMover: before.lines[0].evaluation,
        evalAfterForMover: { type: after.lines[0].evaluation.type, value: -after.lines[0].evaluation.value },
        centipawnLoss: classification.centipawnLoss,
        bestMoveSan,
        bestOpponentReplyUci: after.lines[0]?.moves[0] ?? null,
        chess960,
        initialFen,
      });

      return {
        san: entry.move.san,
        quality: classification.quality,
        wasBestMove: classification.wasBestMove,
        bestMoveSan,
        explanation,
      };
    });
  }, [history, evaluations, chess960, initialFen, sanHistory]);

  const currentResult = evaluations[currentIndex];
  const currentTurn = useMemo<PieceColor>(
    () => new ChessEngine(positions[currentIndex]).getTurn(),
    [positions, currentIndex]
  );
  const whiteEval = currentResult ? toWhitePerspective(currentResult.lines[0].evaluation, currentTurn) : null;
  const currentPlyAnalysis = currentIndex > 0 ? plyAnalyses[currentIndex - 1] : null;

  const previewFen = useMemo(() => {
    if (previewLineIndex === null || !currentResult) return null;
    const line = currentResult.lines[previewLineIndex];
    if (!line) return null;
    const engine = new ChessEngine(positions[currentIndex], { chess960, initialFen });
    for (const uci of line.moves) {
      const parsed = parseUciMove(uci);
      if (!parsed || !engine.move(parsed.from, parsed.to, parsed.promotion)) break;
    }
    return engine.getFen();
  }, [previewLineIndex, currentResult, positions, currentIndex, chess960, initialFen]);

  const goTo = (index: number) => setCurrentIndex(Math.max(0, Math.min(positions.length - 1, index)));
  const atStart = currentIndex === 0;
  const atEnd = currentIndex === positions.length - 1;

  return (
    <View style={styles.container}>
      <StockfishBridge ref={handleBridgeRef} onLine={handleEngineLine} html={engineRuntime.buildHtml()} />
      <ScreenHeader title="Game Analysis" onBack={onExit} backLabel="‹ Menu" />
      <View style={styles.body}>
      <View style={styles.engineToggleRow}>
        <Text style={styles.engineToggleLabel}>Analysis engine:</Text>
        {AVAILABLE_ENGINES.map((option) => (
          <Pressable
            key={option.id}
            disabled={analyzing}
            style={[styles.engineToggleChip, analysisEngineId === option.id && styles.engineToggleChipActive]}
            onPress={() => setAnalysisEngineId(option.id)}
          >
            <Text
              style={[styles.engineToggleChipText, analysisEngineId === option.id && styles.engineToggleChipTextActive]}
            >
              {option.name}
            </Text>
          </Pressable>
        ))}
      </View>

      {analyzing && (
        <View style={styles.analyzingRow}>
          <ActivityIndicator size="small" color={colors.text} />
          <Text style={styles.analyzingText}>
            Analyzing position {analyzedCount}/{positions.length}...
          </Text>
        </View>
      )}
      {analysisError && <Text style={styles.errorText}>Engine error: {analysisError}</Text>}

      <View style={styles.moveInfo}>
        {currentPlyAnalysis ? (
          <>
            <View style={styles.moveQualityBadgeRow}>
              <MoveQualityBadge quality={currentPlyAnalysis.quality} size={24} />
              <Text style={styles.moveQualityBadgeText}>
                {currentPlyAnalysis.san} · {MOVE_QUALITY_LABELS[currentPlyAnalysis.quality]}
              </Text>
            </View>
            {currentPlyAnalysis.bestMoveSan && (
              <Text style={styles.bestMoveText}>Best move: {currentPlyAnalysis.bestMoveSan}</Text>
            )}
          </>
        ) : (
          <Text style={styles.bestMoveText}>{currentIndex === 0 ? 'Starting position' : ' '}</Text>
        )}
      </View>

      <View style={styles.boardRow}>
        <EvalBar evaluation={whiteEval} height={boardSize} />
        <View>
          {previewFen && (
            <Pressable style={styles.previewBanner} onPress={() => setPreviewLineIndex(null)}>
              <Text style={styles.previewBannerText}>Previewing line — tap to return</Text>
            </Pressable>
          )}
          <ChessBoard
            fen={previewFen ?? positions[currentIndex]}
            onMove={() => {}}
            disabled
            chess960={chess960}
            initialFen={initialFen}
            lastMove={!previewFen && currentIndex > 0 ? history[currentIndex - 1].move : null}
            enableAnnotations
          />
        </View>
      </View>

      <View style={styles.navRow}>
        <Pressable style={[styles.navButton, atStart && styles.navButtonDisabled]} disabled={atStart} onPress={() => goTo(0)}>
          <Text style={styles.navButtonText}>|◂</Text>
        </Pressable>
        <Pressable
          style={[styles.navButton, atStart && styles.navButtonDisabled]}
          disabled={atStart}
          onPress={() => goTo(currentIndex - 1)}
        >
          <Text style={styles.navButtonText}>‹</Text>
        </Pressable>
        <Pressable
          style={[styles.navButton, atEnd && styles.navButtonDisabled]}
          disabled={atEnd}
          onPress={() => goTo(currentIndex + 1)}
        >
          <Text style={styles.navButtonText}>›</Text>
        </Pressable>
        <Pressable
          style={[styles.navButton, atEnd && styles.navButtonDisabled]}
          disabled={atEnd}
          onPress={() => goTo(positions.length - 1)}
        >
          <Text style={styles.navButtonText}>▸|</Text>
        </Pressable>
      </View>

      <View style={styles.linesBox}>
        {currentResult ? (
          currentResult.lines.map((line, i) => {
            const lineWhiteEval = toWhitePerspective(line.evaluation, currentTurn);
            const sequence = uciSequenceToSan(positions[currentIndex], line.moves, { chess960, initialFen }, PV_DISPLAY_PLIES);
            const isPreviewed = previewLineIndex === i;
            return (
              <Pressable
                key={i}
                style={[styles.lineRow, isPreviewed && styles.lineRowActive]}
                onPress={() => setPreviewLineIndex(isPreviewed ? null : i)}
              >
                <Text style={styles.lineEval}>{formatEvaluation(lineWhiteEval)}</Text>
                <Text style={styles.lineSequence} numberOfLines={1}>
                  {sequence}
                </Text>
              </Pressable>
            );
          })
        ) : (
          <Text style={styles.linesPlaceholder}>Waiting for analysis...</Text>
        )}
      </View>

      {currentPlyAnalysis && (
        <View style={[styles.explanationBox, { borderLeftColor: MOVE_QUALITY_COLORS[currentPlyAnalysis.quality] }]}>
          <Text style={styles.explanationText}>{currentPlyAnalysis.explanation}</Text>
        </View>
      )}

      <ScrollView style={styles.moveList} contentContainerStyle={styles.moveListContent}>
        {history.map((entry, i) => {
          const analysis = plyAnalyses[i];
          const moveNumber = Math.floor(i / 2) + 1;
          const label = i % 2 === 0 ? `${moveNumber}.` : `${moveNumber}...`;
          const isCurrent = currentIndex === i + 1;
          return (
            <Pressable key={i} style={[styles.moveRow, isCurrent && styles.moveRowActive]} onPress={() => goTo(i + 1)}>
              <Text style={styles.moveRowLabel}>
                {label} {entry.move.san}
              </Text>
              {analysis ? (
                <View style={styles.moveRowBadgeWrap}>
                  <MoveQualityBadge quality={analysis.quality} size={18} />
                  <Text style={[styles.moveRowBadge, { color: MOVE_QUALITY_COLORS[analysis.quality] }]}>
                    {MOVE_QUALITY_LABELS[analysis.quality]}
                  </Text>
                </View>
              ) : (
                <ActivityIndicator size="small" color={colors.textMuted} />
              )}
            </Pressable>
          );
        })}
      </ScrollView>
      </View>
    </View>
  );
}

function createStyles(colors: AppColors) {
  const isDark = colors.mode === 'dark';
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    body: {
      flex: 1,
      paddingHorizontal: 16,
      gap: 6,
    },
    engineToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    engineToggleLabel: {
      fontSize: 11,
      color: colors.textMuted,
    },
    engineToggleChip: {
      paddingVertical: 2,
      paddingHorizontal: 8,
      borderRadius: 10,
      backgroundColor: isDark ? '#2a2a2a' : '#f4f4f4',
    },
    engineToggleChipActive: {
      backgroundColor: isDark ? '#4a3f2a' : '#e0d3bd',
    },
    engineToggleChipText: {
      fontSize: 11,
      color: colors.textMuted,
    },
    engineToggleChipTextActive: {
      color: colors.text,
      fontWeight: '600',
    },
    analyzingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    analyzingText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    errorText: {
      fontSize: 13,
      color: colors.danger,
    },
    moveInfo: {
      alignItems: 'center',
      gap: 4,
      minHeight: 44,
    },
    moveQualityBadgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    moveQualityBadgeText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },
    bestMoveText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    boardRow: {
      flexDirection: 'row',
      alignSelf: 'center',
      gap: 8,
      alignItems: 'flex-start',
    },
    previewBanner: {
      backgroundColor: colors.accent,
      borderRadius: 6,
      paddingVertical: 4,
      marginBottom: 4,
      alignItems: 'center',
    },
    previewBannerText: {
      color: '#fff',
      fontSize: 11,
      fontWeight: '600',
    },
    navRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 10,
      marginTop: 8,
    },
    navButton: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      backgroundColor: colors.buttonBackground,
      borderRadius: 8,
    },
    navButtonDisabled: {
      opacity: 0.35,
    },
    navButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },
    linesBox: {
      marginTop: 10,
      gap: 4,
    },
    explanationBox: {
      marginTop: 10,
      backgroundColor: colors.surface,
      borderLeftWidth: 4,
      borderRadius: 6,
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    explanationText: {
      fontSize: 13,
      color: colors.text,
      lineHeight: 18,
    },
    linesPlaceholder: {
      fontSize: 13,
      color: colors.textMuted,
      alignSelf: 'center',
    },
    lineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6,
      paddingHorizontal: 8,
      borderRadius: 6,
      backgroundColor: colors.surface,
    },
    lineRowActive: {
      backgroundColor: isDark ? '#4a3f2a' : '#f0d9b5',
    },
    lineEval: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
      minWidth: 46,
    },
    lineSequence: {
      fontSize: 12,
      color: colors.textSecondary,
      flex: 1,
    },
    moveList: {
      flex: 1,
      marginTop: 12,
    },
    moveListContent: {
      paddingBottom: 24,
    },
    moveRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 6,
    },
    moveRowActive: {
      backgroundColor: isDark ? '#4a3f2a' : '#f0d9b5',
    },
    moveRowLabel: {
      fontSize: 14,
      color: colors.text,
    },
    moveRowBadgeWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    moveRowBadge: {
      fontSize: 12,
      fontWeight: '700',
    },
  });
}
