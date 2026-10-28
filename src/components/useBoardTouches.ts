import { useRef, type RefObject } from 'react';
import type { GestureResponderEvent, PointerEvent as RNPointerEvent, View } from 'react-native';
import type { Cell } from '../logic/boardGestures';
import { EMPTY_TOUCH_BOOK, gridTapCell, stepTouches, type Point, type Tap, type TouchBook, type TouchEventIn, type TouchTarget } from '../logic/boardTouches';
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
 * Positions are page coordinates minus this board's own origin: measured at the start and at the end of a grid touch where the platform lets it be read at once (web), and measured at the
 * start and awaited at the end where it cannot (native `measure`), as `useBoardGestures` does.
 */

/** The identifier a mouse gets: a touch identifier is a number written as text, so it can never be this. */
const MOUSE_ID = 'mouse';

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
  gridRef: RefObject<View | null>;
  gridProps: TouchProps;
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
  const gridRef = useRef<View>(null);
  const originRef = useRef<Point>({ x: 0, y: 0 });
  const pendingRef = useRef<Promise<void> | null>(null);

  /** Re-reads the grid's page origin: at once where the platform allows (web), as a promise where it does not (native). */
  const refreshOrigin = (): void => {
    const node = gridRef.current as unknown as { getBoundingClientRect?: () => { left: number; top: number }; measure?: (cb: (x: number, y: number, w: number, h: number, pageX: number, pageY: number) => void) => void } | null;
    if (!node) return;
    if (typeof node.getBoundingClientRect === 'function') {
      const rect = node.getBoundingClientRect();
      const scrollX = typeof window !== 'undefined' && typeof window.pageXOffset === 'number' ? window.pageXOffset : 0;
      const scrollY = typeof window !== 'undefined' && typeof window.pageYOffset === 'number' ? window.pageYOffset : 0;
      originRef.current = { x: rect.left + scrollX, y: rect.top + scrollY };
      return;
    }
    if (typeof node.measure !== 'function') return;
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
    if (pendingRef.current) void pendingRef.current.then(resolve);
    else resolve();
  };

  const feed = (event: TouchEventIn, onGrid: boolean): void => {
    if (onGrid && (event.kind === 'start' || event.kind === 'end')) refreshOrigin();
    const step = stepTouches(bookRef.current, event);
    bookRef.current = step.book;
    finish(step.tap);
  };

  const propsFor = (target: TouchTarget): TouchProps => {
    const onGrid = target.kind === 'grid';
    const each = (event: TouchLikeEvent, make: (touch: RawTouch) => TouchEventIn) => {
      const touches = event.nativeEvent.changedTouches;
      if (!touches) return;
      for (let i = 0; i < touches.length; i++) feed(make(touches[i]), onGrid);
    };
    const isMouse = (event: PointerLikeEvent) => event.nativeEvent.pointerType === 'mouse';
    const pointAt = (event: PointerLikeEvent): Point => ({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY });
    const idOf = (t: RawTouch): string => String(t.identifier);
    return {
      onTouchStart: (event) => each(event, (t) => ({ kind: 'start', id: idOf(t), at: { x: t.pageX, y: t.pageY }, target })),
      onTouchMove: (event) => each(event, (t) => ({ kind: 'move', id: idOf(t), at: { x: t.pageX, y: t.pageY } })),
      onTouchEnd: (event) => each(event, (t) => ({ kind: 'end', id: idOf(t), at: { x: t.pageX, y: t.pageY } })),
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
  return { gridRef, gridProps: propsFor(GRID), chipProps: (piece) => propsFor({ kind: 'chip', piece }), promotionProps: (choice) => propsFor({ kind: 'promotion', choice }) };
}
