import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { ChessEngine } from '../logic/ChessEngine';
import type { Move, PieceColor } from '../types/chess';
import { getBoardSize } from './boardSize';
import Square from './Square';

interface ChessBoardProps {
  fen: string;
  onMove: (move: Move, fen: string) => void;
  disabled?: boolean;
  chess960?: boolean;
  initialFen?: string;
  /** Which side's pieces render at the bottom. Defaults to 'w' (White at bottom, as usual). */
  orientation?: PieceColor;
}

export default function ChessBoard({ fen, onMove, disabled, chess960, initialFen, orientation = 'w' }: ChessBoardProps) {
  const { width } = useWindowDimensions();
  const boardSize = getBoardSize(width);
  const squareSize = boardSize / 8;

  const engine = useMemo(
    () => new ChessEngine(fen, { chess960, initialFen }),
    [fen, chess960, initialFen]
  );
  const board = useMemo(() => engine.getBoard(), [engine]);
  // Reversing both axes together preserves each square's light/dark identity (a 180° rotation
  // keeps checkerboard parity), so the same `(rowIndex + colIndex) % 2` coloring below still
  // works unchanged for either orientation — only the render order (and thus what's "at the
  // bottom") changes; square-id-based logic (selection, legal moves, clicks) is unaffected.
  const displayRows = useMemo(
    () => (orientation === 'b' ? [...board].reverse().map((row) => [...row].reverse()) : board),
    [board, orientation]
  );
  const turn = engine.getTurn();
  const gameOver = engine.isGameOver();

  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);

  useEffect(() => {
    setSelectedSquare(null);
  }, [fen]);

  const legalTargets = selectedSquare ? engine.getLegalMoves(selectedSquare) : [];

  const selectOwnPiece = (square: string) => {
    const squareData = board.flat().find((s) => s.square === square);
    if (squareData?.piece && squareData.piece.color === turn) {
      setSelectedSquare(square);
    } else {
      setSelectedSquare(null);
    }
  };

  const handleSquarePress = (square: string) => {
    if (disabled || gameOver) return;

    if (!selectedSquare) {
      selectOwnPiece(square);
      return;
    }

    if (selectedSquare === square) {
      setSelectedSquare(null);
      return;
    }

    if (legalTargets.includes(square)) {
      const move = engine.move(selectedSquare, square, 'q');
      if (move) {
        setSelectedSquare(null);
        onMove(move, engine.getFen());
        return;
      }
    }

    selectOwnPiece(square);
  };

  return (
    <View style={styles.border}>
      <View style={[styles.board, { width: boardSize, height: boardSize }]}>
        {displayRows.map((row, rowIndex) =>
          row.map((square, colIndex) => (
            <Square
              key={square.square || `${rowIndex}-${colIndex}`}
              data={square}
              isLight={(rowIndex + colIndex) % 2 === 0}
              isSelected={square.square === selectedSquare}
              isLegalTarget={legalTargets.includes(square.square)}
              size={squareSize}
              onPress={handleSquarePress}
            />
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  border: {
    borderWidth: 2,
    borderColor: '#3a2618',
  },
  board: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
