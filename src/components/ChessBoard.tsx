import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ChessEngine } from '../logic/ChessEngine';
import { isTouchInside, subscribeToScreenTouches } from '../logic/screenTouches';
import { PROMOTION_CHOICES, PROMOTION_LABELS, type PromotionPiece, isPromotionMove } from '../logic/promotion';
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
  /** Lightly highlights the 4 center squares (d4/d5/e4/e5) — the King of the Hill win condition —
   * so it's clear what the target is. Off by default; only screens actually playing that variant
   * turn it on. */
  kingOfTheHill?: boolean;
  /** Fog of War only — switches move interaction from legal moves (king-safety enforced) to
   * pseudo-legal moves (see ChessEngine.getPseudoLegalMoves/movePseudoLegal): a move is allowed
   * even if it leaves the mover's own king exposed, and landing on the enemy king is a normal,
   * allowed capture rather than something chess.js would otherwise refuse to generate. Also
   * suppresses check highlighting and the normal isGameOver() gate — see getStatus()'s own
   * chess.js-driven checkmate/stalemate detection, which doesn't apply to this variant at all
   * (rule: no check/checkmate concept); the caller alone decides when the game ends, via
   * `move.captured === 'k'` on whatever movePseudoLegal/onMove returns. */
  fogOfWar?: boolean;
  /** Fog of War only — the squares currently visible to the LOCAL viewer. Squares outside this
   * set render fogged (see Square's isFogged) regardless of what `fen`/the engine actually has
   * there: for Local/Bot this is still the true fen client-side (there's no network boundary to
   * protect there, just a display-correctness concern), and for Online the fen arriving here is
   * already server-redacted, but a blank square in a redacted fen is ambiguous between "known
   * empty" and "fogged" — this set is what actually disambiguates the two. Omit entirely outside
   * Fog of War (undefined means "nothing is fogged").
   */
  visibleSquares?: Set<string>;
}

const KING_OF_THE_HILL_SQUARES = ['d4', 'd5', 'e4', 'e5'];

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

function ChessBoard({
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
  kingOfTheHill = false,
  fogOfWar = false,
  visibleSquares,
}: ChessBoardProps) {
  const { width, height } = useWindowDimensions();
  const boardSize = getBoardSize(width, height);
  const squareSize = boardSize / 8;
  const boardTheme = useActiveBoardTheme();
  const pieceTheme = useActivePieceTheme();

  // skipValidation: Online Fog of War's `fen` is server-redacted and can legitimately be missing
  // a king the viewer can't currently see — see ChessEngine's own doc comment on the option.
  const engine = useMemo(
    () => new ChessEngine(fen, { chess960, initialFen, skipValidation: fogOfWar }),
    [fen, chess960, initialFen, fogOfWar]
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
  // Fog of War has no checkmate/stalemate concept at all, and chess.js's own isGameOver() can
  // still (correctly, but irrelevantly) report one once a position reaches such a pattern via
  // movePseudoLegal — the caller alone decides when a Fog of War game ends (king capture), via
  // the `disabled` prop, so this never gates input itself in that mode.
  const gameOver = fogOfWar ? false : engine.isGameOver();
  const status = engine.getStatus();

  // Reuses the same check/checkmate detection already driving status text and game-end logic
  // elsewhere (ChessEngine.getStatus(), itself chess.js's own isCheck()/isCheckmate()) rather
  // than a second detector — isCheck()/isCheckmate() are always about the side TO MOVE, so this
  // naturally covers "my king" or "the opponent's king" depending on whose turn it now is, in
  // every mode (including Chess960, since it's derived from the same board/turn everything else
  // already uses). Checkmate intentionally keeps this highlighted (status stays 'checkmate'),
  // same as check. Never highlighted in Fog of War — check isn't announced there at all.
  const checkedKingSquare = useMemo(() => {
    if (fogOfWar || (status !== 'check' && status !== 'checkmate')) return null;
    for (const row of board) {
      for (const square of row) {
        if (square.piece?.type === 'k' && square.piece.color === turn) return square.square;
      }
    }
    return null;
  }, [board, turn, status, fogOfWar]);

  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);

  // A human move that promotes a pawn is frozen here until they pick the piece — see
  // handleSquarePress/completePromotion. `kind` records whether it resolves into a real move or a
  // queued premove once chosen.
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string; color: PieceColor; kind: 'move' | 'premove' } | null>(null);

  useEffect(() => {
    setSelectedSquare(null);
    setPendingPromotion(null);
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

    // Fog of War: the sliding sprite below is a separate overlay rendered on top of the whole
    // grid, entirely outside Square's own fog check — animating it for a move whose squares
    // aren't in the viewer's own current visibility would show the piece moving in full view for
    // the animation's duration, then hide it, a flash leak of exactly the information this mode
    // exists to hide. Skipping the animation outright and letting the static (correctly fogged)
    // board render directly is what actually prevents that — not narrowing the sprite's own
    // visuals, since by the time any narrowing could apply the leak has already happened.
    if (visibleSquares && (!visibleSquares.has(lastMove.from) || !visibleSquares.has(lastMove.to))) return;

    // Only animate when the position just before this one actually had the mover's piece
    // sitting on `lastMove.from` — i.e. this really is one forward step from what was just on
    // screen, not e.g. a jump to an arbitrary position while scrubbing move history. A relatively
    // cheap, self-verifying check rather than threading a separate "did a live move just happen"
    // flag through every caller.
    let movingPiece: PieceModel | null = null;
    try {
      movingPiece = new ChessEngine(prevFen, { chess960, initialFen, skipValidation: fogOfWar }).getPieceAt(lastMove.from);
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
  // Fog of War: pseudo-legal targets (see ChessBoard's own fogOfWar doc comment) instead of
  // king-safety-filtered legal ones — getPseudoLegalMoves already generates for `selectableColor`
  // regardless of whose turn it actually is, which is also what makes this correct in premove mode.
  const legalTargets =
    selectedSquare && !isPremoveMode
      ? fogOfWar
        ? engine
            .getPseudoLegalMoves(selectableColor)
            .filter((m) => m.from === selectedSquare)
            .map((m) => m.to)
        : engine.getLegalMoves(selectedSquare)
      : [];

  const selectOwnPiece = (square: string) => {
    const squareData = board.flat().find((s) => s.square === square);
    if (squareData?.piece && squareData.piece.color === selectableColor) {
      setSelectedSquare(square);
    } else {
      setSelectedSquare(null);
    }
  };

  const handleSquarePress = (square: string) => {
    if (disabled || gameOver || pendingPromotion) return;

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
      const premovingPiece = board.flat().find((s) => s.square === selectedSquare)?.piece;
      if (premovingPiece && isPromotionMove(premovingPiece, square)) {
        setPendingPromotion({ from: selectedSquare, to: square, color: premovingPiece.color, kind: 'premove' });
        return;
      }
      onPremove?.({ from: selectedSquare, to: square });
      setSelectedSquare(null);
      return;
    }

    if (legalTargets.includes(square)) {
      // A pawn reaching its last rank — by a plain push or a capture alike — is never completed
      // automatically: the move is held until the player picks the promotion piece.
      const movingPiece = board.flat().find((s) => s.square === selectedSquare)?.piece;
      if (movingPiece && isPromotionMove(movingPiece, square)) {
        setPendingPromotion({ from: selectedSquare, to: square, color: movingPiece.color, kind: 'move' });
        return;
      }

      // A scratch engine, NOT the memoized `engine` above — ChessEngine.move()/movePseudoLegal()
      // mutate chess.js's internal board state in place rather than returning a new instance. If
      // this called them on the memoized `engine`, it would silently fall out of sync with its
      // own useMemo cache key (still `fen`, the OLD position) the instant the move is applied —
      // for the whole window between now and the parent's re-render with the new `fen` prop (an
      // async setState), any OTHER render triggered in between (a different piece of state
      // changing) would reuse the memoized-but-now-mutated `engine` instead of recomputing it,
      // reading the NEW position's data while every other derived value on this render still
      // reflects the OLD `fen`. A disposable engine built from the same fen/options keeps the
      // memoized one untouched until the parent legitimately updates `fen`.
      const moveEngine = new ChessEngine(fen, { chess960, initialFen, skipValidation: fogOfWar });
      const move = fogOfWar ? moveEngine.movePseudoLegal(selectedSquare, square) : moveEngine.move(selectedSquare, square);
      if (move) {
        setSelectedSquare(null);
        onMove(move, moveEngine.getFen());
        return;
      }
    }

    selectOwnPiece(square);
  };

  // Tap outside the board deselects, same as tapping inside it on an empty/unrelated square does.
  // The board's own PanResponder can only ever see touches that land on the board itself, so this
  // listens to the app-wide touch signal instead (see screenTouches.ts / App.tsx). Only subscribed
  // while something is actually selected, and skipped while the promotion picker is up (that has its
  // own full-screen cancel). The touch is NOT consumed — a tap on Resign/Hint/Undo etc. still does
  // its own job as well; this just also clears the selection.
  useEffect(() => {
    if (!selectedSquare || pendingPromotion) return;
    return subscribeToScreenTouches((pageX, pageY) => {
      boardContainerRef.current?.measure((_x, _y, width, height, boardPageX, boardPageY) => {
        if (!isTouchInside(pageX, pageY, { x: boardPageX, y: boardPageY, width, height })) {
          setSelectedSquare(null);
        }
      });
    });
  }, [selectedSquare, pendingPromotion]);

  // Cancelling also deselects the pawn, so the player is back to a clean "nothing selected" state.
  const cancelPromotion = () => {
    setPendingPromotion(null);
    setSelectedSquare(null);
  };

  const completePromotion = (piece: PromotionPiece) => {
    if (!pendingPromotion) return;
    const { from, to, kind } = pendingPromotion;
    setPendingPromotion(null);
    if (kind === 'premove') {
      onPremove?.({ from, to, promotion: piece });
      setSelectedSquare(null);
      return;
    }
    // A scratch engine, never the memoized one — see handleSquarePress's own explanation above.
    const moveEngine = new ChessEngine(fen, { chess960, initialFen, skipValidation: fogOfWar });
    const move = fogOfWar ? moveEngine.movePseudoLegal(from, to, piece) : moveEngine.move(from, to, piece);
    if (move) {
      setSelectedSquare(null);
      onMove(move, moveEngine.getFen());
    }
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
  // The most recent not-yet-resolved remeasureBoardOffset() call, if any — see that function's
  // own doc comment for why onPanResponderRelease needs to be able to wait on this instead of
  // always trusting boardOffsetRef.current, which can be stale mid-flight.
  const pendingMeasureRef = useRef<Promise<{ x: number; y: number }> | null>(null);

  // .measure() is an async round-trip (a real native-bridge round-trip on iOS/Android; still
  // genuinely async on web), so caching its result and reading boardOffsetRef.current elsewhere
  // was a race: if something above the board changes height (e.g. the move-list strip appearing
  // after the first move, or the status line wrapping to a second line for "— Check!") and a tap
  // lands before THIS remeasurement resolves, the release handler would use the board's OLD
  // on-screen position — off by roughly whatever it shifted, silently resolving the tap to the
  // wrong square (confirmed directly: a tap on a square whose piece had legal-move dots showing
  // moments earlier failed to complete a move at all). Calling this at the start of every gesture
  // (not just on layout changes) isn't enough on its own, since "fires before release" was an
  // assumption, not a guarantee, for a fast tap. This now returns the in-flight Promise (tracked
  // in pendingMeasureRef) so onPanResponderRelease can actually wait for a fresh measurement
  // instead of hoping one already landed.
  const remeasureBoardOffset = (): Promise<{ x: number; y: number }> => {
    const node = boardContainerRef.current;
    if (!node) return Promise.resolve(boardOffsetRef.current);
    const promise = new Promise<{ x: number; y: number }>((resolve) => {
      node.measure((_x, _y, _width, _height, pageX, pageY) => {
        const offset = { x: pageX, y: pageY };
        boardOffsetRef.current = offset;
        resolve(offset);
      });
    });
    pendingMeasureRef.current = promise;
    promise.finally(() => {
      // Only clear if nothing newer has started in the meantime (a slower, older measurement
      // resolving after a fresher one must not stomp on the fresher one's own pending-ness).
      if (pendingMeasureRef.current === promise) pendingMeasureRef.current = null;
    });
    return promise;
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
      // Without this, the board — once it claims a gesture on touch-down — never lets go for the
      // rest of that gesture, even for a vertical drag that was clearly meant to scroll the
      // surrounding screen (see GameScreenBody). A plain tap never triggers this at all (it never
      // moves enough for anything to request termination); a genuinely armed long-press-drawn
      // arrow refuses to be interrupted mid-draw. Everything else — most of all, an ordinary
      // scroll swipe that happens to start over the board — hands off to whichever ancestor
      // ScrollView asks for it.
      onPanResponderTerminationRequest: () => !gestureRef.current?.armed,
      onPanResponderGrant: (evt) => {
        // Fired here (in addition to onLayout) so this gesture's own later events — chiefly
        // onPanResponderRelease, where a tap actually resolves to a square — use a freshly
        // re-measured offset instead of a possibly-stale one (see remeasureBoardOffset).
        remeasureBoardOffset();
        const { x: localX, y: localY } = toBoardLocal(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
        const { row, col } = pixelToGrid(localX, localY);
        const startSquare = rowColToSquare(row, col, orientation);

        // Arming here only ever means "a live arrow/highlight preview may start showing if the
        // finger goes on to actually drag" — it no longer decides tap-vs-annotation by itself
        // (see onPanResponderRelease's own doc comment: that decision is distance-based now, not
        // time-based), so there's no need to suppress it just because a piece happens to be
        // selected — a genuine drag should still draw an arrow regardless.
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
        // Captured now, before clearGesture() below — resolveRelease may run asynchronously
        // (waiting on a pending measurement), by which point gestureRef.current would already be
        // cleared.
        const armed = state.armed;
        const startSquare = state.startSquare;
        const dx = gestureState.dx;
        const dy = gestureState.dy;

        const resolveRelease = (offset: { x: number; y: number }, viaFreshMeasurement: boolean) => {
          const localX = pageX - offset.x;
          const localY = pageY - offset.y;
          const { row, col } = pixelToGrid(localX, localY);
          const resolvedSquare = rowColToSquare(row, col, orientation);

          if (__DEV__) {
            // Defensive diagnostic — if a tap ever resolves to the wrong square again, this is
            // the first thing to check: was a fresh measurement actually awaited, and does the
            // offset used look like the board's real on-screen position. Console-only (not
            // logDiagnostic): this fires on every single tap, far more often than this app's
            // other diagnostic events, and would otherwise cycle the shared 100-entry ring buffer
            // out within a handful of moves — a build that actually needs this (not just dev) can
            // still get it from a cable + adb logcat, same as before this session.
            console.log(
              `[ChessBoard] tap -> ${resolvedSquare} | page=(${pageX.toFixed(1)},${pageY.toFixed(1)}) ` +
                `offset=(${offset.x.toFixed(1)},${offset.y.toFixed(1)}) ` +
                `${viaFreshMeasurement ? '[awaited a fresh measurement]' : '[used cached offset]'}`
            );
          }

          // Root-cause fix: whether this was a genuinely STATIONARY release (finger never moved
          // past MOVE_THRESHOLD_PX) decides everything — NOT whether the long-press timer
          // happened to already fire (see onPanResponderGrant's 400ms timer above). The previous
          // version branched on `armed` first, so an entirely ordinary tap that simply took
          // >=LONG_PRESS_MS to release (easy mid-move-selection, or just hesitating over which
          // piece to pick) got silently reinterpreted as an annotation gesture instead of calling
          // handleSquarePress at all — no error, nothing in the diagnostic log above either,
          // since that only ever records the resolved square, never whether it actually reached
          // handleSquarePress. A real annotation drag always involves genuine movement past the
          // threshold; a stationary release never does, regardless of how long it was held — so
          // checking distance first, unconditionally, closes the whole timing-dependent bug
          // class rather than the specific places it was spotted.
          const isStationary = Math.hypot(dx, dy) <= MOVE_THRESHOLD_PX;
          if (isStationary) {
            handleSquarePress(resolvedSquare);
          } else if (armed) {
            const startGrid = squareToRowCol(startSquare, orientation);
            if (resolvedSquare === startSquare) {
              setHighlights((prev) =>
                prev.some((p) => p.row === startGrid.row && p.col === startGrid.col)
                  ? prev.filter((p) => !(p.row === startGrid.row && p.col === startGrid.col))
                  : [...prev, startGrid]
              );
            } else {
              setArrows((prev) => [...prev, { from: startGrid, to: { row, col } }]);
            }
          }
          // else: moved past the tap threshold without ever arming — an aborted drag/scroll
          // attempt (enableAnnotations off, or it moved too fast to arm), not a tap or an
          // annotation. Deliberately does nothing rather than acting on whatever square it
          // happened to end on.
        };

        // The crux of the fix: if a remeasure triggered at gesture-grant (or by a layout shift
        // just before it) hasn't resolved yet, WAIT for it instead of resolving this tap against
        // a boardOffsetRef that might still reflect the board's position before that shift.
        if (pendingMeasureRef.current) {
          pendingMeasureRef.current.then((offset) => resolveRelease(offset, true));
        } else {
          resolveRelease(boardOffsetRef.current, false);
        }
        clearGesture();
      },
      onPanResponderTerminate: clearGesture,
  });

  return (
    <View style={styles.border}>
      <View
        ref={boardContainerRef}
        onLayout={remeasureBoardOffset}
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
              isKingOfTheHillTarget={kingOfTheHill && KING_OF_THE_HILL_SQUARES.includes(square.square)}
              hidePiece={slidingMove !== null && square.square === slidingMove.to}
              isFogged={visibleSquares !== undefined && !visibleSquares.has(square.square)}
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

      {/* A real Modal, not an overlay inside the board: it covers the WHOLE screen, so a tap
          anywhere outside the four buttons — on the board or off it — lands on the backdrop and
          cancels. (An earlier absolutely-positioned overlay only covered the board's own bounds,
          so taps elsewhere on the screen never reached it.) Android's back button cancels too. */}
      <Modal
        visible={pendingPromotion !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={cancelPromotion}
      >
        <Pressable style={styles.promotionBackdrop} onPress={cancelPromotion} accessibilityLabel="Cancel promotion">
          <View style={styles.promotionPanel}>
            <Text style={styles.promotionTitle}>Promote to</Text>
            <View style={styles.promotionRow}>
              {PROMOTION_CHOICES.map((choice) => (
                <Pressable
                  key={choice}
                  style={[styles.promotionButton, { width: squareSize * 1.15, height: squareSize * 1.15 }]}
                  onPress={() => completePromotion(choice)}
                  accessibilityRole="button"
                  accessibilityLabel={`Promote to ${PROMOTION_LABELS[choice]}`}
                >
                  <Piece piece={{ type: choice, color: pendingPromotion?.color ?? 'w' }} images={pieceTheme.images} />
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  promotionBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  promotionPanel: {
    backgroundColor: '#f4ecd8',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 8,
  },
  promotionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3a2618',
  },
  promotionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  promotionButton: {
    backgroundColor: '#d9c8a3',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
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

// Default (shallow) prop comparison is enough as long as every caller keeps fen/visibleSquares/
// lastMove/onMove/onPremove referentially stable across renders that don't actually change the
// position (see LocalGameScreen/BotGameScreen/OnlineGameScreen's memoized handleMove/
// handleQueuePremove) — without this, the once-a-second chess clock tick in those screens was
// forcing this whole board (64 Square children + piece images) to re-render from scratch on
// every tick regardless of whether the position had changed at all.
export default memo(ChessBoard);
