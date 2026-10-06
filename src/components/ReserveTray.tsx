import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RESERVE_PIECE_TYPES, reserveTotal, type CrazyhouseState, type ReservePieceType } from '../logic/crazyhouse';
import type { PieceColor } from '../types/chess';

/** The tray's fixed height. The row never wraps and never changes height, so the layout around the board is deterministic —
 * GameScreenBody's `compact` spacing is sized against exactly this much extra chrome (same reasoning as the Spell Chess row). */
export const RESERVE_TRAY_HEIGHT = 32;
export const RESERVE_TRAY_MARGIN_TOP = 8;
/** The smallest the row is scaled to when both reserves are full (a chip is then ~21 px wide: small, but this is the extreme of five piece types held by BOTH sides). */
export const MIN_SCALE = 0.6;

// Filled glyphs for both colours (the outlined "white" set is unreadable at small sizes); colour does the rest.
const GLYPHS: Record<ReservePieceType, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' };
const PIECE_NAMES: Record<ReservePieceType, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' };

interface ReserveTrayProps {
  state: CrazyhouseState;
  /** Whose turn it is — only THEIR chips can be tapped (and only when `interactive`). */
  turn: PieceColor;
  /** False while the board is disabled (the opponent's turn, a finished game, reviewing history). */
  interactive: boolean;
  /** The piece currently picked up to drop, if any. */
  selected: ReservePieceType | null;
  /** Whether the side to move has any legal square for this piece right now (false greys the chip out). */
  canDrop: (piece: ReservePieceType) => boolean;
  onSelect: (piece: ReservePieceType) => void;
  /** The width the row may use (at least the board's, up to the screen's gutters): the row is exactly this wide and scales its
   * content down to fit. */
  width: number;
}

/**
 * Both players' reserves ("banks") in ONE fixed-height row under the board: White's pieces on the left, Black's on the right,
 * a chip per piece type that has any, with its count. The side to move taps a chip to pick that piece up, then taps a
 * highlighted square to drop it (see ChessBoard). Pieces captured by a side go into ITS OWN reserve — shown here in the
 * colour of the side that will drop them.
 */
export default function ReserveTray({ state, turn, interactive, selected, canDrop, onSelect, width }: ReserveTrayProps) {
  const empty = reserveTotal(state.reserve.w) + reserveTotal(state.reserve.b) === 0;
  // The row never wraps (fixed height), so with many piece types on both sides its natural width can exceed the board's. It is
  // given exactly the board's width, measures its own content, and scales that down to fit (never up, never below MIN_SCALE).
  const [natural, setNatural] = useState(0);
  const scale = natural > width && width > 0 ? Math.max(MIN_SCALE, width / natural) : 1;
  return (
    <View style={[styles.row, { width }]} accessibilityLabel="Reserves">
      {empty ? (
        <Text style={styles.empty}>Reserves are empty — captured pieces appear here</Text>
      ) : (
        <View style={[styles.content, { transform: [{ scale }] }]} onLayout={(e) => setNatural(e.nativeEvent.layout.width)}>
          {(['w', 'b'] as const).map((color, index) => (
            <View key={color} style={[styles.group, index === 1 && styles.groupSecond]}>
              {RESERVE_PIECE_TYPES.filter((piece) => state.reserve[color][piece] > 0)
                .slice()
                .reverse()
                .map((piece) => {
                  const mine = color === turn;
                  const usable = interactive && mine && canDrop(piece);
                  const isSelected = mine && selected === piece;
                  return (
                    <Pressable
                      key={piece}
                      disabled={!usable}
                      onPress={() => onSelect(piece)}
                      style={[styles.chip, isSelected && styles.chipSelected, mine && interactive && !usable && styles.chipUnavailable]}
                      accessibilityRole="button"
                      accessibilityLabel={`${color === 'w' ? 'White' : 'Black'} reserve: ${state.reserve[color][piece]} ${PIECE_NAMES[piece]}${state.reserve[color][piece] === 1 ? '' : 's'}${usable ? ', tap to drop' : ''}`}
                    >
                      <Text style={[styles.glyph, color === 'w' ? styles.glyphWhite : styles.glyphBlack]}>{GLYPHS[piece]}</Text>
                      <Text style={styles.count}>{state.reserve[color][piece]}</Text>
                    </Pressable>
                  );
                })}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginTop: RESERVE_TRAY_MARGIN_TOP,
    height: RESERVE_TRAY_HEIGHT,
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  groupSecond: {
    paddingLeft: 10,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(0,0,0,0.25)',
  },
  chip: {
    height: RESERVE_TRAY_HEIGHT,
    minWidth: 30,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: 8,
    backgroundColor: '#b58863',
    borderWidth: 1,
    borderColor: '#8a6d3b',
  },
  chipSelected: {
    backgroundColor: '#a2d149',
    borderColor: '#5a7a1a',
  },
  chipUnavailable: {
    opacity: 0.45,
  },
  glyph: {
    fontSize: 18,
    lineHeight: 22,
  },
  glyphWhite: {
    color: '#ffffff',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 2,
  },
  glyphBlack: {
    color: '#1b130c',
  },
  count: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2a1d10',
  },
  empty: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#7a6a58',
  },
});
