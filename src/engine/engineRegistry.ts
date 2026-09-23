import type { UciChessEngine } from './ChessEngine';
import { stockfish11Engine } from './Stockfish11EngineAdapter';
import { buildStockfish11Html } from './stockfish11Html';
import { stockfishEngine } from './StockfishEngineAdapter';
import { buildStockfishHtml } from './stockfishHtml';
import { DEFAULT_ENGINE_ID } from '../logic/engines';

export interface EngineRuntime {
  engine: UciChessEngine;
  /** Builds the self-contained HTML this engine's StockfishBridge instance should load. */
  buildHtml: () => string;
}

// Pairs each engine id (see src/logic/engines.ts for the picker-facing metadata) with its live
// UciChessEngine instance and the bridge HTML it needs. Kept separate from engines.ts so that
// file can stay lightweight, picker-only metadata; this one is for screens that actually run
// a game (BotGameScreen, AnalysisScreen).
//
// A mutable Map (not a fixed object) because custom engines are registered/unregistered at
// runtime as the user adds/removes them (see EngineSelectScreen + logic/customEngines.ts) —
// the two built-ins below are just pre-seeded into the same map at module load.
const ENGINE_RUNTIMES = new Map<string, EngineRuntime>([
  ['stockfish', { engine: stockfishEngine, buildHtml: buildStockfishHtml }],
  ['stockfish11', { engine: stockfish11Engine, buildHtml: buildStockfish11Html }],
]);

/** Resolves an engine id to its runtime (engine instance + bridge HTML), falling back to the
 * default engine for an unrecognized id (e.g. a custom engine that failed to reload after an
 * app restart) rather than throwing mid-game. */
export function getEngineRuntime(engineId: string): EngineRuntime {
  return ENGINE_RUNTIMES.get(engineId) ?? ENGINE_RUNTIMES.get(DEFAULT_ENGINE_ID)!;
}

/** Registers (or replaces) a custom engine's runtime — called once its uploaded .wasm has
 * already passed validation (see EngineSelectScreen). */
export function registerEngineRuntime(engineId: string, runtime: EngineRuntime): void {
  ENGINE_RUNTIMES.set(engineId, runtime);
}

/** Removes a custom engine's runtime — the built-in ids are never passed here. */
export function unregisterEngineRuntime(engineId: string): void {
  ENGINE_RUNTIMES.delete(engineId);
}
