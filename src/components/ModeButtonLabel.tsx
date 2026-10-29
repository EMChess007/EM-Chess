import type { StyleProp, TextStyle } from 'react-native';
import { Text } from './AppText';
import { DENSE_MAX_FONT_SIZE_MULTIPLIER } from '../logic/typography';

interface ModeButtonLabelProps {
  label: string;
  style: StyleProp<TextStyle>;
}

/**
 * Label for a row of mode-select buttons (see PlayModeSelectScreen). It always fits, whatever the font and the text scale: a multi-word label (e.g. "King of the Hill") wraps at
 * a word boundary, a single long word ("Tournaments") that is wider than its button breaks inside the word as a last resort (AppText) - the button grows in height (it has a
 * minimum height, not a fixed one). It used to shrink a single word with `adjustsFontSizeToFit`, which the browser ignores (so the word overflowed there) and which an
 * Android phone applies to a text box measured with other glyph metrics (the cut "Chess96", "Three-C" of the device report). Growth is capped (dense control, 1.2 x).
 */
export default function ModeButtonLabel({ label, style }: ModeButtonLabelProps) {
  return (
    <Text style={style} maxFontSizeMultiplier={DENSE_MAX_FONT_SIZE_MULTIPLIER}>
      {label}
    </Text>
  );
}
