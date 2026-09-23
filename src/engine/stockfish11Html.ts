import { STOCKFISH11_JS_SOURCE, STOCKFISH11_WASM_BASE64 } from './generated/stockfish11Assets';
import { buildEngineHtml } from './stockfishHtml';

/** Stockfish 11 (classical, pre-NNUE evaluation) — see scripts/generate-stockfish11-assets.mjs. */
export function buildStockfish11Html(): string {
  return buildEngineHtml(STOCKFISH11_JS_SOURCE, STOCKFISH11_WASM_BASE64);
}
