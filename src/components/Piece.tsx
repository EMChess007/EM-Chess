import { Image, StyleSheet, View } from 'react-native';
import type { Piece as PieceModel } from '../types/chess';
import type { PieceImageMap } from '../types/theme';
import { knightmateShape } from '../logic/knightmateGame';
import KnightmateBadge from './KnightmateBadge';
import { pieceInk, type PieceShapeType } from './pieceArt';
import { pieceImageSource } from './pieceImageSource';
import PieceIcon from './PieceIcon';

interface PieceProps {
  piece: PieceModel;
  /** The active piece theme's images, if any — see ChessBoard.tsx/useActivePieceTheme. Undefined
   * for the built-in theme, which draws the vector pieces of pieceArt.ts. */
  images?: PieceImageMap;
  /** The cell the piece sits in, in dp. Without it the piece is 36 dp (the promotion picker's buttons, a captured-piece tray). */
  size?: number;
  /** Knightmate only (knightmate.ts): Piece.type 'k' is the ROYAL KNIGHT and 'm' the COMMONER. Both are drawn from the theme's own images (the knight, the king)
   * with a small badge over the corner (KnightmateBadge: a crown / an "M"), so every piece theme, a custom one included, shows them distinctly. */
  knightmate?: boolean;
}

/** react-native-web renders `dataSet` as data-* attributes (a phone ignores it): a test or the device matrix reads the kind and colour of a piece from `data-piece`. */
const pieceData = (key: string) => ({ dataSet: { piece: key } }) as object;

/**
 * A piece is board art, sized from its CELL, never from the font scale. The built-in theme draws it as a vector (PieceIcon) with the exact fill and outline of its colour
 * (pieceArt.ts): it used to be a Unicode chess glyph, and on a real phone the glyph came from a fallback font that drew the black king white (command #27b).
 */
export default function Piece({ piece, images, size, knightmate = false }: PieceProps) {
  const shape: PieceShapeType = knightmate ? knightmateShape(piece.type) : (piece.type as PieceShapeType);
  const key = `${piece.color}${piece.type}`;
  const imageUri = images?.[`${piece.color}${shape}`];
  const label = `${piece.color === 'w' ? 'white' : 'black'} ${knightmate ? KNIGHTMATE_WORDS[piece.type] ?? PIECE_WORDS[shape] : PIECE_WORDS[shape]}`;
  const badge = knightmate && (piece.type === 'k' || piece.type === 'm') ? <KnightmateBadge kind={piece.type === 'k' ? 'royal' : 'commoner'} /> : null;
  if (imageUri) {
    // An image theme's piece carries the same marker and label as a vector one (command #27c): the device matrix photographs a piece by its marker, and before this an image-themed board had
    // none, so no check ever looked at the pixels of Cburnett / Merida / Chess with Checkers.
    // The marker sits on a wrapper (react-native-web's Image does not forward `dataSet`): the wrapper is the old 85 % box and the image fills it, so the picture is where it always was.
    return (
      <View style={styles.pieceImage} accessibilityRole="image" accessibilityLabel={label} {...pieceData(key)}>
        <Image source={pieceImageSource(imageUri)} style={styles.pieceImageFill} resizeMode="contain" />
        {badge}
      </View>
    );
  }
  const side = size === undefined ? 36 : Math.floor(size * 0.9);
  return (
    <View style={{ width: side, height: side }} accessibilityRole="image" accessibilityLabel={label} {...pieceData(key)}>
      <PieceIcon type={shape} ink={pieceInk(piece.color)} size={side} />
      {badge}
    </View>
  );
}

const PIECE_WORDS = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' } as const;
const KNIGHTMATE_WORDS: Partial<Record<PieceModel['type'], string>> = { k: 'royal knight', m: 'commoner' };

const styles = StyleSheet.create({
  pieceImage: {
    width: '85%',
    height: '85%',
  },
  pieceImageFill: {
    width: '100%',
    height: '100%',
  },
});
