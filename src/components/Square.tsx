import { Pressable, StyleSheet } from 'react-native';
import type { BoardSquare } from '../types/chess';
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
  size: number;
  onPress: (square: string) => void;
}

export default function Square({ data, isLight, isSelected, isLegalTarget, isChecked, size, onPress }: SquareProps) {
  return (
    <Pressable
      onPress={() => onPress(data.square)}
      style={[
        styles.square,
        { width: size, height: size, backgroundColor: isLight ? '#f0d9b5' : '#b58863' },
        isSelected && styles.selected,
        isChecked && styles.checked,
      ]}
    >
      {isLegalTarget && <Pressable style={styles.legalDot} onPress={() => onPress(data.square)} />}
      {data.piece && <Piece piece={data.piece} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  square: {
    alignItems: 'center',
    justifyContent: 'center',
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
