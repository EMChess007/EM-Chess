import { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useActiveBoardTheme } from '../logic/themeHooks';
import {
  PROMOTED_QUEEN,
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
  rankOf,
  seatOf,
  squareName,
  typeOf,
  type FourPlayerState,
  type Move,
  type Seat,
} from '../logic/fourPlayer';

/** Filled glyphs for every seat (the outlined set is unreadable once tinted); colour identifies the seat. */
const GLYPHS = ['', '♟', '♞', '♝', '♜', '♛', '♚', '♛'];
const TYPE_NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king', 'promoted queen'];
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
  onPress: (square: number) => void;
}

const Cell = memo(function Cell({ square, size, background, code, dead, selected, target, last, checked, onPress }: CellProps) {
  const seat: Seat = code > 0 ? seatOf(code) : 0;
  const type = code > 0 ? typeOf(code) : 0;
  const bg = checked ? '#ef5350' : selected ? '#a2d149' : last ? '#f7ec74' : background;
  const label =
    code > 0 ? `${squareName(square)}, ${dead ? 'eliminated ' : ''}${SEAT_NAMES[seat]} ${TYPE_NAMES[type]}${target ? ', can move here' : ''}` : `${squareName(square)}${target ? ', can move here' : ''}`;
  return (
    <Pressable onPress={() => onPress(square)} accessibilityLabel={label} style={[{ width: size, height: size, backgroundColor: bg }, styles.cell]}>
      {code > 0 && (
        <Text
          style={[
            styles.glyph,
            { fontSize: size * 0.78, lineHeight: size, color: dead ? DEAD_COLOR : SEAT_COLORS[seat] },
            dead && styles.dead,
            type === PROMOTED_QUEEN && styles.promoted,
          ]}
        >
          {GLYPHS[type]}
        </Text>
      )}
      {target === 1 && <View style={[styles.dot, { width: size * 0.32, height: size * 0.32, borderRadius: size * 0.16 }]} />}
      {target === 2 && <View style={[styles.ring, { width: size * 0.9, height: size * 0.9, borderRadius: size * 0.45 }]} />}
    </Pressable>
  );
});

/**
 * The 4 Player Chess board: the 14 x 14 grid with its four 3 x 3 corners left empty. The board is drawn rotated so that `viewSeat`
 * is at the bottom (a rendering transform only — the engine never rotates anything; pieces stay upright). Tap one of the mover's
 * pieces to see its legal squares, tap a square to move. Promotion is automatic (always a queen), so a move is just from → to.
 */
export default function FourPlayerBoard({ state, viewSeat, interactive, lastMove, onMove }: FourPlayerBoardProps) {
  const { width, height } = useWindowDimensions();
  const theme = useActiveBoardTheme();
  const size = getFourPlayerCellSize(width, height);
  const [selected, setSelected] = useState<number | null>(null);

  const moves = useMemo(() => (interactive ? currentMoves(state) : []), [state, interactive]);
  // Selection never survives the position changing under it.
  useEffect(() => setSelected(null), [state]);

  const targetMoves = useMemo(() => {
    const map = new Map<number, Move>();
    if (selected !== null) for (const move of moves) if (move.from === selected) map.set(move.to, move);
    return map;
  }, [moves, selected]);
  const movableSquares = useMemo(() => new Set(moves.map((m) => m.from)), [moves]);

  const checkedSquares = useMemo(() => {
    const squares = new Set<number>();
    for (const seat of [0, 1, 2, 3] as Seat[]) if (state.status[seat] === 'active' && isInCheck(state, seat)) squares.add(state.kings[seat]);
    return squares;
  }, [state]);

  const handlePress = (square: number) => {
    if (!interactive) return;
    const move = targetMoves.get(square);
    if (move) {
      setSelected(null);
      onMove(move);
      return;
    }
    setSelected(movableSquares.has(square) && square !== selected ? square : null);
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
          target={target ? (target.captured ? 2 : 1) : 0}
          last={!!lastMove && (lastMove.from === square || lastMove.to === square)}
          checked={checkedSquares.has(square)}
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

  return (
    <View accessibilityLabel="4 Player Chess board" style={[styles.board, { width: size * SIZE }]}>
      {rows}
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
