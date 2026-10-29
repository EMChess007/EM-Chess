import { StyleSheet } from 'react-native';
import { Text } from './AppText';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';

interface KingAttackedPillProps {
  /** Who is warned: "Your king is attacked — it can be captured" for the viewer, "Red: your king is …" in a shared-device game. */
  text: string;
}

/**
 * Chaturaji's "king attacked" notice. It REPLACES the status line (so the layout does not move) and is informational only: in Capture the King a check never has to be
 * answered, so there is no blocked move, no "get out of check" and the board stays fully playable while it is shown. Amber, like the ring on the king itself - never the
 * red of a 4 Player Chess check.
 */
export default function KingAttackedPill({ text }: KingAttackedPillProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  return (
    <Text testID="king-attacked-pill" accessibilityRole="alert" style={styles.pill}>
      {text}
    </Text>
  );
}

function createStyles(colors: AppColors) {
  const dark = colors.mode === 'dark';
  return StyleSheet.create({
    pill: {
      fontSize: 14,
      fontWeight: '700',
      overflow: 'hidden',
      paddingVertical: 3,
      paddingHorizontal: 12,
      borderRadius: 12,
      color: dark ? '#ffcc80' : '#7a4a00',
      backgroundColor: dark ? '#4a3510' : '#ffe0a3',
    },
  });
}
