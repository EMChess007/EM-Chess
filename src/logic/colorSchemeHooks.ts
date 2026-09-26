import { useEffect, useState } from 'react';
import { getColors, type AppColors } from './colorPalette';
import { getColorSchemeMode, subscribeColorSchemeMode } from './colorSchemeSettings';

export type { AppColors };

export function useAppColors(): AppColors {
  const [mode, setMode] = useState(getColorSchemeMode);
  useEffect(() => subscribeColorSchemeMode(setMode), []);
  return getColors(mode);
}
