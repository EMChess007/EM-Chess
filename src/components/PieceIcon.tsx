import { memo } from 'react';
import Svg, { Path } from 'react-native-svg';
import { PIECE_OUTLINE_WIDTH, PIECE_PATHS, type PieceInk, type PieceShapeType } from './pieceArt';

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
 */
function PieceIcon({ type, ink, size, opacity }: PieceIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" opacity={opacity} pointerEvents="none">
      {PIECE_PATHS[type].map((d) => (
        <Path key={d} d={d} fill={ink.fill} stroke={ink.outline} strokeWidth={PIECE_OUTLINE_WIDTH} strokeLinejoin="round" />
      ))}
    </Svg>
  );
}

export default memo(PieceIcon);
