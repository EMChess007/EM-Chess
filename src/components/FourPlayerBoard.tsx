import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from './AppText';
import { CAPTURER_OUTLINE_COLOR, CAPTURER_RING_COLOR, fourPlayerCapturingSquares } from '../logic/giveawayHints';
import { checkedKingSquares } from '../logic/fourPlayerVariant';
import { useActiveBoardTheme, useActivePieceTheme } from '../logic/themeHooks';
import type { PieceImageMap } from '../types/theme';
import BoardAnnotations from './BoardAnnotations';
import BoatIcon from './BoatIcon';
import type { PieceShapeType } from './pieceArt';
import PieceIcon from './PieceIcon';
import PromotionPicker from './PromotionPicker';
import { useBoardGestures } from './useBoardGestures';
import { useClearAnnotationsOnMove } from './useClearAnnotationsOnMove';
import {
  PROMOTABLE_TYPES,
  PROMOTED_ROOK,
  ROOK,
  SEAT_COLORS,
  SEAT_NAMES,
  SEAT_PIECE_SET,
  addArrow,
  canPremove,
  currentMoves,
  geometryOf,
  getBoardCellSize,
  gridToSquare,
  isPromotedType,
  isPromotionPremove,
  onlyPromotionType,
  positionEpoch,
  promotionOf,
  seatOf,
  seatPieceImageKey,
  squareToGrid,
  toggleHighlight,
  typeOf,
  variantOfRules,
  type FourPlayerPremove,
  type FourPlayerState,
  type Move,
  type Seat,
  type SquareArrow,
} from '../logic/fourPlayer';

/** The shape of every piece type (1 pawn .. 6 king; 7..10 the promoted queen / knight / bishop / rook, drawn as the piece they became); the seat's colour is the fill. */
const SHAPE_OF_TYPE: readonly PieceShapeType[] = ['p', 'p', 'n', 'b', 'r', 'q', 'k', 'q', 'n', 'b', 'r'];
/** A thin dark outline keeps yellow and red readable on both square colours. */
const SEAT_PIECE_OUTLINE = 'rgba(0,0,0,0.85)';
/** react-native-web renders `dataSet` as data-* attributes (a phone ignores it): the matrix and the tests read which piece and which seat a drawn piece is. */
const seatPieceData = (seat: Seat, type: number) => ({ dataSet: { seatPiece: `${seat}:${SHAPE_OF_TYPE[type]}` } }) as object;
const TYPE_NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king', 'promoted queen', 'promoted knight', 'promoted bishop', 'promoted rook'];
const DEAD_COLOR = '#8f8f8f';
const PREMOVE_COLOR = '#8ec5ff';

interface FourPlayerBoardProps {
  state: FourPlayerState;
  /** The seat drawn at the bottom of the screen. */
  viewSeat: Seat;
  /** Whether a human may move right now (false while a bot is thinking, after the game, etc.). */
  interactive: boolean;
  /** The last move played (any seat), highlighted. `promoted`: it was a promotion (Chaturaji's is automatic, so the board announces it). */
  lastMove: { from: number; to: number; promoted?: boolean } | null;
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
  /** 4 Player Giveaway only - the player tapped one of their own pieces that cannot move because a capture is mandatory (the pieces that CAN capture are
   * ringed). The screen answers with the "A capture is mandatory" message (MandatoryCaptureBanner / useCaptureNudge). */
  onMandatoryCaptureBlocked?: () => void;
}

interface PieceArtProps {
  seat: Seat;
  type: number;
  size: number;
  dead: boolean;
  /** The active piece theme's images (undefined for the built-in Classic theme, which keeps the tinted glyphs). */
  images: PieceImageMap | undefined;
  /** Chaturaji: this rook is a BOAT and is drawn as one (BoatIcon), on every theme. */
  boat?: boolean;
}

/**
 * One piece, in the active piece theme. Themes only draw white and black pieces, so a themed piece is the theme's own artwork on a disc
 * in the seat's colour (see `seatPieceImageKey`); the built-in Classic theme keeps its tinted glyphs. An eliminated seat's pieces are
 * grey and faded; a promoted piece carries a small bar (an underline for a glyph).
 */
const PieceArt = memo(function PieceArt({ seat, type, size, dead, images, boat = false }: PieceArtProps) {
  const imageUri = images?.[seatPieceImageKey(seat, type)];
  const promoted = isPromotedType(type);
  if (boat) {
    // A boat on a themed board sits on the seat's disc like every other piece (white boat on the dark seats, black on Yellow's); on the glyph theme it is drawn in the seat's colour.
    const light = SEAT_PIECE_SET[seat] === 'w';
    return images ? (
      <View
        testID="boat"
        style={[styles.disc, { width: size * 0.96, height: size * 0.96, borderRadius: size * 0.48, backgroundColor: dead ? DEAD_COLOR : SEAT_COLORS[seat] }, dead && styles.dead]}
      >
        <BoatIcon size={size * 0.8} color={light ? '#ffffff' : '#111111'} outline={light ? '#1b1b1b' : '#000000'} />
        {promoted && <View style={[styles.promotedBar, { width: size * 0.4, bottom: size * 0.05 }]} />}
      </View>
    ) : (
      <View testID="boat" style={[styles.disc, { width: size, height: size }, dead && styles.dead]} {...seatPieceData(seat, type)}>
        <BoatIcon size={size * 0.9} color={dead ? DEAD_COLOR : SEAT_COLORS[seat]} outline="rgba(0,0,0,0.85)" />
        {promoted && <View style={[styles.promotedBar, { width: size * 0.4, bottom: size * 0.04 }]} />}
      </View>
    );
  }
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
  // The seat's colour as a vector piece (pieceArt.ts): a font glyph took its look from whatever font the phone fell back to (command #27b, the black king drawn white).
  return (
    <View style={[styles.disc, { width: size, height: size }, dead && styles.dead]} {...seatPieceData(seat, type)}>
      <PieceIcon type={SHAPE_OF_TYPE[type]} ink={{ fill: dead ? DEAD_COLOR : SEAT_COLORS[seat], outline: SEAT_PIECE_OUTLINE }} size={Math.floor(size * 0.92)} />
      {promoted && <View style={[styles.promotedBar, { width: size * 0.4, bottom: size * 0.04 }]} />}
    </View>
  );
});

/** A ring that grows and fades once over the square a pawn has just become a boat on (Chaturaji promotes automatically, so this is what tells the player it happened). */
const PromotionBurst = memo(function PromotionBurst({ size }: { size: number }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 800, useNativeDriver: false }).start();
  }, [progress]);
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.45] });
  const opacity = progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.8, 0] });
  return <Animated.View testID="promotion-burst" pointerEvents="none" style={[styles.burst, { width: size, height: size, borderRadius: size / 2, opacity, transform: [{ scale }] }]} />;
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
  /** Giveaway: this piece can capture while a capture is mandatory - ringed in amber. */
  capturer: boolean;
  last: boolean;
  /** One of the two squares of the queued premove. */
  premoveMark: boolean;
  checked: boolean;
  /** Chaturaji: the king on this square is attacked - an amber ring (a threat, never a red "check" that must be answered). */
  attacked: boolean;
  /** Chaturaji: this rook is a boat. */
  boat: boolean;
  /** Chaturaji: a pawn just became a boat here - a marker that pulses once. */
  promoted: boolean;
  /** The square's name on THIS game's board ("e4"; the 8 x 8 board's names are not the cross board's). */
  squareLabel: string;
  images: PieceImageMap | undefined;
  /** Screen-reader activation only: touches are handled for the whole board by useBoardGestures. */
  onPress: (square: number) => void;
}

const Cell = memo(function Cell({ square, size, background, code, dead, selected, target, capturer, last, premoveMark, checked, attacked, boat, promoted, squareLabel, images, onPress }: CellProps) {
  const seat: Seat = code > 0 ? seatOf(code) : 0;
  const type = code > 0 ? typeOf(code) : 0;
  const bg = checked ? '#ef5350' : selected ? '#a2d149' : premoveMark ? PREMOVE_COLOR : last ? '#f7ec74' : background;
  const label =
    code > 0
      ? `${squareLabel}, ${dead ? 'eliminated ' : ''}${SEAT_NAMES[seat]} ${boat ? 'boat' : TYPE_NAMES[type]}${attacked ? ', king attacked' : ''}${promoted ? ', just promoted' : ''}${target ? ', can move here' : ''}${capturer ? ', can capture (a capture is mandatory)' : ''}`
      : `${squareLabel}${target ? ', can move here' : ''}`;
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      onAccessibilityTap={() => onPress(square)}
      style={[{ width: size, height: size, backgroundColor: bg }, styles.cell]}
    >
      {capturer && <View pointerEvents="none" style={[styles.capturerOutline, { width: size - 1, height: size - 1, borderRadius: (size - 1) / 2 }]} />}
      {capturer && <View pointerEvents="none" style={[styles.capturerRing, { width: size - 4, height: size - 4, borderRadius: (size - 4) / 2 }]} />}
      {attacked && <View testID="king-attacked" pointerEvents="none" style={[styles.capturerOutline, { width: size - 1, height: size - 1, borderRadius: (size - 1) / 2 }]} />}
      {attacked && <View pointerEvents="none" style={[styles.capturerRing, { width: size - 4, height: size - 4, borderRadius: (size - 4) / 2 }]} />}
      {code > 0 && <PieceArt seat={seat} type={type} size={size} dead={dead} images={images} boat={boat} />}
      {promoted && <PromotionBurst size={size} />}
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
  onMandatoryCaptureBlocked,
}: FourPlayerBoardProps) {
  const { width, height } = useWindowDimensions();
  const theme = useActiveBoardTheme();
  const pieceTheme = useActivePieceTheme();
  // The board is the game's own: the 14 x 14 cross or Chaturaji's 8 x 8 square (read from the rules, which travel with the position).
  const geo = geometryOf(state.rules);
  const chaturaji = variantOfRules(state.rules) === 'chaturaji';
  const boardSize = geo.size;
  const size = getBoardCellSize(geo.id, width, height);
  const forcedPromotion = onlyPromotionType(state); // Chaturaji: a pawn always becomes a boat, so nobody is asked
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
    rows: boardSize,
    cols: boardSize,
    enableAnnotations,
    onTap: (cell) => {
      const square = gridToSquare(cell, viewSeat, geo);
      if (square !== null) handlePress(square);
    },
    onArrow: (from, to) => setArrows((prev) => addArrow(prev, gridToSquare(from, viewSeat, geo), gridToSquare(to, viewSeat, geo))),
    onHighlight: (cell) => setHighlights((prev) => toggleHighlight(prev, gridToSquare(cell, viewSeat, geo))),
  });
  // A new position wipes any half-made normal move. While premoving, a position change is just another seat having moved — with three of
  // them in a row it must not undo the player's own selection or an open promotion choice, so those survive as long as the piece they
  // refer to is still the player's own.
  useEffect(() => {
    setSelected((prev) => (prev !== null && premoveMode && isOwnPiece(prev) ? prev : null));
    setPendingPromotion(null);
    setPendingPremove((prev) => (prev !== null && premoveMode && isOwnPiece(prev.from) ? prev : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Arrows and highlights obey the app-wide invariant (logic/annotationLifecycle.ts): they are cleared when a MOVE is played and at no other
  // time — not when a turn starts or passes, and not when a seat is skipped, eliminated or flagged without a move. `state.ply` is this
  // mode's position epoch: it goes up in exactly one place (a move being applied, real or an eliminated king's walk), so turns that advance
  // without a move leave it, and the arrows, alone; Undo lowers it (the position is replaced), which also clears.
  useClearAnnotationsOnMove(positionEpoch(state), () => {
    setArrows([]);
    setHighlights([]);
    clearLiveArrow();
  });

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
  // 4 Player Giveaway: while a capture is mandatory for the player to move, the pieces that can capture are ringed (empty otherwise).
  const captureSquares = useMemo(() => (interactive ? new Set(fourPlayerCapturingSquares(state, state.turn)) : new Set<number>()), [state, interactive]);

  // Kings in check (never any in 4 Player Giveaway: there a king is an ordinary piece and nothing is ever "in check"). In Chaturaji the same squares are kings that are
  // ATTACKED: a threat, not a check that has to be answered, so they get the amber ring instead of the red "check" fill and nothing about them blocks a move.
  const checkedSquares = useMemo(() => new Set(checkedKingSquares(state)), [state]);

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
      if (forcedPromotion !== null) {
        onPremove({ from: selected, to: square, promotion: forcedPromotion }); // Chaturaji: it becomes a boat, nobody is asked
        setSelected(null);
        return;
      }
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
    // A capture is mandatory and this is one of the mover's own pieces that cannot capture: explain instead of doing nothing.
    if (captureSquares.size > 0 && !captureSquares.has(square) && state.cells[square] > 0 && seatOf(state.cells[square]) === state.turn) {
      setSelected(null);
      onMandatoryCaptureBlocked?.();
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
  for (let dy = boardSize - 1; dy >= 0; dy--) {
    const cells = [];
    for (let dx = 0; dx < boardSize; dx++) {
      const [file, rank] = geo.fromDisplay(dx, dy, viewSeat);
      const square = geo.index(file, rank);
      if (!geo.valid[square]) {
        cells.push(<View key={dx} style={{ width: size, height: size }} />);
        continue;
      }
      const code = state.cells[square];
      const target = targetMoves.get(square);
      const pieceType = code > 0 ? typeOf(code) : 0;
      cells.push(
        <Cell
          key={dx}
          square={square}
          size={size}
          background={(geo.fileOf(square) + geo.rankOf(square)) % 2 === 1 ? theme.lightColor : theme.darkColor}
          code={code}
          dead={code > 0 && state.status[seatOf(code)] !== 'active'}
          selected={selected === square}
          target={target ? (target[0].captured ? 2 : 1) : 0}
          capturer={captureSquares.has(square)}
          last={!!lastMove && (lastMove.from === square || lastMove.to === square)}
          premoveMark={!!premove && (premove.from === square || premove.to === square)}
          checked={!chaturaji && checkedSquares.has(square)}
          attacked={chaturaji && checkedSquares.has(square)}
          boat={chaturaji && (pieceType === ROOK || pieceType === PROMOTED_ROOK)}
          promoted={chaturaji && !!lastMove?.promoted && lastMove.to === square}
          squareLabel={geo.squareName(square)}
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
  const gridArrows = arrows.map((a) => ({ from: squareToGrid(a.from, viewSeat, geo), to: squareToGrid(a.to, viewSeat, geo) }));
  const gridHighlights = highlights.map((s) => squareToGrid(s, viewSeat, geo));

  const pickerSeat: Seat = pendingPremove && premoveSeat !== undefined ? premoveSeat : pendingPromotion ? seatOf(state.cells[pendingPromotion[0].from]) : state.turn;
  const pickerSize = Math.max(48, size * 1.8);
  return (
    <View
      ref={containerRef}
      onLayout={onLayout}
      accessibilityLabel={chaturaji ? 'Chaturaji board' : '4 Player Chess board'}
      style={[styles.board, { width: size * boardSize }]}
      {...panHandlers}
    >
      {rows}
      {enableAnnotations && (
        <BoardAnnotations
          squareSize={size}
          rows={boardSize}
          cols={boardSize}
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
  capturerOutline: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: CAPTURER_OUTLINE_COLOR,
  },
  capturerRing: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: CAPTURER_RING_COLOR,
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.35)',
  },
  burst: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: '#ffd54f',
  },
});
