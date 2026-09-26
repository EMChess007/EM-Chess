import AsyncStorage from '@react-native-async-storage/async-storage';

export type PuzzleRushDuration = 3 | 5;

const KEY_PREFIX = 'puzzleRush:bestScore:';

function keyFor(duration: PuzzleRushDuration): string {
  return `${KEY_PREFIX}${duration}`;
}

export async function getBestScore(duration: PuzzleRushDuration): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(duration));
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

/** Persists `score` as the new best for this duration if it beats the current one. Returns the
 * best score after this call (the new one, or the unchanged existing one). */
export async function saveScoreIfBest(duration: PuzzleRushDuration, score: number): Promise<number> {
  const current = await getBestScore(duration);
  if (score <= current) return current;
  try {
    await AsyncStorage.setItem(keyFor(duration), String(score));
  } catch {
    // Non-critical: worst case this run's best isn't remembered.
  }
  return score;
}
