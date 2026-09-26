import type { EngineOption } from '../types/engine';

/** The strongest available engine — used as the default for analysis (always, regardless of
 * which engine played the bot's moves) and as the fallback for an unrecognized engine id. */
export const DEFAULT_ENGINE_ID = 'stockfish';

const CLASSICAL_ENGINE_ID = 'stockfish11';

// Purely metadata — kept free of any actual engine/WASM imports so nothing needs to import
// actual engine code just to show/reason about the list of engines. The actual UciChessEngine
// instance + bridge HTML for each id lives in src/engine/engineRegistry.ts, imported only
// where a game is actually played/analyzed.
export const AVAILABLE_ENGINES: EngineOption[] = [
  { id: 'stockfish', name: 'Stockfish', description: 'Powerful, widely-used open-source engine (NNUE).' },
  {
    id: 'stockfish11',
    name: 'Stockfish 11 (Classical)',
    description: 'Older build, pre-NNUE — a more classical, positional playing style.',
  },
];

export function getEngineName(id: string): string {
  return AVAILABLE_ENGINES.find((engine) => engine.id === id)?.name ?? id;
}

/** Adds a custom engine's metadata to the picker-facing list — mutates AVAILABLE_ENGINES
 * in place (not a new array) so screens that read it fresh on every render/mount (they all
 * do — none of them cache it) pick the change up without needing any shared React state. */
export function addCustomEngineOption(option: EngineOption): void {
  AVAILABLE_ENGINES.push(option);
}

/** Removes a custom engine's metadata by id — a no-op if it isn't found (e.g. already removed). */
export function removeCustomEngineOption(id: string): void {
  const index = AVAILABLE_ENGINES.findIndex((engine) => engine.id === id);
  if (index !== -1) AVAILABLE_ENGINES.splice(index, 1);
}

/**
 * Bots at or below this ELO play against Stockfish 11 (classical eval); above it, they play
 * against the current NNUE Stockfish. Set to land exactly in the gap between the existing
 * "intermediate" (tops out at 1400) and "advanced" (starts at 1600) bot categories in
 * src/logic/bots.ts, so no category is ever split across two engines.
 *
 * Why split here rather than just dialing one engine's strength down further: a modern NNUE
 * engine forced down to a low ELO via UCI_LimitStrength/Skill Level still "sees" the position
 * with a strong engine's positional understanding underneath, so the mistakes it's made to
 * produce tend to feel arbitrary rather than genuinely human — a real classical-eval engine at
 * low-to-mid strength blunders more naturally, in the same recognizable ways a weaker human
 * player actually does. Once a bot is meant to play like a strong club player or better
 * (1600+), that authenticity concern flips: players expect sharp, accurate play, which NNUE
 * reliably gives even when only lightly weakened.
 */
const CLASSICAL_ENGINE_MAX_ELO = 1400;

/** Which engine a bot of the given ELO should play against — see CLASSICAL_ENGINE_MAX_ELO. */
export function getEngineIdForElo(elo: number): string {
  return elo <= CLASSICAL_ENGINE_MAX_ELO ? CLASSICAL_ENGINE_ID : DEFAULT_ENGINE_ID;
}

export interface BotStrengthOptions {
  elo?: number;
  skillLevel?: number;
  skillLevelMaximumError?: number;
  skillLevelProbability?: number;
}

/**
 * Hand-tuned Skill Level / Skill Level Maximum Error / Skill Level Probability breakpoints for
 * bots that land on the classical engine (see CLASSICAL_ENGINE_MAX_ELO). Confirmed live against
 * the actual bundled Stockfish 11 WASM build's UCI option declarations:
 *
 *   option name Skill Level type spin default 20 min 0 max 20
 *   option name Skill Level Maximum Error type spin default 200 min 0 max 5000
 *   option name Skill Level Probability type spin default 128 min 1 max 1000
 *   No such option: UCI_LimitStrength
 *
 * That last line is the actual bug this fixes: this build has no UCI_LimitStrength/UCI_Elo at
 * all, so sending them (as every bot used to, regardless of ELO) is silently ignored and the
 * engine plays undialed, full-strength moves for every bot at or below CLASSICAL_ENGINE_MAX_ELO.
 *
 * Skill Level alone can't stand in for UCI_Elo here either — in practice it bottoms out around
 * ~1300 ELO (a real engine still rarely blunders even at its lowest dial), well above our
 * lowest bots (400-1400). So Maximum Error/Probability — Stockfish's own deliberate
 * blunder-injection knobs — do most of the work at the weak end, tapering back down toward
 * Stockfish's own defaults (200cp / 128‰) as ELO approaches the classical engine's native floor
 * at CLASSICAL_ENGINE_MAX_ELO, where Skill Level itself takes back over as the main lever.
 * These are a best-effort heuristic, not a lab-measured calibration — there's no official
 * formula below the point where the engine's own supported strength range starts.
 */
const WEAK_BOT_BREAKPOINTS: Array<{
  elo: number;
  skillLevel: number;
  skillLevelMaximumError: number;
  skillLevelProbability: number;
}> = [
  { elo: 400, skillLevel: 0, skillLevelMaximumError: 900, skillLevelProbability: 650 },
  { elo: 600, skillLevel: 1, skillLevelMaximumError: 750, skillLevelProbability: 520 },
  { elo: 800, skillLevel: 2, skillLevelMaximumError: 600, skillLevelProbability: 400 },
  { elo: 1000, skillLevel: 3, skillLevelMaximumError: 450, skillLevelProbability: 300 },
  { elo: 1200, skillLevel: 5, skillLevelMaximumError: 300, skillLevelProbability: 200 },
  { elo: 1400, skillLevel: 7, skillLevelMaximumError: 200, skillLevelProbability: 128 },
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function weakBotParamsForElo(elo: number): (typeof WEAK_BOT_BREAKPOINTS)[number] {
  const points = WEAK_BOT_BREAKPOINTS;
  if (elo <= points[0].elo) return points[0];
  if (elo >= points[points.length - 1].elo) return points[points.length - 1];
  for (let i = 0; i < points.length - 1; i++) {
    const lo = points[i];
    const hi = points[i + 1];
    if (elo >= lo.elo && elo <= hi.elo) {
      const t = (elo - lo.elo) / (hi.elo - lo.elo);
      return {
        elo,
        skillLevel: Math.round(lerp(lo.skillLevel, hi.skillLevel, t)),
        skillLevelMaximumError: Math.round(lerp(lo.skillLevelMaximumError, hi.skillLevelMaximumError, t)),
        skillLevelProbability: Math.round(lerp(lo.skillLevelProbability, hi.skillLevelProbability, t)),
      };
    }
  }
  return points[points.length - 1];
}

/**
 * Resolves the actual getBestMove() strength options for a bot of this ELO — `{ elo }` above
 * CLASSICAL_ENGINE_MAX_ELO (a genuinely supported, calibrated UCI_Elo on the NNUE engine: verified
 * live as "option name UCI_Elo type spin default 1320 min 1320 max 3190"), or Skill
 * Level(+error knobs) at or below it, where UCI_Elo doesn't exist. Always derive strength options
 * through this rather than sending `elo` directly, so the two never drift out of sync with
 * getEngineIdForElo's own threshold.
 */
export function getBotStrengthOptions(elo: number): BotStrengthOptions {
  if (elo > CLASSICAL_ENGINE_MAX_ELO) return { elo };
  const { skillLevel, skillLevelMaximumError, skillLevelProbability } = weakBotParamsForElo(elo);
  return { skillLevel, skillLevelMaximumError, skillLevelProbability };
}
