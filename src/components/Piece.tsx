import { StyleSheet, Text } from 'react-native';
import type { Piece as PieceModel } from '../types/chess';

const PIECE_SYMBOLS: Record<string, string> = {
  wp: '♙',
  wn: '♘',
  wb: '♗',
  wr: '♖',
  wq: '♕',
  wk: '♔',
  bp: '♟',
  bn: '♞',
  bb: '♝',
  br: '♜',
  bq: '♛',
  bk: '♚',
};

interface PieceProps {
  piece: PieceModel;
}

export default function Piece({ piece }: PieceProps) {
  const symbol = PIECE_SYMBOLS[`${piece.color}${piece.type}`];
  return <Text style={styles.piece}>{symbol}</Text>;
}

const styles = StyleSheet.create({
  piece: {
    fontSize: 32,
    textAlign: 'center',
  },
});
