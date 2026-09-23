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
