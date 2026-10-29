import { Text, type TextProps } from 'react-native';

/**
 * How far text in the Bughouse bars, clocks, pockets and controls may grow with the system font scale (Android allows 2.0): the two-board layouts are sized to the pixel (BUGHOUSE_SPEC.md 5.6),
 * so a bar twice as tall would push a board off the window. 1.2 keeps the text readable and the cell table true; a caller's own `maxFontSizeMultiplier` wins.
 */
export const BUGHOUSE_MAX_FONT_SIZE_MULTIPLIER = 1.2;

export default function BughouseText({ maxFontSizeMultiplier, ...rest }: TextProps) {
  return <Text maxFontSizeMultiplier={maxFontSizeMultiplier ?? BUGHOUSE_MAX_FONT_SIZE_MULTIPLIER} {...rest} />;
}
