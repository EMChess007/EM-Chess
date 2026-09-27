import { useEffect, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { appAlert } from '../components/AppAlert';
import ScreenHeader from '../components/ScreenHeader';
import { getBoardSize } from '../components/boardSize';
import Square from '../components/Square';
import {
  buildFen,
  emptyBoard,
  boardFromFen,
  getTurnFromFen,
  parseCastlingFromFen,
  validateEditorFen,
  STARTING_EDITOR_FEN,
  type CastlingRights,
} from '../logic/boardEditor';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import { useActiveBoardTheme, useActivePieceTheme } from '../logic/themeHooks';
import type { BoardSquare, PieceColor, PieceType } from '../types/chess';
import type { AnalyzeParams } from '../types/history';

interface BoardSetupScreenProps {
  onBack: () => void;
  onAnalyze: (params: AnalyzeParams) => void;
}

type PaletteSelection = { type: PieceType; color: PieceColor } | 'eraser' | null;

// King first, then descending value — the order most chess sites use for a piece palette.
const PALETTE_PIECE_ORDER: PieceType[] = ['k', 'q', 'r', 'b', 'n', 'p'];

export default function BoardSetupScreen({ onBack, onAnalyze }: BoardSetupScreenProps) {
  const { width } = useWindowDimensions();
  const boardSize = getBoardSize(width);
  const squareSize = boardSize / 8;
  const colors = useAppColors();
  const boardTheme = useActiveBoardTheme();
  const pieceTheme = useActivePieceTheme();
  const styles = createStyles(colors);

  const [board, setBoard] = useState<BoardSquare[][]>(() => boardFromFen(STARTING_EDITOR_FEN));
  const [turn, setTurn] = useState<PieceColor>('w');
  const [castling, setCastling] = useState<CastlingRights>({ K: true, Q: true, k: true, q: true });
  const [paletteSelection, setPaletteSelection] = useState<PaletteSelection>(null);
  const [fenInput, setFenInput] = useState(() => buildFen(board, turn, castling));
  const [error, setError] = useState<string | null>(null);

  // Keeps the FEN text field showing the board's current state after any placement/toolbar
  // action. Only fires when board/turn/castling actually change (a placement, Starting Position,
  // Clear Board, or a successful Load) — so it never clobbers text the user is still typing in
  // the box before they've pressed Load.
  useEffect(() => {
    setFenInput(buildFen(board, turn, castling));
  }, [board, turn, castling]);

  const handleSquarePress = (square: string) => {
    if (!paletteSelection) return;
    setError(null);
    const rowIdx = 8 - parseInt(square[1], 10);
    const colIdx = square.charCodeAt(0) - 97;
    setBoard((prev) => {
      const next = prev.map((row) => row.slice());
      next[rowIdx][colIdx] =
        paletteSelection === 'eraser'
          ? { square, piece: null }
          : { square, piece: { type: paletteSelection.type, color: paletteSelection.color } };
      return next;
    });
  };

  const handleStartingPosition = () => {
    setBoard(boardFromFen(STARTING_EDITOR_FEN));
    setTurn('w');
    setCastling({ K: true, Q: true, k: true, q: true });
    setError(null);
  };

  const handleClearBoard = () => {
    setBoard(emptyBoard());
    setCastling({ K: false, Q: false, k: false, q: false });
    setError(null);
  };

  const handleLoadFen = () => {
    const candidate = fenInput.trim();
    const validation = validateEditorFen(candidate);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setBoard(boardFromFen(candidate));
    setTurn(getTurnFromFen(candidate));
    setCastling(parseCastlingFromFen(candidate));
    setError(null);
  };

  const handleCopyFen = async () => {
    try {
      await Clipboard.setStringAsync(fenInput);
      appAlert('Copied', 'FEN copied to clipboard.');
    } catch {
      appAlert('Could not copy', 'Please try again.');
    }
  };

  const handleAnalyze = () => {
    const liveFen = buildFen(board, turn, castling);
    const validation = validateEditorFen(liveFen);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setError(null);
    onAnalyze({ initialFen: liveFen, chess960: false, history: [] });
  };

  const renderPaletteButton = (type: PieceType, color: PieceColor) => {
    const selected =
      paletteSelection !== null && paletteSelection !== 'eraser' && paletteSelection.type === type && paletteSelection.color === color;
    return (
      <Pressable
        key={`${color}${type}`}
        style={[styles.paletteButton, selected && styles.paletteButtonActive]}
        onPress={() => setPaletteSelection({ type, color })}
      >
        <Square
          // isLight=false + darkColor=lightColor is just a way to get Square to render a flat
          // background (no checkerboard) for this small palette preview tile.
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
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Board Editor" onBack={onBack} backLabel="‹ Menu" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.boardWrap}>
          <View style={styles.boardBorder}>
            <View style={[styles.board, { width: boardSize, height: boardSize }]}>
              {board.map((row, rowIndex) =>
                row.map((squareData, colIndex) => (
                  <Pressable key={squareData.square} onPress={() => handleSquarePress(squareData.square)}>
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
                  </Pressable>
                ))
              )}
            </View>
          </View>
        </View>

        <View style={styles.toolbarRow}>
          <Pressable style={styles.toolbarButton} onPress={handleStartingPosition}>
            <Text style={styles.toolbarButtonText}>Starting Position</Text>
          </Pressable>
          <Pressable style={[styles.toolbarButton, styles.clearButton]} onPress={handleClearBoard}>
            <Text style={styles.toolbarButtonText}>Clear Board</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Palette</Text>
          <Text style={styles.paletteLabel}>White</Text>
          <View style={styles.paletteRow}>
            {PALETTE_PIECE_ORDER.map((type) => renderPaletteButton(type, 'w'))}
          </View>
          <Text style={styles.paletteLabel}>Black</Text>
          <View style={styles.paletteRow}>
            {PALETTE_PIECE_ORDER.map((type) => renderPaletteButton(type, 'b'))}
          </View>
          <Pressable
            style={[styles.eraserButton, paletteSelection === 'eraser' && styles.paletteButtonActive]}
            onPress={() => setPaletteSelection('eraser')}
          >
            <Text style={styles.eraserButtonText}>Eraser</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Side to move</Text>
          <View style={styles.toggleRow}>
            <Pressable
              style={[styles.toggleChip, turn === 'w' && styles.toggleChipActive]}
              onPress={() => setTurn('w')}
            >
              <Text style={[styles.toggleChipText, turn === 'w' && styles.toggleChipTextActive]}>White</Text>
            </Pressable>
            <Pressable
              style={[styles.toggleChip, turn === 'b' && styles.toggleChipActive]}
              onPress={() => setTurn('b')}
            >
              <Text style={[styles.toggleChipText, turn === 'b' && styles.toggleChipTextActive]}>Black</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Castling rights</Text>
          <View style={styles.toggleRow}>
            {(['K', 'Q', 'k', 'q'] as const).map((key) => (
              <Pressable
                key={key}
                style={[styles.toggleChip, castling[key] && styles.toggleChipActive]}
                onPress={() => setCastling((prev) => ({ ...prev, [key]: !prev[key] }))}
              >
                <Text style={[styles.toggleChipText, castling[key] && styles.toggleChipTextActive]}>{key}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>FEN</Text>
          <TextInput
            style={styles.fenInput}
            value={fenInput}
            onChangeText={setFenInput}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.toolbarRow}>
            <Pressable style={styles.toolbarButton} onPress={handleCopyFen}>
              <Text style={styles.toolbarButtonText}>Copy</Text>
            </Pressable>
            <Pressable style={styles.toolbarButton} onPress={handleLoadFen}>
              <Text style={styles.toolbarButtonText}>Load</Text>
            </Pressable>
          </View>
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <Pressable style={styles.analyzeButton} onPress={handleAnalyze}>
          <Text style={styles.analyzeButtonText}>Analyze this position</Text>
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
      gap: 18,
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
    toolbarRow: {
      flexDirection: 'row',
      gap: 10,
    },
    toolbarButton: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
      backgroundColor: colors.buttonBackground,
    },
    clearButton: {
      backgroundColor: colors.danger,
    },
    toolbarButtonText: {
      color: '#fff',
      fontSize: 14,
      fontWeight: '600',
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
    paletteLabel: {
      fontSize: 12,
      color: colors.textMuted,
    },
    paletteRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    paletteButton: {
      width: 46,
      height: 46,
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
    toggleRow: {
      flexDirection: 'row',
      gap: 8,
    },
    toggleChip: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 8,
      backgroundColor: colors.surface,
    },
    toggleChipActive: {
      backgroundColor: colors.accent,
    },
    toggleChipText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
    toggleChipTextActive: {
      color: '#fff',
    },
    fenInput: {
      minHeight: 60,
      borderRadius: 8,
      backgroundColor: colors.surface,
      color: colors.text,
      padding: 10,
      fontSize: 13,
      fontFamily: 'monospace',
      textAlignVertical: 'top',
    },
    errorText: {
      fontSize: 13,
      color: colors.danger,
    },
    analyzeButton: {
      paddingVertical: 14,
      borderRadius: 10,
      alignItems: 'center',
      backgroundColor: colors.accent,
    },
    analyzeButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '700',
    },
  });
}
