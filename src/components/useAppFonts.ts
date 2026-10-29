import { useFonts } from 'expo-font';
import { useEffect, useState } from 'react';
import { APP_FONT, setBundledFontsUsable } from '../logic/typography';

/** The bundled Inter files (SIL Open Font License, assets/fonts/Inter-OFL.txt), one family per weight - see logic/typography.ts for why the metrics must not come from the OEM font. */
const FONT_FILES = {
  [APP_FONT.regular]: require('../../assets/fonts/Inter_400Regular.ttf'),
  [APP_FONT.medium]: require('../../assets/fonts/Inter_500Medium.ttf'),
  [APP_FONT.semibold]: require('../../assets/fonts/Inter_600SemiBold.ttf'),
  [APP_FONT.bold]: require('../../assets/fonts/Inter_700Bold.ttf'),
  [APP_FONT.extrabold]: require('../../assets/fonts/Inter_800ExtraBold.ttf'),
  [APP_FONT.italic]: require('../../assets/fonts/Inter_400Regular_Italic.ttf'),
};

/** A font that never settles must not leave the app blank: after this long the system font is used. */
const FONT_LOAD_GIVE_UP_MS = 6000;

/**
 * Loads the bundled fonts. Returns true once they are settled - loaded (every `Text` then draws with them) or failed / too slow (every `Text` keeps the system font and
 * the app still works). App.tsx renders nothing before this is true, so no screen is ever measured with one font and drawn with another.
 */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(FONT_FILES);
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setGaveUp(true), FONT_LOAD_GIVE_UP_MS);
    return () => clearTimeout(id);
  }, []);
  const settled = loaded || error !== null || gaveUp;
  // Set during render on purpose: the children below render in this same pass and read it.
  if (settled) setBundledFontsUsable(loaded);
  return settled;
}
