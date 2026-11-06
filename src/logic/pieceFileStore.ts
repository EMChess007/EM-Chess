import { Platform } from 'react-native';
import type { PieceFileStore } from './customPieceFiles';

/** The folder of the custom piece themes, inside the app's own document directory (safe from the system's cache clean-up). */
export const PIECE_THEMES_FOLDER = 'piece-themes';

/**
 * The phone's file store for custom piece themes: expo-file-system's `legacy` API (the same entry PgnImportScreen reads with; its documentDirectory is the app's own folder, which Expo Go
 * scopes per project and lets the app write to). The module is loaded when first needed so that nothing else pays for it, and never on the web (null: the browser keeps data URIs).
 */
export function getPieceFileStore(): PieceFileStore | null {
  if (Platform.OS === 'web') return null;
  return {
    async writeBase64(dir, name, base64) {
      const FileSystem = await import('expo-file-system/legacy');
      const base = FileSystem.documentDirectory;
      if (base === null) throw new Error('the app has no document directory');
      const folder = `${base}${PIECE_THEMES_FOLDER}/${dir}/`;
      await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
      const uri = `${folder}${name}`;
      await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
      return uri;
    },
    async removeDirectory(dir) {
      const FileSystem = await import('expo-file-system/legacy');
      const base = FileSystem.documentDirectory;
      if (base === null) return;
      await FileSystem.deleteAsync(`${base}${PIECE_THEMES_FOLDER}/${dir}/`, { idempotent: true });
    },
  };
}
