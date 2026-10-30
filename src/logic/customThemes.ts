import { addCustomBoardThemeOption, DEFAULT_BOARD_THEME_ID, removeCustomBoardThemeOption } from './boardThemes';
import {
  addCustomBoardTheme as persistCustomBoardTheme,
  addCustomPieceTheme as persistCustomPieceTheme,
  listCustomBoardThemes,
  listCustomPieceThemes,
  newCustomThemeId,
  removeCustomBoardTheme as deletePersistedBoardTheme,
  removeCustomPieceTheme as deletePersistedPieceTheme,
  updateCustomPieceThemeImages,
  type CustomBoardThemeRecord,
  type CustomPieceThemeRecord,
} from './customThemeStorage';
import { migrateDataUriImages, removePieceImages, writePieceImages } from './customPieceFiles';
import { getPieceFileStore } from './pieceFileStore';
import { addCustomPieceThemeOption, DEFAULT_PIECE_THEME_ID, removeCustomPieceThemeOption } from './pieceThemes';
import { getActiveBoardThemeId, getActivePieceThemeId, setActiveBoardTheme, setActivePieceTheme } from './themeSettings';
import type { BoardTheme, PieceTheme } from '../types/theme';

function toBoardTheme(record: CustomBoardThemeRecord): BoardTheme {
  return { id: record.id, name: record.name, lightColor: record.lightColor, darkColor: record.darkColor, isCustom: true };
}

function toPieceTheme(record: CustomPieceThemeRecord): PieceTheme {
  return { id: record.id, name: record.name, images: record.images, isCustom: true };
}

export async function restoreCustomThemes(): Promise<void> {
  const boards = await listCustomBoardThemes();
  boards.forEach((record) => addCustomBoardThemeOption(toBoardTheme(record)));
  const pieces = await listCustomPieceThemes();
  const store = getPieceFileStore();
  for (const record of pieces) {
    // A record from before command #27d keeps its 12 images as data URIs: on a phone they move into files once (a failure keeps the old record, which still draws).
    const moved = store ? await migrateDataUriImages(record.id, record.images, store) : null;
    if (moved) {
      record.images = moved;
      await updateCustomPieceThemeImages(record.id, moved);
    }
    addCustomPieceThemeOption(toPieceTheme(record));
  }
}

export async function saveCustomBoardTheme(name: string, lightColor: string, darkColor: string): Promise<BoardTheme> {
  const record = await persistCustomBoardTheme(name, lightColor, darkColor);
  const theme = toBoardTheme(record);
  addCustomBoardThemeOption(theme);
  return theme;
}

/** `images` are the picked images as data URIs (the form's draft); on a phone they are written to files first and the theme keeps the file URIs, in the browser they stay as they are. */
export async function saveCustomPieceTheme(name: string, images: Record<string, string>): Promise<PieceTheme> {
  const id = newCustomThemeId();
  const store = getPieceFileStore();
  const stored = store ? await writePieceImages(id, images, store) : images;
  const record = await persistCustomPieceTheme(name, stored, id);
  const theme = toPieceTheme(record);
  addCustomPieceThemeOption(theme);
  return theme;
}

// If the theme being removed is the one currently active, fall back to the built-in default
// first — the app must never end up with no active theme (a dangling id nothing renders for).
export async function deleteCustomBoardTheme(id: string): Promise<void> {
  removeCustomBoardThemeOption(id);
  await deletePersistedBoardTheme(id);
  if (getActiveBoardThemeId() === id) await setActiveBoardTheme(DEFAULT_BOARD_THEME_ID);
}

export async function deleteCustomPieceTheme(id: string): Promise<void> {
  removeCustomPieceThemeOption(id);
  await deletePersistedPieceTheme(id);
  const store = getPieceFileStore();
  if (store) await removePieceImages(id, store);
  if (getActivePieceThemeId() === id) await setActivePieceTheme(DEFAULT_PIECE_THEME_ID);
}
