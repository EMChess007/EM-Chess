import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import ScreenHeader from '../components/ScreenHeader';
import { getBoardSize } from '../components/boardSize';
import Square from '../components/Square';
import { emptyBoard } from '../logic/boardEditor';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import {
  SETUP_CHESS_BUDGET,
  SETUP_CHESS_PALETTE_ORDER,
  backRankFor,
  computeArmyCost,
  isSquareAllowed,
  pawnRankFor,
  pieceCost,
  validateSetupArmy,
  type SetupChessPiece,
} from '../logic/setupChess';
import { useActiveBoardTheme, useActivePieceTheme } from '../logic/themeHooks';
import type { BoardSquare, PieceColor, PieceType } from '../types/chess';

interface SetupChessBuilderScreenProps {
  /** Which color's army this screen is building — also determines board orientation (this
   * player's own two ranks always render at the bottom, same convention ChessBoard uses). */
  color: PieceColor;
  title: string;
  subtitle?: string;
  /** Label on the finalize button — screens using this for different flows (hotseat/bot/online)
   * phrase it slightly differently ("Ready" for online blind setup vs "Finalize Army"). */
  finalizeLabel?: string;
  onFinalize: (pieces: SetupChessPiece[]) => void;
  onBack?: () => void;
  backLabel?: string;
}

type PaletteSelection = PieceType | 'eraser' | null;

export default function SetupChessBuilderScreen({
  color,
  title,
  subtitle,
  finalizeLabel = 'Finalize Army',
  onFinalize,
  onBack,
  backLabel,
}: SetupChessBuilderScreenProps) {
  const { width } = useWindowDimensions();
  const boardSize = getBoardSize(width);
  const squareSize = boardSize / 8;
  const colors = useAppColors();
  const boardTheme = useActiveBoardTheme();
  const pieceTheme = useActivePieceTheme();
  const styles = createStyles(colors);

  const [board, setBoard] = useState<BoardSquare[][]>(() => emptyBoard());
  const [paletteSelection, setPaletteSelection] = useState<PaletteSelection>(null);
  const [error, setError] = useState<string | null>(null);

  const pieces = useMemo<SetupChessPiece[]>(
    () => board.flat().filter((sq): sq is BoardSquare & { piece: NonNullable<BoardSquare['piece']> } => sq.piece !== null).map((sq) => ({ square: sq.square, type: sq.piece.type })),
    [board]
  );
  const cost = computeArmyCost(pieces);
  const remaining = SETUP_CHESS_BUDGET - cost;
  const hasKing = pieces.some((p) => p.type === 'k');

  const handleSquarePress = (square: string) => {
    if (!paletteSelection) return;
    const rowIdx = 8 - parseInt(square[1], 10);
    const colIdx = square.charCodeAt(0) - 97;
    const existing = board[rowIdx][colIdx].piece;

    if (paletteSelection === 'eraser') {
      if (!existing) return;
      setError(null);
      setBoard((prev) => {
        const next = prev.map((row) => row.slice());
        next[rowIdx][colIdx] = { square, piece: null };
        return next;
      });
      return;
    }

    const type = paletteSelection;
    if (!isSquareAllowed(square, type, color)) {
      setError(type === 'p' ? `Pawns must go on rank ${pawnRankFor(color)}.` : `That piece must go on rank ${backRankFor(color)}.`);
      return;
    }
    const existingCost = existing ? pieceCost(existing.type) : 0;
    const nextCost = cost - existingCost + pieceCost(type);
    if (nextCost > SETUP_CHESS_BUDGET) {
      setError(`Not enough budget left (this would cost ${nextCost}/${SETUP_CHESS_BUDGET}).`);
      return;
    }
    setError(null);
    setBoard((prev) => {
      const next = prev.map((row) => row.slice());
      next[rowIdx][colIdx] = { square, piece: { type, color } };
      return next;
    });
  };

  const handleClear = () => {
    setBoard(emptyBoard());
    setError(null);
  };

  const handleFinalize = () => {
    const validation = validateSetupArmy(pieces);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setError(null);
    onFinalize(pieces);
  };

  const renderPaletteButton = (type: PieceType) => {
    const selected = paletteSelection === type;
    const budgetCost = pieceCost(type);
    return (
      <Pressable key={type} style={[styles.paletteButton, selected && styles.paletteButtonActive]} onPress={() => setPaletteSelection(type)}>
        <Square
          data={{ square: '', piece: { type, color } }}
          isLight={false}
          isSelected={false}
          isLegalTarget={false}
          isChecked={false}
          isLastMove={false}
          size={38}
          lightColor={boardTheme.lightColor}
          darkColor={boardTheme.lightColor}
          pieceImages={pieceTheme.images}
        />
        <Text style={styles.paletteCostText}>{type === 'k' ? 'Free' : budgetCost}</Text>
      </Pressable>
    );
  };

  // The player's own two ranks always render at the bottom — same "reverse both axes" convention
  // ChessBoard uses for a Black-orientation board, which preserves each square's light/dark
  // parity so the same (rowIndex + colIndex) % 2 coloring below still works unchanged.
  const displayRows = color === 'b' ? [...board].reverse().map((row) => [...row].reverse()) : board;
  const ownRanks = new Set([backRankFor(color), pawnRankFor(color)]);

  return (
    <View style={styles.container}>
      <ScreenHeader title={title} subtitle={subtitle} onBack={onBack} backLabel={backLabel} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.budgetText}>
          Points: {cost}/{SETUP_CHESS_BUDGET}
        </Text>

        <View style={styles.boardWrap}>
          <View style={styles.boardBorder}>
            <View style={[styles.board, { width: boardSize, height: boardSize }]}>
              {displayRows.map((row, rowIndex) =>
                row.map((squareData, colIndex) => {
                  const rank = parseInt(squareData.square[1], 10);
                  const interactive = ownRanks.has(rank);
                  const squareEl = (
                    <Square
                      data={squareData}
                      isLight={(rowIndex + colIndex) % 2 === 0}
                      isSelected={false}
                      isLegalTarget={false}
                      isChecked={false}
                      isLastMove={false}
                      size={squareSize}
                      lightColor={boardTheme.lightColor}
                      darkColor={boardTheme.darkColor}
                      pieceImages={pieceTheme.images}
                    />
                  );
                  return interactive ? (
                    <Pressable key={squareData.square} onPress={() => handleSquarePress(squareData.square)}>
                      {squareEl}
                    </Pressable>
                  ) : (
                    <View key={squareData.square} style={styles.inertSquare}>
                      {squareEl}
                    </View>
                  );
                })
              )}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Palette</Text>
          <View style={styles.paletteRow}>{SETUP_CHESS_PALETTE_ORDER.map(renderPaletteButton)}</View>
          <Pressable
            style={[styles.eraserButton, paletteSelection === 'eraser' && styles.paletteButtonActive]}
            onPress={() => setPaletteSelection('eraser')}
          >
            <Text style={styles.eraserButtonText}>Eraser</Text>
          </Pressable>
        </View>

        <Pressable style={styles.clearButton} onPress={handleClear}>
          <Text style={styles.clearButtonText}>Clear My Army</Text>
        </Pressable>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <Pressable
          style={[styles.finalizeButton, (!hasKing || cost > SETUP_CHESS_BUDGET) && styles.finalizeButtonDisabled]}
          onPress={handleFinalize}
        >
          <Text style={styles.finalizeButtonText}>{finalizeLabel}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingBottom: 40,
      gap: 14,
    },
    budgetText: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },
    boardWrap: {
      alignItems: 'center',
    },
    boardBorder: {
      borderWidth: 2,
      borderColor: '#3a2618',
    },
    board: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    inertSquare: {
      opacity: 0.55,
    },
    section: {
      gap: 8,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
    },
    paletteRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    paletteButton: {
      width: 54,
      paddingVertical: 4,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    paletteButtonActive: {
      borderColor: colors.accent,
    },
    paletteCostText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    eraserButton: {
      alignSelf: 'flex-start',
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 8,
      backgroundColor: colors.surface,
      borderWidth: 2,
      borderColor: 'transparent',
    },
    eraserButtonText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
    clearButton: {
      alignSelf: 'flex-start',
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 8,
      backgroundColor: colors.danger,
    },
    clearButtonText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '600',
    },
    errorText: {
      fontSize: 13,
      color: colors.danger,
    },
    finalizeButton: {
      paddingVertical: 14,
      borderRadius: 10,
      alignItems: 'center',
      backgroundColor: colors.accent,
    },
    finalizeButtonDisabled: {
      opacity: 0.5,
    },
    finalizeButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },
  });
}
