import type { UciChessEngine } from './ChessEngine';
import { StockfishEngineAdapter } from './StockfishEngineAdapter';

/**
 * Creates a fresh UciChessEngine instance for a user-uploaded custom engine.
 *
 * `StockfishEngineAdapter`'s UCI wiring (attachBridge/initEngine/getBestMove/analyzePosition/
 * ...) is entirely engine-agnostic — it just speaks the UCI protocol over whatever bridge it's
 * attached to (see that file's own doc comment, and Stockfish11EngineAdapter.ts, which already
 * reuses it the same way for a second built-in engine). A custom engine differs only in which
 * HTML the bridge loads (buildCustomEngineHtml, wired up in engineRegistry.ts) — never in how
 * the UCI conversation itself is driven — so this is a factory for a new instance of that same
 * class, one per uploaded engine, rather than a duplicated class.
 *
 * A factory (not a shared singleton like `stockfishEngine`/`stockfish11Engine`) because a user
 * can add more than one custom engine — each needs its own independent adapter instance.
 */
export function createCustomEngineAdapter(): UciChessEngine {
  return new StockfishEngineAdapter();
}
