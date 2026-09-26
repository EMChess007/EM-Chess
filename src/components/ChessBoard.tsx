import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ChessEngine } from '../logic/ChessEngine';
import { useActiveBoardTheme, useActivePieceTheme } from '../logic/themeHooks';
import type { Move, PieceColor, Piece as PieceModel } from '../types/chess';
import BoardAnnotations, { type BoardArrow, type GridPoint } from './BoardAnnotations';
import { getBoardSize } from './boardSize';
import Piece from './Piece';
import Square from './Square';

// How long a hold must last before it's treated as "start drawing an arrow/highlight" instead of
// a normal tap-to-select/tap-to-move — long enough that an ordinary quick tap never triggers it.
const LONG_PRESS_MS = 400;
// How far (in raw screen pixels) a touch may drift before the long-press timer even has a chance
// to fire and still count as "held in place" — beyond this it's read as an intentional drag
// starting immediately, not a long-press.
const MOVE_THRESHOLD_PX = 10;

export interface PremoveIntent {
  from: string;
  to: string;
  promotion?: 'n' | 'b' | 'r' | 'q';
}

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
  /** Lets the player long-press-drag to draw arrows and tap-and-hold to highlight squares (see
   * BoardAnnotations) — cleared automatically whenever `fen` changes. Off by default; only
   * Analysis/Local/Bot screens turn it on today. */
  enableAnnotations?: boolean;
  /** When set (to the local player's own color) and it isn't currently that color's turn, lets
   * the player select one of their own pieces and a destination anyway — instead of attempting a
   * real move, this calls `onPremove` with the raw (unvalidated) intent. The caller owns queuing/
   * executing/cancelling it once it's actually this color's turn (see OnlineGameScreen/
   * BotGameScreen's premove state) — ChessBoard itself doesn't preview legal targets for it, since
   * whether it's still legal can only really be known once it's actually that color's turn. */
  premoveColor?: PieceColor;
  onPremove?: (move: PremoveIntent) => void;
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

/** Inverse of squareToRowCol — the grid cell under a finger back to an algebraic square id. */
function rowColToSquare(row: number, col: number, orientation: PieceColor): string {
  const r = orientation === 'b' ? 7 - row : row;
  const c = orientation === 'b' ? 7 - col : col;
  const rank = 8 - r;
  const file = String.fromCharCode(97 + c);
  return `${file}${rank}`;
}

export default function ChessBoard({
  fen,
  onMove,
  disabled,
  chess960,
  initialFen,
  orientation = 'w',
  lastMove,
  enableAnnotations = false,
  premoveColor,
  onPremove,
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

  // Arrows/highlights (see BoardAnnotations) — always reset on a real position change (a move
  // played, a rewind/forward through history, a "New Game"), same as selectedSquare above.
  const [arrows, setArrows] = useState<BoardArrow[]>([]);
  const [highlights, setHighlights] = useState<GridPoint[]>([]);
  const [liveArrow, setLiveArrow] = useState<{ from: GridPoint; toX: number; toY: number } | null>(null);

  useEffect(() => {
    setArrows([]);
    setHighlights([]);
    setLiveArrow(null);
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

  // Premove mode: true only while it's genuinely NOT premoveColor's turn — once it becomes their
  // turn, this is exactly normal play again (the caller is expected to have already applied/
  // cancelled any pending premove by then, see OnlineGameScreen/BotGameScreen).
  const isPremoveMode = premoveColor !== undefined && premoveColor !== turn;
  const selectableColor = isPremoveMode ? premoveColor : turn;
  const legalTargets = selectedSquare && !isPremoveMode ? engine.getLegalMoves(selectedSquare) : [];

  const selectOwnPiece = (square: string) => {
    const squareData = board.flat().find((s) => s.square === square);
    if (squareData?.piece && squareData.piece.color === selectableColor) {
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

    if (isPremoveMode) {
      const squareData = board.flat().find((s) => s.square === square);
      if (squareData?.piece && squareData.piece.color === selectableColor) {
        setSelectedSquare(square); // reselect a different piece to premove instead
        return;
      }
      onPremove?.({ from: selectedSquare, to: square, promotion: 'q' });
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

  // --- Unified touch handling for the whole grid: a quick tap behaves exactly like the old
  // per-square Pressable.onPress did (see handleSquarePress above); a long-press-and-drag draws
  // an arrow (or, released back on the same square, toggles a highlight there) when
  // `enableAnnotations` is on. One PanResponder on the board container (rather than a Pressable
  // per square) is what makes it possible to track the finger continuously after the long-press
  // fires, which Pressable's onPress/onLongPress alone can't do.
  //
  // Positions are computed from `nativeEvent.pageX/pageY` (always relative to the app root) minus
  // this board's own measured on-screen offset — NOT from `locationX/locationY`, which turned out
  // to be relative to whichever of the 64 Square children the touch actually hit (a real, if
  // poorly documented, React Native behavior for a responder with overlapping/nested children),
  // not to this responder view itself. That made every tap resolve to a position within a single
  // ~squareSize-sized child instead of across the whole board, which — since squareSize divides
  // squareSize to a value under 1 — collapsed almost every tap to row/col (0, 0) regardless of
  // where the board was actually touched. This is what made tap-to-select appear completely dead.
  const gestureRef = useRef<{
    startSquare: string;
    longPressTimer: ReturnType<typeof setTimeout> | null;
    armed: boolean;
  } | null>(null);
  const boardContainerRef = useRef<View>(null);
  const boardOffsetRef = useRef({ x: 0, y: 0 });

  const handleBoardLayout = () => {
    boardContainerRef.current?.measure((_x, _y, _width, _height, pageX, pageY) => {
      boardOffsetRef.current = { x: pageX, y: pageY };
    });
  };

  const pixelToGrid = (localX: number, localY: number): GridPoint => ({
    row: Math.min(7, Math.max(0, Math.floor(localY / squareSize))),
    col: Math.min(7, Math.max(0, Math.floor(localX / squareSize))),
  });

  const toBoardLocal = (pageX: number, pageY: number) => ({
    x: pageX - boardOffsetRef.current.x,
    y: pageY - boardOffsetRef.current.y,
  });

  const clearGesture = () => {
    if (gestureRef.current?.longPressTimer) clearTimeout(gestureRef.current.longPressTimer);
    gestureRef.current = null;
    setLiveArrow(null);
  };

  // Deliberately NOT memoized (e.g. via useRef/useMemo) — PanResponder.create() is cheap, and its
  // handlers below close over this render's handleSquarePress/orientation/enableAnnotations/
  // squareSize. Freezing it into a ref on first mount (a common pattern elsewhere) would pin every
  // handler to that first render's values forever, silently breaking moves/orientation on every
  // render after the very first one.
  const panResponder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const { x: localX, y: localY } = toBoardLocal(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
        const { row, col } = pixelToGrid(localX, localY);
        const startSquare = rowColToSquare(row, col, orientation);

        const timer = enableAnnotations
          ? setTimeout(() => {
              if (!gestureRef.current) return;
              gestureRef.current.armed = true;
              setLiveArrow({ from: { row, col }, toX: localX, toY: localY });
            }, LONG_PRESS_MS)
          : null;
        gestureRef.current = { startSquare, longPressTimer: timer, armed: false };
      },
      onPanResponderMove: (_evt, gestureState) => {
        const state = gestureRef.current;
        if (!state) return;

        if (!state.armed) {
          // Moved too far before the long-press timer fired — this is a fast drag/swipe, not a
          // held annotation gesture, so cancel the pending timer (it simply won't arm).
          if (Math.hypot(gestureState.dx, gestureState.dy) > MOVE_THRESHOLD_PX && state.longPressTimer) {
            clearTimeout(state.longPressTimer);
            state.longPressTimer = null;
          }
          return;
        }

        const startGrid = squareToRowCol(state.startSquare, orientation);
        const { x: localX, y: localY } = toBoardLocal(gestureState.moveX, gestureState.moveY);
        setLiveArrow({ from: startGrid, toX: localX, toY: localY });
      },
      onPanResponderRelease: (evt, gestureState) => {
        const state = gestureRef.current;
        if (!state) return;

        // moveX/moveY isn't updated until the first move event fires — for a gesture that never
        // moved at all (the common case for a plain tap), it's still 0, so fall back to the
        // release event's own pageX/pageY, which is always populated.
        const hasMoved = gestureState.moveX !== 0 || gestureState.moveY !== 0;
        const pageX = hasMoved ? gestureState.moveX : evt.nativeEvent.pageX;
        const pageY = hasMoved ? gestureState.moveY : evt.nativeEvent.pageY;
        const { x: localX, y: localY } = toBoardLocal(pageX, pageY);
        const { row, col } = pixelToGrid(localX, localY);

        if (state.armed) {
          const endSquare = rowColToSquare(row, col, orientation);
          const startGrid = squareToRowCol(state.startSquare, orientation);

          if (endSquare === state.startSquare) {
            setHighlights((prev) =>
              prev.some((p) => p.row === startGrid.row && p.col === startGrid.col)
                ? prev.filter((p) => !(p.row === startGrid.row && p.col === startGrid.col))
                : [...prev, startGrid]
            );
          } else {
            setArrows((prev) => [...prev, { from: startGrid, to: { row, col } }]);
          }
        } else {
          // A genuine quick tap — release position is still the start square (taps don't drag).
          handleSquarePress(rowColToSquare(row, col, orientation));
        }
        clearGesture();
      },
      onPanResponderTerminate: clearGesture,
  });

  return (
    <View style={styles.border}>
      <View
        ref={boardContainerRef}
        onLayout={handleBoardLayout}
        style={[styles.board, { width: boardSize, height: boardSize }]}
        {...panResponder.panHandlers}
      >
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
              lightColor={boardTheme.lightColor}
              darkColor={boardTheme.darkColor}
              pieceImages={pieceTheme.images}
            />
          ))
        )}

        {enableAnnotations && (
          <BoardAnnotations squareSize={squareSize} arrows={arrows} highlights={highlights} liveArrow={liveArrow} />
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
