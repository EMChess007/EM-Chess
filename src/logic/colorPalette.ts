import type { ColorSchemeMode } from './colorSchemeSettings';

/** App-wide UI color tokens (backgrounds/text/chrome) — distinct from the chess BOARD/PIECE
 * color themes in boardThemes.ts/pieceThemes.ts, which are unaffected by light/dark mode. */
export interface AppColors {
  mode: ColorSchemeMode;
  background: string;
  surface: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  gold: string;
  danger: string;
  overlay: string;
  /** The app's standard solid "primary action" button background (New Game, Log out, etc.) —
   * kept as its own token because the brand's dark-brown light-mode value would have almost no
   * contrast against a dark-mode page background. */
  buttonBackground: string;
}

const LIGHT: AppColors = {
  mode: 'light',
  background: '#fff',
  surface: '#f7f2ea',
  border: '#eee',
  text: '#3a2618',
  textSecondary: '#8a7a63',
  textMuted: '#999',
  accent: '#2e6f4f',
  gold: '#b5892e',
  danger: '#b00020',
  overlay: 'rgba(0,0,0,0.45)',
  buttonBackground: '#3a2618',
};

const DARK: AppColors = {
  mode: 'dark',
  background: '#121212',
  surface: '#1e1e1e',
  border: '#333',
  text: '#efe6d8',
  textSecondary: '#c2b393',
  textMuted: '#8a8a8a',
  accent: '#3ecf8e',
  gold: '#e0b352',
  danger: '#ff6b6b',
  overlay: 'rgba(0,0,0,0.6)',
  buttonBackground: '#5c4028',
};

export function getColors(mode: ColorSchemeMode): AppColors {
  return mode === 'dark' ? DARK : LIGHT;
}
