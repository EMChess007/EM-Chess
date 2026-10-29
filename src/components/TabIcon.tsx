import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

export type TabIconName = 'home' | 'puzzles' | 'analysis' | 'more';

interface TabIconProps {
  name: TabIconName;
  /** The ink: a theme colour token that has at least 3:1 against the tab bar's background in BOTH themes (pinned by tabIcons.test.ts and the Android device matrix). */
  color: string;
  size?: number;
}

/** Marks the glyph for the Android device matrix, which measures its contrast against the bar behind it (scripts/browser/android-matrix-checks.mjs, kind `contrast`). */
const matrixGlyph = { dataSet: { matrixGlyph: '1' } } as object;

/**
 * The tab bar's icons, drawn as vector paths in a theme colour. They used to be text glyphs (a black chess pawn, emoji): on Android the pawn is drawn by the emoji font in its own
 * fixed black, so in dark mode it was black on #121212 and almost invisible, and no text colour could fix it. A drawn icon has exactly the colour it is given, in every theme
 * and on every phone's fonts. Original artwork (four small outlines), no icon set to license.
 */
export default function TabIcon({ name, color, size = 24 }: TabIconProps) {
  const stroke = { stroke: color, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;
  return (
    <View {...matrixGlyph} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {name === 'home' && (
          <>
            <Path d="M3 11 L12 3 L21 11" {...stroke} />
            <Path d="M5 9.5 V20 H19 V9.5" {...stroke} />
            <Path d="M10 20 V14 H14 V20" {...stroke} />
          </>
        )}
        {name === 'puzzles' && <Path d="M5 8 H9 A2 2 0 1 1 13 8 H17 V12 A2 2 0 1 1 17 16 V20 H5 Z" {...stroke} />}
        {name === 'analysis' && (
          <>
            <Path d="M5 20 V12 M12 20 V5 M19 20 V9" {...stroke} strokeWidth={3} />
            <Path d="M3 20 H21" {...stroke} />
          </>
        )}
        {name === 'more' && (
          <>
            <Circle cx={5} cy={12} r={2} fill={color} />
            <Circle cx={12} cy={12} r={2} fill={color} />
            <Circle cx={19} cy={12} r={2} fill={color} />
          </>
        )}
      </Svg>
    </View>
  );
}
