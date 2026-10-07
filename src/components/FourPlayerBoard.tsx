import { memo, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useActiveBoardTheme, useActivePieceTheme } from '../logic/themeHooks';
import type { PieceImageMap } from '../types/theme';
import PromotionPicker from './PromotionPicker';
import {
  PROMOTABLE_TYPES,
  SEAT_COLORS,
  SEAT_NAMES,
  SIZE,
  VALID,
  currentMoves,
  fileOf,
  fromDisplay,
  getFourPlayerCellSize,
  index,
  isInCheck,
  isPromotedType,
  promotionOf,
  rankOf,
  seatOf,
  seatPieceImageKey,
  squareName,
  typeOf,
  type FourPlayerState,
  type Move,
  type Seat,
} from '../logic/fourPlayer';

/** Filled glyphs for every seat (the outlined set is unreadable once tinted); colour identifies the seat. Promoted types draw as the piece they became. */
const GLYPHS = ['', '♟', '♞', '♝', '♜', '♛', '♚', '♛', '♞', '♝', '♜'];
const TYPE_NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king', 'promoted queen', 'promoted knight', 'promoted bishop', 'promoted rook'];
const DEAD_COLOR = '#8f8f8f';

interface FourPlayerBoardProps {
  state: FourPlayerState;
  /** The seat drawn at the bottom of the screen. */
  viewSeat: Seat;
  /** Whether a human may move right now (false while a bot is thinking, after the game, etc.). */
  interactive: boolean;
  /** The last move played (any seat), highlighted. */
  lastMove: { from: number; to: number } | null;
  onMove: (move: Move) => void;
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
  checked: boolean;
  images: PieceImageMap | undefined;
  onPress: (square: number) => void;
}

const Cell = memo(function Cell({ square, size, background, code, dead, selected, target, last, checked, images, onPress }: CellProps) {
  const seat: Seat = code > 0 ? seatOf(code) : 0;
  const type = code > 0 ? typeOf(code) : 0;
  const bg = checked ? '#ef5350' : selected ? '#a2d149' : last ? '#f7ec74' : background;
  const label =
    code > 0 ? `${squareName(square)}, ${dead ? 'eliminated ' : ''}${SEAT_NAMES[seat]} ${TYPE_NAMES[type]}${target ? ', can move here' : ''}` : `${squareName(square)}${target ? ', can move here' : ''}`;
  return (
    <Pressable onPress={() => onPress(square)} accessibilityLabel={label} style={[{ width: size, height: size, backgroundColor: bg }, styles.cell]}>
      {code > 0 && <PieceArt seat={seat} type={type} size={size} dead={dead} images={images} />}
      {target === 1 && <View style={[styles.dot, { width: size * 0.32, height: size * 0.32, borderRadius: size * 0.16 }]} />}
      {target === 2 && <View style={[styles.ring, { width: size * 0.9, height: size * 0.9, borderRadius: size * 0.45 }]} />}
    </Pressable>
  );
});

const PROMOTION_NAMES: Record<number, string> = { 5: 'Queen', 4: 'Rook', 3: 'Bishop', 2: 'Knight' };

/**
 * The 4 Player Chess board: the 14 x 14 grid with its four 3 x 3 corners left empty. The board is drawn rotated so that `viewSeat`
 * is at the bottom (a rendering transform only — the engine never rotates anything; pieces stay upright). Tap one of the mover's
 * pieces to see its legal squares, tap a square to move. A pawn reaching its last line asks which piece to become (the shared
 * `PromotionPicker`, drawn in the mover's seat colour), so a human move is a from → to plus, for a promotion, that choice. Pieces use
 * the active piece theme.
 */
export default function FourPlayerBoard({ state, viewSeat, interactive, lastMove, onMove }: FourPlayerBoardProps) {
  const { width, height } = useWindowDimensions();
  const theme = useActiveBoardTheme();
  const pieceTheme = useActivePieceTheme();
  const size = getFourPlayerCellSize(width, height);
  const [selected, setSelected] = useState<number | null>(null);
  /** The four promotion moves of a tapped promotion square, while the player is choosing. */
  const [pendingPromotion, setPendingPromotion] = useState<Move[] | null>(null);

  const moves = useMemo(() => (interactive ? currentMoves(state) : []), [state, interactive]);
  // Selection (and a half-made promotion) never survives the position changing under it.
  useEffect(() => {
    setSelected(null);
    setPendingPromotion(null);
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

  const handlePress = (square: number) => {
    if (!interactive || pendingPromotion) return;
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
    const move = pendingPromotion?.find((m) => promotionOf(m) === pick);
    setPendingPromotion(null);
    if (!move) return;
    setSelected(null);
    onMove(move);
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

  const pickerSeat: Seat = pendingPromotion ? seatOf(state.cells[pendingPromotion[0].from]) : state.turn;
  return (
    <View accessibilityLabel="4 Player Chess board" style={[styles.board, { width: size * SIZE }]}>
      {rows}
      <PromotionPicker
        visible={pendingPromotion !== null}
        choices={PROMOTABLE_TYPES}
        buttonSize={Math.max(48, size * 1.8)}
        labelFor={(choice) => PROMOTION_NAMES[choice]}
        renderChoice={(choice) => <PieceArt seat={pickerSeat} type={choice} size={Math.max(48, size * 1.8)} dead={false} images={pieceTheme.images} />}
        onChoose={completePromotion}
        onCancel={() => setPendingPromotion(null)}
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
