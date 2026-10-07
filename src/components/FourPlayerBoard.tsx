import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useActiveBoardTheme, useActivePieceTheme } from '../logic/themeHooks';
import type { PieceImageMap } from '../types/theme';
import BoardAnnotations from './BoardAnnotations';
import PromotionPicker from './PromotionPicker';
import { useBoardGestures } from './useBoardGestures';
import {
  PROMOTABLE_TYPES,
  SEAT_COLORS,
  SEAT_NAMES,
  SIZE,
  VALID,
  addArrow,
  canPremove,
  currentMoves,
  fileOf,
  fromDisplay,
  getFourPlayerCellSize,
  gridToSquare,
  index,
  isInCheck,
  isPromotedType,
  isPromotionPremove,
  keepAnnotationsAfterMove,
  promotionOf,
  rankOf,
  seatOf,
  seatPieceImageKey,
  squareName,
  squareToGrid,
  toggleHighlight,
  typeOf,
  type FourPlayerPremove,
  type FourPlayerState,
  type Move,
  type Seat,
  type SquareArrow,
} from '../logic/fourPlayer';

/** Filled glyphs for every seat (the outlined set is unreadable once tinted); colour identifies the seat. Promoted types draw as the piece they became. */
const GLYPHS = ['', '♟', '♞', '♝', '♜', '♛', '♚', '♛', '♞', '♝', '♜'];
const TYPE_NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king', 'promoted queen', 'promoted knight', 'promoted bishop', 'promoted rook'];
const DEAD_COLOR = '#8f8f8f';
const PREMOVE_COLOR = '#8ec5ff';

interface FourPlayerBoardProps {
  state: FourPlayerState;
  /** The seat drawn at the bottom of the screen. */
  viewSeat: Seat;
  /** Whether a human may move right now (false while a bot is thinking, after the game, etc.). */
  interactive: boolean;
  /** The last move played (any seat), highlighted. */
  lastMove: { from: number; to: number } | null;
  onMove: (move: Move) => void;
  /**
   * The seat whose player may PREMOVE while it is not their turn (with three other seats to move, that is most of the time). Omit for
   * no premoves (several humans sharing the device, or a game mode that should not offer them). While premoving, the player selects
   * one of their own pieces and a destination (no legal-move preview — whether it is still legal can only be known once the turn
   * is back, see logic/premove.ts) and `onPremove` receives the intent; the screen owns queueing, validating and playing it.
   */
  premoveSeat?: Seat;
  /** The currently queued premove, if any (its two squares are tinted). */
  premove?: FourPlayerPremove | null;
  onPremove?: (premove: FourPlayerPremove) => void;
  /** Long-press-drag draws arrows, long-press highlights a square (the same gesture as the 2-player board). Off by default. */
  enableAnnotations?: boolean;
}

interface PieceArtProps {
  seat: Seat;
  type: number;
  size: number;
  dead: boolean;
  /** The active piece theme's images (undefined for the built-in Classic theme, which keeps the tinted glyphs). */
  images: PieceImageMap | undefined;
}

/**
 * One piece, in the active piece theme. Themes only draw white and black pieces, so a themed piece is the theme's own artwork on a disc
 * in the seat's colour (see `seatPieceImageKey`); the built-in Classic theme keeps its tinted glyphs. An eliminated seat's pieces are
 * grey and faded; a promoted piece carries a small bar (an underline for a glyph).
 */
const PieceArt = memo(function PieceArt({ seat, type, size, dead, images }: PieceArtProps) {
  const imageUri = images?.[seatPieceImageKey(seat, type)];
  const promoted = isPromotedType(type);
  if (imageUri) {
    return (
      <View
        style={[
          styles.disc,
          { width: size * 0.96, height: size * 0.96, borderRadius: size * 0.48, backgroundColor: dead ? DEAD_COLOR : SEAT_COLORS[seat] },
          dead && styles.dead,
        ]}
      >
        <Image source={{ uri: imageUri }} style={{ width: size * 0.78, height: size * 0.78 }} resizeMode="contain" />
        {promoted && <View style={[styles.promotedBar, { width: size * 0.4, bottom: size * 0.05 }]} />}
      </View>
    );
  }
  return (
    <Text
      style={[
        styles.glyph,
        { fontSize: size * 0.78, lineHeight: size, color: dead ? DEAD_COLOR : SEAT_COLORS[seat] },
        dead && styles.dead,
        promoted && styles.promoted,
      ]}
    >
      {GLYPHS[type]}
    </Text>
  );
});

interface CellProps {
  square: number;
  size: number;
  background: string;
  code: number;
  dead: boolean;
  selected: boolean;
  /** 0 none, 1 quiet target, 2 capture target. */
  target: 0 | 1 | 2;
  last: boolean;
  /** One of the two squares of the queued premove. */
  premoveMark: boolean;
  checked: boolean;
  images: PieceImageMap | undefined;
  /** Screen-reader activation only: touches are handled for the whole board by useBoardGestures. */
  onPress: (square: number) => void;
}

const Cell = memo(function Cell({ square, size, background, code, dead, selected, target, last, premoveMark, checked, images, onPress }: CellProps) {
  const seat: Seat = code > 0 ? seatOf(code) : 0;
  const type = code > 0 ? typeOf(code) : 0;
  const bg = checked ? '#ef5350' : selected ? '#a2d149' : premoveMark ? PREMOVE_COLOR : last ? '#f7ec74' : background;
  const label =
    code > 0 ? `${squareName(square)}, ${dead ? 'eliminated ' : ''}${SEAT_NAMES[seat]} ${TYPE_NAMES[type]}${target ? ', can move here' : ''}` : `${squareName(square)}${target ? ', can move here' : ''}`;
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      onAccessibilityTap={() => onPress(square)}
      style={[{ width: size, height: size, backgroundColor: bg }, styles.cell]}
    >
      {code > 0 && <PieceArt seat={seat} type={type} size={size} dead={dead} images={images} />}
      {target === 1 && <View style={[styles.dot, { width: size * 0.32, height: size * 0.32, borderRadius: size * 0.16 }]} />}
      {target === 2 && <View style={[styles.ring, { width: size * 0.9, height: size * 0.9, borderRadius: size * 0.45 }]} />}
    </View>
  );
});

const PROMOTION_NAMES: Record<number, string> = { 5: 'Queen', 4: 'Rook', 3: 'Bishop', 2: 'Knight' };

/**
 * The 4 Player Chess board: the 14 x 14 grid with its four 3 x 3 corners left empty. The board is drawn rotated so that `viewSeat`
 * is at the bottom (a rendering transform only — the engine never rotates anything; pieces stay upright). Tap one of the mover's
 * pieces to see its legal squares, tap a square to move. A pawn reaching its last line asks which piece to become (the shared
 * `PromotionPicker`, drawn in the mover's seat colour), so a human move is a from → to plus, for a promotion, that choice. Pieces use
 * the active piece theme.
 *
 * Touches (tap, long-press-drag arrows, long-press highlights) are handled for the whole board by the shared `useBoardGestures`, which
 * speaks in screen cells; this component maps a screen cell to an absolute square with `gridToSquare(…, viewSeat)` and back with
 * `squareToGrid` — the rotation lives in exactly those two calls, and annotations are STORED as absolute squares (see
 * logic/fourPlayer/annotations.ts), so a Rotate never makes an arrow point somewhere else.
 */
export default function FourPlayerBoard({
  state,
  viewSeat,
  interactive,
  lastMove,
  onMove,
  premoveSeat,
  premove = null,
  onPremove,
  enableAnnotations = false,
}: FourPlayerBoardProps) {
  const { width, height } = useWindowDimensions();
  const theme = useActiveBoardTheme();
  const pieceTheme = useActivePieceTheme();
  const size = getFourPlayerCellSize(width, height);
  const [selected, setSelected] = useState<number | null>(null);
  /** The four promotion moves of a tapped promotion square, while the player is choosing. */
  const [pendingPromotion, setPendingPromotion] = useState<Move[] | null>(null);
  /** A premove that promotes, waiting for the piece choice. */
  const [pendingPremove, setPendingPremove] = useState<{ from: number; to: number } | null>(null);
  const [arrows, setArrows] = useState<readonly SquareArrow[]>([]);
  const [highlights, setHighlights] = useState<readonly number[]>([]);

  /** True while this player may queue a premove: not their turn, still in the game, premoves switched on. */
  const premoveMode = !interactive && premoveSeat !== undefined && onPremove !== undefined && canPremove(state, premoveSeat);
  const isOwnPiece = (square: number): boolean => premoveSeat !== undefined && state.cells[square] > 0 && seatOf(state.cells[square]) === premoveSeat;

  const moves = useMemo(() => (interactive ? currentMoves(state) : []), [state, interactive]);

  const { containerRef, onLayout, panHandlers, liveArrow, clearLiveArrow } = useBoardGestures({
    squareSize: size,
    rows: SIZE,
    cols: SIZE,
    enableAnnotations,
    onTap: (cell) => {
      const square = gridToSquare(cell, viewSeat);
      if (square !== null) handlePress(square);
    },
    onArrow: (from, to) => setArrows((prev) => addArrow(prev, gridToSquare(from, viewSeat), gridToSquare(to, viewSeat))),
    onHighlight: (cell) => setHighlights((prev) => toggleHighlight(prev, gridToSquare(cell, viewSeat))),
  });
  // A new position wipes any half-made normal move. While premoving, a position change is just another seat having moved — with three of
  // them in a row it must not undo the player's own selection or an open promotion choice, so those survive as long as the piece they
  // refer to is still the player's own. Arrows and highlights follow the same idea: they are wiped as on the 2-player board EXCEPT while
  // the player is waiting for their turn (see keepAnnotationsAfterMove), so a plan drawn while the bots play is still there when it is needed.
  const previousMoverRef = useRef<Seat>(state.turn); // whose turn it was in the position that was just replaced
  useEffect(() => {
    setSelected((prev) => (prev !== null && premoveMode && isOwnPiece(prev) ? prev : null));
    setPendingPromotion(null);
    setPendingPremove((prev) => (prev !== null && premoveMode && isOwnPiece(prev.from) ? prev : null));
    if (!keepAnnotationsAfterMove(premoveSeat, previousMoverRef.current, state)) {
      setArrows([]);
      setHighlights([]);
      clearLiveArrow();
    }
    previousMoverRef.current = state.turn;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  /** Target square -> its moves (several only for a promotion: one per piece to promote to). */
  const targetMoves = useMemo(() => {
    const map = new Map<number, Move[]>();
    if (selected !== null) {
      for (const move of moves) {
        if (move.from !== selected) continue;
        const list = map.get(move.to);
        if (list) list.push(move);
        else map.set(move.to, [move]);
      }
    }
    return map;
  }, [moves, selected]);
  const movableSquares = useMemo(() => new Set(moves.map((m) => m.from)), [moves]);

  const checkedSquares = useMemo(() => {
    const squares = new Set<number>();
    for (const seat of [0, 1, 2, 3] as Seat[]) if (state.status[seat] === 'active' && isInCheck(state, seat)) squares.add(state.kings[seat]);
    return squares;
  }, [state]);

  const handlePremovePress = (square: number) => {
    if (premoveSeat === undefined || !onPremove) return;
    if (selected === null) {
      if (isOwnPiece(square)) setSelected(square);
      return;
    }
    if (selected === square) {
      setSelected(null);
      return;
    }
    if (isOwnPiece(square)) {
      setSelected(square); // reselect a different piece to premove instead
      return;
    }
    if (isPromotionPremove(state, premoveSeat, selected, square)) {
      setPendingPremove({ from: selected, to: square }); // ask which piece, then queue
      return;
    }
    onPremove({ from: selected, to: square });
    setSelected(null);
  };

  const handlePress = (square: number) => {
    if (pendingPromotion || pendingPremove) return;
    if (premoveMode) {
      handlePremovePress(square);
      return;
    }
    if (!interactive) return;
    const options = targetMoves.get(square);
    if (options) {
      if (options.length > 1) {
        setPendingPromotion(options); // a promotion: ask which piece
        return;
      }
      setSelected(null);
      onMove(options[0]);
      return;
    }
    setSelected(movableSquares.has(square) && square !== selected ? square : null);
  };

  const completePromotion = (pick: number) => {
    if (pendingPremove) {
      const { from, to } = pendingPremove;
      setPendingPremove(null);
      setSelected(null);
      onPremove?.({ from, to, promotion: pick });
      return;
    }
    const move = pendingPromotion?.find((m) => promotionOf(m) === pick);
    setPendingPromotion(null);
    if (!move) return;
    setSelected(null);
    onMove(move);
  };
  const cancelPromotion = () => {
    setPendingPromotion(null);
    setPendingPremove(null);
    setSelected(null);
  };

  const rows = [];
  for (let dy = SIZE - 1; dy >= 0; dy--) {
    const cells = [];
    for (let dx = 0; dx < SIZE; dx++) {
      const [file, rank] = fromDisplay(dx, dy, viewSeat);
      const square = index(file, rank);
      if (!VALID[square]) {
        cells.push(<View key={dx} style={{ width: size, height: size }} />);
        continue;
      }
      const code = state.cells[square];
      const target = targetMoves.get(square);
      cells.push(
        <Cell
          key={dx}
          square={square}
          size={size}
          background={(fileOf(square) + rankOf(square)) % 2 === 1 ? theme.lightColor : theme.darkColor}
          code={code}
          dead={code > 0 && state.status[seatOf(code)] !== 'active'}
          selected={selected === square}
          target={target ? (target[0].captured ? 2 : 1) : 0}
          last={!!lastMove && (lastMove.from === square || lastMove.to === square)}
          premoveMark={!!premove && (premove.from === square || premove.to === square)}
          checked={checkedSquares.has(square)}
          images={pieceTheme.images}
          onPress={handlePress}
        />
      );
    }
    rows.push(
      <View key={dy} style={styles.row}>
        {cells}
      </View>
    );
  }

  // Annotations are stored as squares and drawn through the CURRENT rotation.
  const gridArrows = arrows.map((a) => ({ from: squareToGrid(a.from, viewSeat), to: squareToGrid(a.to, viewSeat) }));
  const gridHighlights = highlights.map((s) => squareToGrid(s, viewSeat));

  const pickerSeat: Seat = pendingPremove && premoveSeat !== undefined ? premoveSeat : pendingPromotion ? seatOf(state.cells[pendingPromotion[0].from]) : state.turn;
  const pickerSize = Math.max(48, size * 1.8);
  return (
    <View
      ref={containerRef}
      onLayout={onLayout}
      accessibilityLabel="4 Player Chess board"
      style={[styles.board, { width: size * SIZE }]}
      {...panHandlers}
    >
      {rows}
      {enableAnnotations && (
        <BoardAnnotations
          squareSize={size}
          rows={SIZE}
          cols={SIZE}
          scale={Math.min(1, size / 40)}
          arrows={gridArrows}
          highlights={gridHighlights}
          liveArrow={liveArrow}
        />
      )}
      <PromotionPicker
        visible={pendingPromotion !== null || pendingPremove !== null}
        choices={PROMOTABLE_TYPES}
        buttonSize={pickerSize}
        labelFor={(choice) => PROMOTION_NAMES[choice]}
        renderChoice={(choice) => <PieceArt seat={pickerSeat} type={choice} size={pickerSize} dead={false} images={pieceTheme.images} />}
        onChoose={completePromotion}
        onCancel={cancelPromotion}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    textAlign: 'center',
    // A thin dark outline keeps yellow and red readable on both square colours.
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 2,
  },
  dead: {
    opacity: 0.6,
  },
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  promotedBar: {
    position: 'absolute',
    height: 2,
    borderRadius: 1,
    backgroundColor: '#fff',
  },
  promoted: {
    textDecorationLine: 'underline',
  },
  dot: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.35)',
  },
});
