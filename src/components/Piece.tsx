import { Image, StyleSheet } from 'react-native';
import { Text } from './AppText';
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
  /** The cell the piece sits in, in dp. Without it the glyph is 32 dp (the promotion picker's buttons, a captured-piece tray). */
  size?: number;
}

/** A glyph is board art, not text: it is sized from its CELL and never follows the system font scale (a piece at 2 x would not fit its square). */
export default function Piece({ piece, images, size }: PieceProps) {
  const key = `${piece.color}${piece.type}`;
  const imageUri = images?.[key];
  if (imageUri) {
    return <Image source={{ uri: imageUri }} style={styles.pieceImage} resizeMode="contain" />;
  }
  const sizing = size === undefined ? undefined : { fontSize: Math.floor(size * 0.72), lineHeight: size };
  return (
    <Text style={[styles.piece, sizing]} maxFontSizeMultiplier={1}>
      {PIECE_SYMBOLS[key]}
    </Text>
  );
}

const styles = StyleSheet.create({
  piece: {
    fontSize: 32,
    lineHeight: 40,
    textAlign: 'center',
  },
  pieceImage: {
    width: '85%',
    height: '85%',
  },
});
