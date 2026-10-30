import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PieceImageMap } from '../types/theme';

export interface CustomBoardThemeRecord {
  id: string;
  name: string;
  lightColor: string;
  darkColor: string;
}

export interface CustomPieceThemeRecord {
  id: string;
  name: string;
  /** All 12 piece images. On a phone: file URIs of files in the app's own folder (piece-themes/<id>/<key>.png, customPieceFiles.ts; command #27d - never data URIs there). In the browser, which has
   * no file system: base64 data URIs. A record written before #27d may still hold data URIs on a phone; restoreCustomThemes moves them into files. */
  images: PieceImageMap;
}

const BOARD_KEY = 'customBoardThemes:v1';
const PIECE_KEY = 'customPieceThemes:v1';

function makeId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadRecords<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveRecords<T>(key: string, records: T[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(records));
  } catch {
    // Non-critical: worst case the user has to re-add their custom theme(s) next time.
  }
}

export async function listCustomBoardThemes(): Promise<CustomBoardThemeRecord[]> {
  return loadRecords<CustomBoardThemeRecord>(BOARD_KEY);
}

export async function addCustomBoardTheme(
  name: string,
  lightColor: string,
  darkColor: string
): Promise<CustomBoardThemeRecord> {
  const record: CustomBoardThemeRecord = { id: makeId(), name, lightColor, darkColor };
  const records = await listCustomBoardThemes();
  records.push(record);
  await saveRecords(BOARD_KEY, records);
  return record;
}

export async function removeCustomBoardTheme(id: string): Promise<void> {
  const records = await listCustomBoardThemes();
  await saveRecords(
    BOARD_KEY,
    records.filter((r) => r.id !== id)
  );
}

export async function listCustomPieceThemes(): Promise<CustomPieceThemeRecord[]> {
  return loadRecords<CustomPieceThemeRecord>(PIECE_KEY);
}

/** A fresh theme id. Unique, so a custom theme's files (piece-themes/<id>/<key>.png) never share a path with another theme's. */
export const newCustomThemeId = makeId;

export async function addCustomPieceTheme(name: string, images: PieceImageMap, id: string = makeId()): Promise<CustomPieceThemeRecord> {
  const record: CustomPieceThemeRecord = { id, name, images };
  const records = await listCustomPieceThemes();
  records.push(record);
  await saveRecords(PIECE_KEY, records);
  return record;
}

/** Replaces the images of a stored theme (an old record whose data URIs were moved into files). */
export async function updateCustomPieceThemeImages(id: string, images: PieceImageMap): Promise<void> {
  const records = await listCustomPieceThemes();
  await saveRecords(
    PIECE_KEY,
    records.map((r) => (r.id === id ? { ...r, images } : r))
  );
}

export async function removeCustomPieceTheme(id: string): Promise<void> {
  const records = await listCustomPieceThemes();
  await saveRecords(
    PIECE_KEY,
    records.filter((r) => r.id !== id)
  );
}
