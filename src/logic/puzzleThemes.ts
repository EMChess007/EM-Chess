import AsyncStorage from '@react-native-async-storage/async-storage';

export interface PuzzleThemeOption {
  /** The exact Lichess puzzle-theme tag as it appears in each PuzzleData.themes array — see
   * ../data/puzzles.json. */
  id: string;
  label: string;
}

/** The ~15 most common, genuinely thematic (tactical-motif) tags in the bundled puzzle dataset —
 * picked by checking the real distribution (4200 puzzles, 71 distinct tags) and excluding tags
 * that describe difficulty/length/source rather than a motif a player would deliberately want to
 * drill (e.g. "short"/"long"/"crushing"/"advantage"/"master" are common too, but aren't "themes"
 * in the sense this feature means). Ordered roughly by how common each is in the dataset. */
export const PUZZLE_THEME_OPTIONS: PuzzleThemeOption[] = [
  { id: 'endgame', label: 'Endgame' },
  { id: 'fork', label: 'Fork' },
  { id: 'mateIn2', label: 'Mate in 2' },
  { id: 'mateIn1', label: 'Mate in 1' },
  { id: 'sacrifice', label: 'Sacrifice' },
  { id: 'advancedPawn', label: 'Advanced Pawn' },
  { id: 'pin', label: 'Pin' },
  { id: 'discoveredAttack', label: 'Discovered Attack' },
  { id: 'deflection', label: 'Deflection' },
  { id: 'attraction', label: 'Attraction' },
  { id: 'hangingPiece', label: 'Hanging Piece' },
  { id: 'mateIn3', label: 'Mate in 3' },
  { id: 'skewer', label: 'Skewer' },
  { id: 'discoveredCheck', label: 'Discovered Check' },
  { id: 'backRankMate', label: 'Back Rank Mate' },
  { id: 'zugzwang', label: 'Zugzwang' },
];

const STORAGE_KEY = 'puzzleTraining:selectedThemes';

/** Loads the player's last-selected theme filter, if any — read once when PuzzleTrainingScreen
 * mounts, so re-opening it doesn't reset a previous choice. */
export async function loadSelectedPuzzleThemes(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveSelectedPuzzleThemes(themes: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(themes));
  } catch {
    // Non-critical: worst case this selection isn't remembered next time.
  }
}
