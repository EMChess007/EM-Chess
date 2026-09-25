import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { ChessEngine } from '../logic/ChessEngine';
import { useActiveBoardTheme, useActivePieceTheme } from '../logic/themeHooks';
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
  const { width, height } = useWindowDimensions();
  const boardSize = getBoardSize(width, height);
  const squareSize = boardSize / 8;
  const boardTheme = useActiveBoardTheme();
  const pieceTheme = useActivePieceTheme();

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
  const status = engine.getStatus();

  // Reuses the same check/checkmate detection already driving status text and game-end logic
  // elsewhere (ChessEngine.getStatus(), itself chess.js's own isCheck()/isCheckmate()) rather
  // than a second detector — isCheck()/isCheckmate() are always about the side TO MOVE, so this
  // naturally covers "my king" or "the opponent's king" depending on whose turn it now is, in
  // every mode (including Chess960, since it's derived from the same board/turn everything else
  // already uses). Checkmate intentionally keeps this highlighted (status stays 'checkmate'),
  // same as check.
  const checkedKingSquare = useMemo(() => {
    if (status !== 'check' && status !== 'checkmate') return null;
    for (const row of board) {
      for (const square of row) {
        if (square.piece?.type === 'k' && square.piece.color === turn) return square.square;
      }
    }
    return null;
  }, [board, turn, status]);

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
              isChecked={square.square === checkedKingSquare}
              size={squareSize}
              onPress={handleSquarePress}
              lightColor={boardTheme.lightColor}
              darkColor={boardTheme.darkColor}
              pieceImages={pieceTheme.images}
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
