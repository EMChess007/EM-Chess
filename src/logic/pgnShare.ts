import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';

export type SharePgnResult = 'shared' | 'copied' | 'failed';

/**
 * Gets a game's PGN out of the app. Native platforms open the OS share sheet (mail/chat/notes/
 * "Copy" are all up to whatever's installed); react-native-web has no Share implementation at all,
 * so web always copies straight to the clipboard instead. If the share sheet itself fails (e.g.
 * the user's device has none of the above), falls back to copying too.
 */
export async function sharePgn(pgn: string): Promise<SharePgnResult> {
  if (Platform.OS !== 'web') {
    try {
      await Share.share({ message: pgn });
      return 'shared';
    } catch {
      // fall through to clipboard
    }
  }
  try {
    await Clipboard.setStringAsync(pgn);
    return 'copied';
  } catch {
    return 'failed';
  }
}
