import { useRef, useState, type RefObject } from 'react';
import { PanResponder, type View } from 'react-native';
import { LONG_PRESS_MS, MOVE_THRESHOLD_PX, decideRelease, pixelToCell } from '../logic/boardGestures';
import type { GridPoint } from './BoardAnnotations';

export { LONG_PRESS_MS, MOVE_THRESHOLD_PX };

export interface BoardGestureOptions {
  /** Side of one square in pixels. */
  squareSize: number;
  /** Grid size in squares: 8 x 8 for classic chess, 14 x 14 for 4 Player Chess. */
  rows: number;
  cols: number;
  /** Long-press-drag draws arrows / long-press-release toggles a highlight. Off: only taps are reported. */
  enableAnnotations: boolean;
  /** A quick tap (or a stationary hold) on a display cell — row/col as DRAWN, row 0 at the top, col 0 at the left. */
  onTap: (cell: GridPoint) => void;
  /** An armed long-press drag released on a different cell. */
  onArrow: (from: GridPoint, to: GridPoint) => void;
  /** An armed long-press released on the cell it started on. */
  onHighlight: (cell: GridPoint) => void;
}

export interface BoardGestures {
  /** Attach to the board's container View (and spread `panHandlers` onto the same View). */
  containerRef: RefObject<View | null>;
  /** Pass as the container's `onLayout`. */
  onLayout: () => void;
  panHandlers: ReturnType<typeof PanResponder.create>['panHandlers'];
  /** The in-progress arrow while the finger is still down (drawn to the raw finger position), or null. */
  liveArrow: { from: GridPoint; toX: number; toY: number } | null;
  /** Drops the live preview (the board calls this when the position changes under a drag). */
  clearLiveArrow: () => void;
}

/**
 * The touch handling shared by every board in the app (the 2-player ChessBoard and the 4 Player board): a quick tap behaves like a
 * per-square press; a long-press-and-drag draws an arrow (or, released back on the same square, toggles a highlight there) when
 * `enableAnnotations` is on. The hook knows NOTHING about squares or orientation — it speaks in DISPLAY grid cells (row/col as drawn)
 * and the board maps those to its own squares, which is exactly where each board's rotation lives.
 *
 * One PanResponder on the board container (rather than a Pressable per square) is what makes it possible to track the finger
 * continuously after the long-press fires, which Pressable's onPress/onLongPress alone can't do. Extracted from ChessBoard.tsx; every
 * comment about a past bug below is from that code and still applies to every board that uses this. ONE deliberate difference: the
 * PanResponder is created once, not on every render (see the comment at its creation) — the old per-render creation made every long-press
 * drag look like a tap on release.
 *
 * Positions are computed from `nativeEvent.pageX/pageY` (always relative to the app root) minus this board's own measured on-screen
 * offset — NOT from `locationX/locationY`, which turned out to be relative to whichever of the square children the touch actually hit
 * (a real, if poorly documented, React Native behavior for a responder with overlapping/nested children), not to this responder view
 * itself. That made every tap resolve to a position within a single square-sized child instead of across the whole board, which
 * collapsed almost every tap to row/col (0, 0) regardless of where the board was actually touched. This is what made tap-to-select
 * appear completely dead.
 */
export function useBoardGestures(options: BoardGestureOptions): BoardGestures {
  // The PanResponder below is created ONCE for the life of the board, so its handlers must not close over this render's options (they
  // would go stale): they read the CURRENT ones through this ref instead.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [liveArrow, setLiveArrow] = useState<{ from: GridPoint; toX: number; toY: number } | null>(null);

  const gestureRef = useRef<{
    startCell: GridPoint;
    longPressTimer: ReturnType<typeof setTimeout> | null;
    armed: boolean;
  } | null>(null);
  const containerRef = useRef<View>(null);
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
    const node = containerRef.current;
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

  const pixelToGrid = (localX: number, localY: number): GridPoint => {
    const { squareSize, rows, cols } = optionsRef.current;
    return pixelToCell(localX, localY, squareSize, rows, cols);
  };

  const toBoardLocal = (pageX: number, pageY: number) => ({
    x: pageX - boardOffsetRef.current.x,
    y: pageY - boardOffsetRef.current.y,
  });

  const clearGesture = () => {
    if (gestureRef.current?.longPressTimer) clearTimeout(gestureRef.current.longPressTimer);
    gestureRef.current = null;
    setLiveArrow(null);
  };

  // ONE PanResponder for the life of the board — created lazily by a useState initializer, which React guarantees to run once. It used to
  // be re-created on every render ("deliberately NOT memoized", so handlers always saw fresh props), and that silently broke arrows
  // and highlights: a PanResponder keeps its gesture state (dx, dy, moveX, ...) INSIDE the instance, and this board re-renders all the
  // time — on every long-press-drag move (the live arrow is state) and, in 4 Player Chess, on every 200 ms clock tick. So the touch-end was
  // handled by a brand-new instance that had never seen a move (dx = dy = moveX = 0), the drag looked like a stationary tap, and the
  // finished arrow was never committed. Fresh props now come from optionsRef instead, which is what the old comment was protecting.
  const [panResponder] = useState(() =>
    PanResponder.create({
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
      const startCell = pixelToGrid(localX, localY);

      // Arming here only ever means "a live arrow/highlight preview may start showing if the
      // finger goes on to actually drag" — it no longer decides tap-vs-annotation by itself
      // (see onPanResponderRelease's own doc comment: that decision is distance-based now, not
      // time-based), so there's no need to suppress it just because a piece happens to be
      // selected — a genuine drag should still draw an arrow regardless.
      const timer = optionsRef.current.enableAnnotations
        ? setTimeout(() => {
            if (!gestureRef.current) return;
            gestureRef.current.armed = true;
            setLiveArrow({ from: startCell, toX: localX, toY: localY });
          }, LONG_PRESS_MS)
        : null;
      gestureRef.current = { startCell, longPressTimer: timer, armed: false };
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

      const { x: localX, y: localY } = toBoardLocal(gestureState.moveX, gestureState.moveY);
      setLiveArrow({ from: state.startCell, toX: localX, toY: localY });
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
      const startCell = state.startCell;
      const dx = gestureState.dx;
      const dy = gestureState.dy;

      const resolveRelease = (offset: { x: number; y: number }, viaFreshMeasurement: boolean) => {
        const localX = pageX - offset.x;
        const localY = pageY - offset.y;
        const cell = pixelToGrid(localX, localY);

        if (__DEV__) {
          // Defensive diagnostic — if a tap ever resolves to the wrong square again, this is
          // the first thing to check: was a fresh measurement actually awaited, and does the
          // offset used look like the board's real on-screen position. Console-only (not
          // logDiagnostic): this fires on every single tap, far more often than this app's
          // other diagnostic events, and would otherwise cycle the shared 100-entry ring buffer
          // out within a handful of moves — a build that actually needs this (not just dev) can
          // still get it from a cable + adb logcat, same as before this session.
          console.log(
            `[Board] tap -> row ${cell.row}, col ${cell.col} | page=(${pageX.toFixed(1)},${pageY.toFixed(1)}) ` +
              `offset=(${offset.x.toFixed(1)},${offset.y.toFixed(1)}) ` +
              `${viaFreshMeasurement ? '[awaited a fresh measurement]' : '[used cached offset]'}`
          );
        }

        // What the touch MEANS is decided by decideRelease (logic/boardGestures.ts, unit-tested): distance first, never the long-press timer.
        const decision = decideRelease({ armed, distance: Math.hypot(dx, dy), startCell, endCell: cell });
        const { onTap, onArrow, onHighlight } = optionsRef.current; // the CURRENT handlers, even if the release was resolved after a re-render
        if (decision.kind === 'tap') onTap(decision.cell);
        else if (decision.kind === 'arrow') onArrow(decision.from, decision.to);
        else if (decision.kind === 'highlight') onHighlight(decision.cell);
        // 'ignore': moved past the tap threshold without ever arming — an aborted drag/scroll attempt, not a tap or an annotation.
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
    })
  );

  return { containerRef, onLayout: () => void remeasureBoardOffset(), panHandlers: panResponder.panHandlers, liveArrow, clearLiveArrow: () => setLiveArrow(null) };
}
