import { forwardRef } from 'react';
import { Pressable as RNPressable, type PressableProps, type StyleProp, type ViewInstance, type ViewStyle } from 'react-native';

/** The smallest touch target, in dp, Android's accessibility guidance asks for (48 dp) and the app's own floor (44 dp, the Android device matrix checks it). */
export const MIN_TOUCH_TARGET = 44;

const MIN_SIZE: ViewStyle = { minHeight: MIN_TOUCH_TARGET, minWidth: MIN_TOUCH_TARGET };

/**
 * The app's `Pressable`: every control is at least 44 x 44 dp (Android text-fit / device-matrix work). A control that really is smaller by design (a chip inside a tray that has its
 * own touch layer) asks for it with `compact`, which is searchable and reviewed; a style that sets its own `minHeight` / `minWidth` wins over the floor.
 * A scan test (`textFit.test.ts`) fails if a file outside this one imports `Pressable` from 'react-native'.
 */
interface AppPressableProps extends PressableProps {
  /** Opt out of the 44 dp floor: the control is deliberately small (and has another way to be reached). */
  compact?: boolean;
}

export const Pressable = forwardRef<ViewInstance, AppPressableProps>(function Pressable({ style, compact = false, ...rest }, ref) {
  if (compact) return <RNPressable ref={ref} style={style} {...rest} {...matrixExempt} />;
  const withFloor: PressableProps['style'] =
    typeof style === 'function' ? (state) => [MIN_SIZE, style(state)] as StyleProp<ViewStyle> : ([MIN_SIZE, style] as StyleProp<ViewStyle>);
  return <RNPressable ref={ref} style={withFloor} {...rest} />;
});

/** On web the browser matrix reads this attribute to know the small size is intended (react-native-web renders `dataSet` as data-* attributes; native ignores it). */
const matrixExempt = { dataSet: { matrixExempt: '1' } } as object;

export type { PressableProps };
