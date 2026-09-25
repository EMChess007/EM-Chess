import { addCustomBoardThemeOption, DEFAULT_BOARD_THEME_ID, removeCustomBoardThemeOption } from './boardThemes';
import {
  addCustomBoardTheme as persistCustomBoardTheme,
  addCustomPieceTheme as persistCustomPieceTheme,
  listCustomBoardThemes,
  listCustomPieceThemes,
  removeCustomBoardTheme as deletePersistedBoardTheme,
  removeCustomPieceTheme as deletePersistedPieceTheme,
  type CustomBoardThemeRecord,
  type CustomPieceThemeRecord,
} from './customThemeStorage';
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
  pieces.forEach((record) => addCustomPieceThemeOption(toPieceTheme(record)));
}

export async function saveCustomBoardTheme(name: string, lightColor: string, darkColor: string): Promise<BoardTheme> {
  const record = await persistCustomBoardTheme(name, lightColor, darkColor);
  const theme = toBoardTheme(record);
  addCustomBoardThemeOption(theme);
  return theme;
}

export async function saveCustomPieceTheme(name: string, images: Record<string, string>): Promise<PieceTheme> {
  const record = await persistCustomPieceTheme(name, images);
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
  if (getActivePieceThemeId() === id) await setActivePieceTheme(DEFAULT_PIECE_THEME_ID);
}
