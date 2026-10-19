import Svg, { Path } from 'react-native-svg';

interface BoatIconProps {
  /** The pixel size of the (square) icon. */
  size: number;
  /** The boat's colour: the seat's colour on the glyph theme, white / black on a disc (see `SEAT_PIECE_SET`). */
  color: string;
  /** The outline, which keeps a yellow or a red boat readable on both square colours. */
  outline: string;
}

/**
 * The Chaturaji BOAT (a rook that moves like one but is drawn as what it is called): a hull, a mast and a sail with a pennant. Original artwork drawn for this app as
 * three SVG paths - no font, emoji or third-party icon set, so it has no licence to carry, renders the same on every platform (react-native-svg, including the web build)
 * and tints to any seat colour. The silhouette is deliberately chunky (a wide hull and a tall triangular sail) so that it stays recognisable at the smallest cell size
 * the 8 x 8 board is ever drawn at (28 px), where a thin line drawing would blur into a rook.
 */
export default function BoatIcon({ size, color, outline }: BoatIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityRole="image">
      <Path d="M10 64 L90 64 L76 87 L24 87 Z" fill={color} stroke={outline} strokeWidth={5} strokeLinejoin="round" />
      <Path d="M47 12 L47 64" stroke={outline} strokeWidth={6} strokeLinecap="round" />
      <Path d="M52 20 L52 58 L84 58 Z" fill={color} stroke={outline} strokeWidth={5} strokeLinejoin="round" />
      <Path d="M47 12 L30 19 L47 26 Z" fill={color} stroke={outline} strokeWidth={4} strokeLinejoin="round" />
    </Svg>
  );
}
