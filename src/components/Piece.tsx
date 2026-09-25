import { Image, StyleSheet, Text } from 'react-native';
import type { Piece as PieceModel } from '../types/chess';
import type { PieceImageMap } from '../types/theme';

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
  /** The active piece theme's images, if any — see ChessBoard.tsx/useActivePieceTheme. Undefined
   * for the built-in theme, which keeps rendering the Unicode glyphs above exactly as before. */
  images?: PieceImageMap;
}

export default function Piece({ piece, images }: PieceProps) {
  const key = `${piece.color}${piece.type}`;
  const imageUri = images?.[key];
  if (imageUri) {
    return <Image source={{ uri: imageUri }} style={styles.pieceImage} resizeMode="contain" />;
  }
  return <Text style={styles.piece}>{PIECE_SYMBOLS[key]}</Text>;
}

const styles = StyleSheet.create({
  piece: {
    fontSize: 32,
    textAlign: 'center',
  },
  pieceImage: {
    width: '85%',
    height: '85%',
  },
});
