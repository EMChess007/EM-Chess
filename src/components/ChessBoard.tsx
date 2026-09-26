import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ChessEngine } from '../logic/ChessEngine';
import { useActiveBoardTheme, useActivePieceTheme } from '../logic/themeHooks';
import type { Move, PieceColor, Piece as PieceModel } from '../types/chess';
import { getBoardSize } from './boardSize';
import Piece from './Piece';
import Square from './Square';

interface ChessBoardProps {
  fen: string;
  onMove: (move: Move, fen: string) => void;
  disabled?: boolean;
  chess960?: boolean;
  initialFen?: string;
  /** Which side's pieces render at the bottom. Defaults to 'w' (White at bottom, as usual). */
  orientation?: PieceColor;
  /** The move that produced the current `fen` (from whichever position was displayed just
   * before it), if any — highlights its two squares and, when it looks like a genuine single
   * forward step (see the animation effect below), slides the piece in from origin to
   * destination instead of it just appearing at the destination. Pass `null`/omit for a
   * freshly-set-up board with no "last move" to show. */
  lastMove?: Move | null;
}

const ANIMATION_DURATION_MS = 200;

function squareToRowCol(square: string, orientation: PieceColor): { row: number; col: number } {
  const file = square.charCodeAt(0) - 97; // 'a' -> 0
  const rank = parseInt(square[1], 10);
  let row = 8 - rank; // 0 = rank 8 (top, unflipped)
  let col = file; // 0 = file a (left, unflipped)
  if (orientation === 'b') {
    row = 7 - row;
    col = 7 - col;
  }
  return { row, col };
}

export default function ChessBoard({
  fen,
  onMove,
  disabled,
  chess960,
  initialFen,
  orientation = 'w',
  lastMove,
}: ChessBoardProps) {
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

  // Slide animation: a moving piece "sprite" overlaid on top of the static grid, translated from
  // the origin square's pixel position to the destination's over ANIMATION_DURATION_MS. The
  // destination square's own (already-updated) piece is hidden for the duration so it doesn't
  // just appear there instantly underneath the incoming sprite (see `hidePiece` below).
  const animatedOffset = useRef(new Animated.ValueXY()).current;
  const [slidingMove, setSlidingMove] = useState<{ to: string; piece: PieceModel } | null>(null);
  const prevFenRef = useRef(fen);

  useEffect(() => {
    const prevFen = prevFenRef.current;
    prevFenRef.current = fen;
    if (!lastMove || prevFen === fen) return;

    // Only animate when the position just before this one actually had the mover's piece
    // sitting on `lastMove.from` — i.e. this really is one forward step from what was just on
    // screen, not e.g. a jump to an arbitrary position while scrubbing move history. A relatively
    // cheap, self-verifying check rather than threading a separate "did a live move just happen"
    // flag through every caller.
    let movingPiece: PieceModel | null = null;
    try {
      movingPiece = new ChessEngine(prevFen, { chess960, initialFen }).getPieceAt(lastMove.from);
    } catch {
      movingPiece = null;
    }
    if (!movingPiece) return;

    const from = squareToRowCol(lastMove.from, orientation);
    const to = squareToRowCol(lastMove.to, orientation);
    animatedOffset.setValue({ x: from.col * squareSize, y: from.row * squareSize });
    setSlidingMove({ to: lastMove.to, piece: movingPiece });

    Animated.timing(animatedOffset, {
      toValue: { x: to.col * squareSize, y: to.row * squareSize },
      duration: ANIMATION_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      // The web Animated implementation doesn't support the native driver at all — this only
      // ever runs the JS-driven timing loop there regardless, but passing true anyway causes it
      // to log a dev warning on every single move.
      useNativeDriver: Platform.OS !== 'web',
    }).start(() => setSlidingMove(null));
    // Only `fen` actually needs to retrigger this — lastMove/chess960/initialFen/orientation/
    // squareSize are all read fresh from the closure at the moment `fen` changes, which is
    // exactly when they're relevant (the move that produced this new fen).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
              isLastMove={square.square === lastMove?.from || square.square === lastMove?.to}
              hidePiece={slidingMove !== null && square.square === slidingMove.to}
              size={squareSize}
              onPress={handleSquarePress}
              lightColor={boardTheme.lightColor}
              darkColor={boardTheme.darkColor}
              pieceImages={pieceTheme.images}
            />
          ))
        )}

        {slidingMove && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.slidingPiece,
              {
                width: squareSize,
                height: squareSize,
                transform: [{ translateX: animatedOffset.x }, { translateY: animatedOffset.y }],
              },
            ]}
          >
            <Piece piece={slidingMove.piece} images={pieceTheme.images} />
          </Animated.View>
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
    position: 'relative',
  },
  slidingPiece: {
    position: 'absolute',
    top: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
