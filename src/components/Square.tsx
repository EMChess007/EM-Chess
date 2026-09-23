import { Pressable, StyleSheet } from 'react-native';
import type { BoardSquare } from '../types/chess';
import Piece from './Piece';

interface SquareProps {
  data: BoardSquare;
  isLight: boolean;
  isSelected: boolean;
  isLegalTarget: boolean;
  size: number;
  onPress: (square: string) => void;
}

export default function Square({ data, isLight, isSelected, isLegalTarget, size, onPress }: SquareProps) {
  return (
    <Pressable
      onPress={() => onPress(data.square)}
      style={[
        styles.square,
        { width: size, height: size, backgroundColor: isLight ? '#f0d9b5' : '#b58863' },
        isSelected && styles.selected,
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
  legalDot: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
});
