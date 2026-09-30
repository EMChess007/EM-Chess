import { Text, type StyleProp, type TextStyle } from 'react-native';

interface ModeButtonLabelProps {
  label: string;
  style: StyleProp<TextStyle>;
}

/**
 * Label for an equal-width row of mode-select buttons (see PlayModeSelectScreen). A single-word
 * label (e.g. "Classic", "Tournaments") never breaks mid-word — there's no good place to wrap it,
 * so it shrinks to fit one line instead. A multi-word label (e.g. "King of the Hill") wraps at a
 * word boundary across up to 2 lines, at the ORIGINAL font size, since a natural break point
 * always exists there. Picking behavior by word count means a future variant with a long name
 * gets correct treatment automatically, without deciding it case by case.
 */
export default function ModeButtonLabel({ label, style }: ModeButtonLabelProps) {
  const isSingleWord = !label.trim().includes(' ');
  if (isSingleWord) {
    return (
      <Text style={style} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65}>
        {label}
      </Text>
    );
  }
  return (
    <Text style={style} numberOfLines={2}>
      {label}
    </Text>
  );
}
