import type { UciChessEngine } from './ChessEngine';
import { StockfishEngineAdapter } from './StockfishEngineAdapter';

/**
 * Stockfish 11 — the last release before NNUE (introduced in Stockfish 12), so this plays
 * with Stockfish's older, purely handcrafted positional evaluation: a distinctly different,
 * more "classical"/human-feeling style than the current NNUE-based Stockfish, and with no
 * large neural-network weight file baked in (see scripts/generate-stockfish11-assets.mjs and
 * src/engine/generated/stockfish11Assets.ts).
 *
 * `StockfishEngineAdapter`'s UCI wiring is already completely engine-agnostic — it just speaks
 * UCI over whatever bridge it's attached to — so this is simply a second, independent instance
 * of that same class rather than a duplicated one. The only thing that actually differs between
 * "Stockfish" and "Stockfish 11" is which WASM build gets loaded into the bridge each is
 * attached to (see stockfish11Html.ts and src/engine/engineRegistry.ts, which pairs this
 * instance with the right HTML builder).
 */
export const stockfish11Engine: UciChessEngine = new StockfishEngineAdapter();
