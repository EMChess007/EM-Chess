import { useEffect, useState } from 'react';
import { getBoardTheme } from './boardThemes';
import { getPieceTheme } from './pieceThemes';
import { getActiveBoardThemeId, getActivePieceThemeId, subscribeActiveBoardTheme, subscribeActivePieceTheme } from './themeSettings';
import type { BoardTheme, PieceTheme } from '../types/theme';

/** Reads the currently active board theme, reactively — used once in ChessBoard.tsx (not
 * per-square) and passed down as props, so a theme change re-renders every mounted board
 * immediately without any of the screens that render ChessBoard needing to know this exists. */
export function useActiveBoardTheme(): BoardTheme {
  const [id, setId] = useState(getActiveBoardThemeId);
  useEffect(() => subscribeActiveBoardTheme(setId), []);
  return getBoardTheme(id);
}

export function useActivePieceTheme(): PieceTheme {
  const [id, setId] = useState(getActivePieceThemeId);
  useEffect(() => subscribeActivePieceTheme(setId), []);
  return getPieceTheme(id);
}
