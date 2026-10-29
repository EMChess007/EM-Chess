import { View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface SideInsetsFrameProps extends ViewProps {
  /** Also keep clear of the bottom system area (gesture strip, three-button bar). Off for the tab screens: the tab bar pads itself by the same inset. */
  bottom?: boolean;
}

/**
 * The app's root frame: keeps every screen out of the system areas nothing else handled - a display cutout on a landscape phone (the notch sits on the left or right edge), a
 * three-button navigation bar that moves to the right edge in landscape, and the bottom gesture / navigation strip on screens without the tab bar. The top inset is handled
 * where it matters (ScreenHeader, the tab screens). The frame's own background shows in the padding, so no gap appears. Found by the Android device matrix.
 */
export default function SideInsetsFrame({ style, bottom = false, ...rest }: SideInsetsFrameProps) {
  const insets = useSafeAreaInsets();
  return <View {...rest} style={[style, { paddingLeft: insets.left, paddingRight: insets.right, paddingBottom: bottom ? insets.bottom : 0 }]} />;
}
