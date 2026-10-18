import { StyleSheet, Text, View } from 'react-native';
import { useAppColors } from '../logic/colorSchemeHooks';
import { CAPTURE_BLOCKED_TEXT, CAPTURE_MANDATORY_TEXT } from '../logic/giveawayHints';

interface MandatoryCaptureBannerProps {
  /** The start of the status it replaces: "Your turn", "Red to move" ... - kept so the banner still says whose turn it is. */
  lead: string;
  /** True for a few seconds after the player tapped a piece that cannot move: the banner then spells out why and what to do. */
  nudged: boolean;
}

/**
 * Giveaway: the status line while a capture is mandatory for the player to move - "Your turn — Capture is mandatory", a bold amber pill instead
 * of the plain status text so it cannot be missed (the old "... — must capture" tail was easy to overlook and never said which pieces can move).
 * It REPLACES the status row (never adds one: the game screens have a fixed height budget and clip what overflows) and wraps instead of
 * clipping on a narrow phone. Amber with dark text in light mode, a dark amber with light text in dark mode - contrast independent of the
 * chosen board / piece theme (it is not drawn on the board). After a blocked tap it turns into the longer message.
 */
export default function MandatoryCaptureBanner({ lead, nudged }: MandatoryCaptureBannerProps) {
  const colors = useAppColors();
  const dark = colors.mode === 'dark';
  const text = nudged ? CAPTURE_BLOCKED_TEXT : `${lead} — ${CAPTURE_MANDATORY_TEXT}`;
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={text}
      style={[
        styles.pill,
        dark ? { backgroundColor: '#4a3a12', borderColor: '#ffb300' } : { backgroundColor: '#fff0c2', borderColor: '#e69500' },
        nudged && styles.nudged,
      ]}
    >
      <Text style={[styles.text, nudged && styles.nudgedText, { color: dark ? '#ffe082' : '#5c3b00' }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 0,
    paddingHorizontal: 12,
  },
  // The long message must stay ONE line on a 360 px phone (a second line would push the board down under the player's finger, and the 4 Player
  // screen has no spare height), hence the smaller text and the tighter padding.
  nudged: {
    paddingHorizontal: 6,
    marginHorizontal: 6,
  },
  nudgedText: {
    fontSize: 11,
  },
  text: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18, // explicit and shared with nudgedText, so the pill is the same height in both states and nothing moves when it swaps
    textAlign: 'center',
  },
});
