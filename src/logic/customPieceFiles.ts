import type { PieceImageMap } from '../types/theme';

/**
 * A user's custom piece theme as FILES (command #27d). The 12 images used to be kept as base64 data URIs inside the AsyncStorage record and handed to `<Image source={{ uri: 'data:...' }}>`:
 * on a phone the image pipeline keys an image by its source string, and a data URI is a 5-200 KB string; a phone showed two pieces of a bundled set wrong while every data URI was right in a
 * browser. A custom theme now lives in the app's own folder, one file per piece, under a path that contains the theme's unique id (`piece-themes/<id>/<key>.png`), and the record keeps the
 * file URIs. The browser has no file system: there `store` is null and the data URIs stay as they are (nothing there ever showed the bug).
 *
 * This module is pure: the file system is a `PieceFileStore` handed in (pieceFileStore.ts is the expo-file-system one, the tests use a memory one).
 */
export interface PieceFileStore {
  /** Writes `base64` (the bare payload, no `data:` prefix) to `<piece-themes>/<dir>/<name>`, replacing a file there, and returns the file's URI. */
  writeBase64(dir: string, name: string, base64: string): Promise<string>;
  /** Removes `<piece-themes>/<dir>` with everything in it; a folder that is not there is not an error. */
  removeDirectory(dir: string): Promise<void>;
}

const DATA_URI = /^data:image\/(png|webp);base64,(.+)$/;

export const isDataUri = (value: unknown): value is string => typeof value === 'string' && value.startsWith('data:');

/** The file extension and the bare base64 payload of an image data URI, or null when it is not a PNG / WebP one. */
export function splitDataUri(uri: string): { extension: 'png' | 'webp'; base64: string } | null {
  const match = DATA_URI.exec(uri);
  return match ? { extension: match[1] as 'png' | 'webp', base64: match[2] } : null;
}

/**
 * Writes every data-URI image of a theme into its own file and returns the map of file URIs (same keys). An image that is not a data URI (already a file URI) is kept as it is. A failure part
 * way removes what was written and throws, so a theme is never left half on disk.
 */
export async function writePieceImages(themeId: string, images: PieceImageMap, store: PieceFileStore): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    for (const [key, image] of Object.entries(images)) {
      if (typeof image !== 'string') throw new Error(`piece image ${key} is not a picked file`);
      if (!isDataUri(image)) {
        out[key] = image;
        continue;
      }
      const parts = splitDataUri(image);
      if (parts === null) throw new Error(`piece image ${key} is not a PNG or WebP`);
      out[key] = await store.writeBase64(themeId, `${key}.${parts.extension}`, parts.base64);
    }
  } catch (error) {
    await store.removeDirectory(themeId).catch(() => undefined);
    throw error;
  }
  return out;
}

/** Whether a stored theme still keeps any image as a data URI (an old record, written before this change). */
export const hasDataUriImages = (images: PieceImageMap): boolean => Object.values(images).some(isDataUri);

/** Rewrites an old record's data-URI images as files. Returns the new map, or null when there was nothing to move or the move failed (the old record then keeps working as it did). */
export async function migrateDataUriImages(themeId: string, images: PieceImageMap, store: PieceFileStore): Promise<Record<string, string> | null> {
  if (!hasDataUriImages(images)) return null;
  try {
    return await writePieceImages(themeId, images, store);
  } catch {
    return null;
  }
}

export async function removePieceImages(themeId: string, store: PieceFileStore): Promise<void> {
  await store.removeDirectory(themeId).catch(() => undefined);
}
