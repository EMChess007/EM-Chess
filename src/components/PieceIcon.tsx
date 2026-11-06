import { memo } from 'react';
import Svg, { Path } from 'react-native-svg';
import { PIECE_PATHS, piecePathPaint, type PieceInk, type PieceShapeType } from './pieceArt';

interface PieceIconProps {
  type: PieceShapeType;
  ink: PieceInk;
  /** The pixel size of the (square) icon. */
  size: number;
  /** Faded (an eliminated seat's piece): drawn at this opacity. */
  opacity?: number;
}

/**
 * One chess piece, drawn: the fill and the outline are the ones given (pieceArt.ts), on every platform and whatever fonts the phone has. Board art: it is sized from its cell and
 * never follows the system font scale. `memo`: a board draws up to 32 of them and re-renders every clock tick.
 *
 * Every paint property is explicit (`piecePathPaint`: fill, fill opacity, fill rule, stroke, stroke opacity, width, join, cap) and so are the SVG's own `color` (nothing reads `currentColor`)
 * and `opacity` (1 unless a faded seat says otherwise). The icon knows nothing about the square it stands on: there is no input it could derive a colour from (command #27d).
 */
function PieceIcon({ type, ink, size, opacity }: PieceIconProps) {
  const paint = piecePathPaint(ink);
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" color={ink.fill} opacity={opacity ?? 1} pointerEvents="none">
      {PIECE_PATHS[type].map((d) => (
        <Path key={d} d={d} {...paint} />
      ))}
    </Svg>
  );
}

export default memo(PieceIcon);
