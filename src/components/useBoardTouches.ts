import { useRef, type RefObject } from 'react';
import { Platform, type GestureResponderEvent, type PointerEvent as RNPointerEvent, type ViewInstance } from 'react-native';
import type { Cell } from '../logic/boardGestures';
import { EMPTY_TOUCH_BOOK, fingerCell as fingerCellOf, gridTapCell, localOfTouch, originSource, stepTouches, type Point, type Tap, type TouchBook, type TouchEventIn, type TouchTarget } from '../logic/boardTouches';
import type { PromotionPiece } from '../logic/bughouse';
import type { ReservePieceType } from '../logic/crazyhouse';
import type { BoardId } from '../logic/bughouse/types';

/**
 * Bughouse W3b (BUGHOUSE_SPEC.md HP12): the raw-touch input of ONE board, used ONLY by the dual-board Local layout, where two people (or one person with two fingers) play both boards at the
 * same time. `useBoardGestures` is one PanResponder per board and the responder system grants one responder at a time: a second finger on the other board would be ignored or would steal and
 * cancel the first board's gesture. Plain touch events (`onTouchStart` / `Move` / `End` / `Cancel`) are delivered to the view a touch began in whatever the responder system does, so each board
 * (its grid, and each chip of its pocket tray) listens to its own touches, tracked by `identifier` in this board's own book (logic/boardTouches.ts decides what they mean).
 *
 * What it does NOT do: no PanResponder, no responder at all, no screen-level handler, no long-press arrows (taps only), no "tap elsewhere to deselect". A touch that begins outside the grid and
 * the chips (the gutter, a clock bar) reaches nobody. A mouse (web, desktop) is a touch with the identifier "mouse" (pointer events of type "mouse"; a finger's pointer events are ignored here
 * because its touch events already arrived).
 *
 * WHICH FRAME THE POSITION IS IN (the real-phone bug of command #26: on Android every tap landed one rank too low). A tap is turned into a cell by one of two readings, never a mix:
 *   - the GRID'S OWN FRAME, on a phone: the board draws a transparent overlay view over its 8 x 8 grid (`surfaceRef`, rendered by BughouseBoard), so a touch's target is the overlay and its
 *     `locationX / locationY` are the finger's position inside the grid. No origin is read, so no window, status-bar, navigation-bar, header or scroll offset can enter the answer;
 *   - PAGE COORDINATES minus the grid's origin, on the web (and for a touch that did not land on the overlay): `pageX / pageY` against `getBoundingClientRect()` plus the scroll offset in the
 *     browser, against `measure()` (the same root frame as pageX / pageY) on a phone. A phone NEVER reads `getBoundingClientRect()` for it: with the new architecture a View ref has that
 *     method but its answer is in window coordinates (see `originSource`), which is what put every Android tap a status bar too low. The page-coordinate position is read when a grid touch LIFTS
 *     (the board may have moved under a held finger).
 * Chip and promotion taps never read a position.
 */

/** The identifier a mouse gets: a touch identifier is a number written as text, so it can never be this. */
const MOUSE_ID = 'mouse';

/** One finger on a board as the dev touch-debug overlay draws it: where it is in the grid's frame (null when that cannot be told) and the cell under it. */
export interface DebugFinger {
  id: string;
  local: Point | null;
  cell: Cell | null;
}

export interface BoardTouchOptions {
  /** Which board this is: the taps it reports carry it. Required, like every board-naming argument of this game. */
  board: BoardId;
  /** Side of one square in px. */
  cell: number;
  /** A tap inside this board's grid, as the display cell (row 0 = top as drawn). */
  onTapCell: (board: BoardId, cell: Cell) => void;
  /** A tap on one of this board's pocket chips. */
  onTapChip: (board: BoardId, piece: ReservePieceType) => void;
  /** A tap on a button of this board's promotion bar (a piece, or "cancel"). */
  onTapPromotion: (board: BoardId, choice: PromotionPiece | 'cancel') => void;
  /** DEV ONLY (the touch-debug overlay): told about every finger on the grid after each event. Absent in a release build. */
  onDebug?: (fingers: DebugFinger[]) => void;
}

/** The touch props a view takes (a subset of the View's props that both react-native and react-native-web accept). */
export interface TouchProps {
  onTouchStart: (event: TouchLikeEvent) => void;
  onTouchMove: (event: TouchLikeEvent) => void;
  onTouchEnd: (event: TouchLikeEvent) => void;
  onTouchCancel: (event: TouchLikeEvent) => void;
  onPointerDown: (event: PointerLikeEvent) => void;
  onPointerUp: (event: PointerLikeEvent) => void;
  onPointerCancel: (event: PointerLikeEvent) => void;
}

/** The event types of the View's own touch and pointer props (react-native's, which react-native-web hands the DOM event through). */
export type TouchLikeEvent = GestureResponderEvent;
export type PointerLikeEvent = RNPointerEvent;
type RawTouch = GestureResponderEvent['nativeEvent']['changedTouches'][number];

export interface BoardTouches {
  /** Attach to the grid's container View. */
  gridRef: RefObject<ViewInstance | null>;
  /** Attach to the transparent overlay View that covers the grid on a phone (rendered by the board): the touches of the overlay carry the grid's own frame. */
  surfaceRef: RefObject<ViewInstance | null>;
  /** The touch props of the grid on the web: page coordinates against the grid's rectangle. */
  gridProps: TouchProps;
  /** The touch props of the overlay on a phone: locationX / locationY are the position in the grid's own frame (the overlay is the touch's target by construction). */
  surfaceProps: TouchProps;
  /** Touch props for the chip of `piece` in this board's pocket tray. */
  chipProps: (piece: ReservePieceType) => TouchProps;
  /** Touch props for a button of this board's promotion bar. */
  promotionProps: (choice: PromotionPiece | 'cancel') => TouchProps;
}

const GRID: TouchTarget = { kind: 'grid' };

export function useBoardTouches(options: BoardTouchOptions): BoardTouches {
  // The handlers below live for the life of the board and must read the CURRENT options, not the ones of the render that made them.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const bookRef = useRef<TouchBook>(EMPTY_TOUCH_BOOK);
  const gridRef = useRef<ViewInstance>(null);
  const surfaceRef = useRef<ViewInstance>(null);
  const originRef = useRef<Point>({ x: 0, y: 0 });
  const pendingRef = useRef<Promise<void> | null>(null);
  const fingersRef = useRef<Record<string, DebugFinger>>({});

  type OriginNode = { getBoundingClientRect?: () => { left: number; top: number }; measure?: (cb: (x: number, y: number, w: number, h: number, pageX: number, pageY: number) => void) => void };

  /** Re-reads the grid's page origin: at once where the platform allows (web), as a promise where it does not (a phone). */
  const refreshOrigin = (): void => {
    const node = gridRef.current as unknown as OriginNode | null;
    if (!node) return;
    const source = originSource(Platform.OS, typeof node.getBoundingClientRect === 'function', typeof node.measure === 'function');
    if (source === 'rect') {
      const rect = node.getBoundingClientRect!();
      const scrollX = typeof window !== 'undefined' && typeof window.pageXOffset === 'number' ? window.pageXOffset : 0;
      const scrollY = typeof window !== 'undefined' && typeof window.pageYOffset === 'number' ? window.pageYOffset : 0;
      originRef.current = { x: rect.left + scrollX, y: rect.top + scrollY };
      return;
    }
    if (source === 'none') return;
    const measuring = new Promise<void>((resolve) => {
      node.measure!((_x, _y, _w, _h, pageX, pageY) => {
        originRef.current = { x: pageX, y: pageY };
        resolve();
      });
    });
    pendingRef.current = measuring;
    void measuring.finally(() => {
      if (pendingRef.current === measuring) pendingRef.current = null;
    });
  };

  const finish = (tap: Tap | null): void => {
    if (tap === null) return;
    if (tap.target.kind === 'chip') {
      optionsRef.current.onTapChip(optionsRef.current.board, tap.target.piece as ReservePieceType);
      return;
    }
    if (tap.target.kind === 'promotion') {
      optionsRef.current.onTapPromotion(optionsRef.current.board, tap.target.choice as PromotionPiece | 'cancel');
      return;
    }
    const resolve = () => {
      const { board, cell, onTapCell } = optionsRef.current;
      const hit = gridTapCell(tap, originRef.current, cell, 8, 8);
      if (hit !== null) onTapCell(board, hit);
    };
    // A tap that carries the grid's own frame starts no measurement, so with none pending it resolves at once; behind an earlier tap that IS waiting for its measurement it keeps its place in line.
    if (pendingRef.current) void pendingRef.current.then(resolve);
    else resolve();
  };

  /** DEV ONLY: keeps the list of fingers on the grid for the touch-debug overlay (nothing runs when `onDebug` is absent, i.e. in a release build). */
  const debug = (event: TouchEventIn): void => {
    const report = optionsRef.current.onDebug;
    if (!report) return;
    if (event.kind === 'end' || event.kind === 'cancel') {
      delete fingersRef.current[event.id];
    } else {
      let local: Point | null = 'local' in event && event.local ? event.local : null;
      if (local === null) {
        // No grid frame from the platform (the web): the page point against a freshly read origin, as the tap itself would use.
        refreshOrigin();
        local = { x: event.at.x - originRef.current.x, y: event.at.y - originRef.current.y };
      }
      fingersRef.current[event.id] = { id: event.id, local, cell: fingerCellOf(local, optionsRef.current.cell, 8, 8) };
    }
    report(Object.values(fingersRef.current));
  };

  const feed = (event: TouchEventIn, onGrid: boolean): void => {
    // Read when the finger LIFTS (the position that counts is the board's now; a start-time read would be overwritten by this one) - and not at all when the lift carries the grid's own frame.
    if (onGrid && event.kind === 'end' && event.local === undefined) refreshOrigin();
    if (onGrid) debug(event);
    const step = stepTouches(bookRef.current, event);
    bookRef.current = step.book;
    finish(step.tap);
  };

  const propsFor = (target: TouchTarget, frame: 'page' | 'grid' = 'page'): TouchProps => {
    const onGrid = target.kind === 'grid';
    const each = (event: TouchLikeEvent, make: (touch: RawTouch, local: Point | undefined) => TouchEventIn) => {
      const touches = event.nativeEvent.changedTouches;
      if (!touches) return;
      for (let i = 0; i < touches.length; i++) feed(make(touches[i], frame === 'grid' ? localOfTouch(touches[i]) : undefined), onGrid);
    };
    const isMouse = (event: PointerLikeEvent) => event.nativeEvent.pointerType === 'mouse';
    const pointAt = (event: PointerLikeEvent): Point => ({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY });
    const idOf = (t: RawTouch): string => String(t.identifier);
    return {
      onTouchStart: (event) => each(event, (t, local) => ({ kind: 'start', id: idOf(t), at: { x: t.pageX, y: t.pageY }, target, ...(local ? { local } : {}) })),
      onTouchMove: (event) => each(event, (t, local) => ({ kind: 'move', id: idOf(t), at: { x: t.pageX, y: t.pageY }, ...(local ? { local } : {}) })),
      onTouchEnd: (event) => each(event, (t, local) => ({ kind: 'end', id: idOf(t), at: { x: t.pageX, y: t.pageY }, ...(local ? { local } : {}) })),
      onTouchCancel: (event) => each(event, (t) => ({ kind: 'cancel', id: idOf(t) })),
      onPointerDown: (event) => {
        if (isMouse(event) && event.nativeEvent.button === 0) feed({ kind: 'start', id: MOUSE_ID, at: pointAt(event), target }, onGrid);
      },
      onPointerUp: (event) => {
        if (isMouse(event)) feed({ kind: 'end', id: MOUSE_ID, at: pointAt(event) }, onGrid);
      },
      onPointerCancel: (event) => {
        if (isMouse(event)) feed({ kind: 'cancel', id: MOUSE_ID }, onGrid);
      },
    };
  };

  // The grid's props are made once per render but only read the refs, so a stale closure cannot matter.
  return { gridRef, surfaceRef, gridProps: propsFor(GRID), surfaceProps: propsFor(GRID, 'grid'), chipProps: (piece) => propsFor({ kind: 'chip', piece }), promotionProps: (choice) => propsFor({ kind: 'promotion', choice }) };
}
