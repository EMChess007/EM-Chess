import { StyleSheet, View } from 'react-native';
import type { BoardSquare } from '../types/chess';
import type { PieceImageMap } from '../types/theme';
import Piece from './Piece';

interface SquareProps {
  data: BoardSquare;
  isLight: boolean;
  isSelected: boolean;
  isLegalTarget: boolean;
  /** True only for the square holding the king currently in check (or checkmated) — see
   * ChessBoard's checkedKingSquare. Takes priority over `isSelected` when both apply (e.g. you
   * click your own checked king to see its escape squares), since check is the more urgent fact. */
  isChecked: boolean;
  /** True for the two squares (origin + destination) of the last move played — see
   * ChessBoard.tsx. Lower priority than isSelected/isChecked when a square happens to be both. */
  isLastMove: boolean;
  /** Hides this square's piece glyph — used only for the destination square while ChessBoard's
   * slide animation is carrying the moving piece in, so it doesn't already show up here the
   * instant the move lands, underneath the incoming sprite. */
  hidePiece?: boolean;
  size: number;
  /** The active board theme's colors and the active piece theme's images — see ChessBoard.tsx. */
  lightColor: string;
  darkColor: string;
  pieceImages?: PieceImageMap;
}

// Purely presentational — ChessBoard's own PanResponder (on the board container) handles every
// tap/long-press/drag across the whole grid, so this never needs its own touch handling.
export default function Square({
  data,
  isLight,
  isSelected,
  isLegalTarget,
  isChecked,
  isLastMove,
  hidePiece,
  size,
  lightColor,
  darkColor,
  pieceImages,
}: SquareProps) {
  return (
    <View
      style={[
        styles.square,
        { width: size, height: size, backgroundColor: isLight ? lightColor : darkColor },
        isLastMove && styles.lastMove,
        isSelected && styles.selected,
        isChecked && styles.checked,
      ]}
    >
      {isLegalTarget && <View style={styles.legalDot} />}
      {data.piece && !hidePiece && <Piece piece={data.piece} images={pieceImages} />}
    </View>
  );
}

const styles = StyleSheet.create({
  square: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastMove: {
    backgroundColor: '#f7ec74',
  },
  selected: {
    backgroundColor: '#a2d149',
  },
  checked: {
    backgroundColor: '#ef5350',
  },
  legalDot: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
});
