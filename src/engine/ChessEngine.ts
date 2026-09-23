import type { StockfishBridgeHandle } from './StockfishBridge';

export interface BestMoveOptions {
  /** Approximate playing strength via UCI_LimitStrength/UCI_Elo (roughly 1320-3190). */
  elo?: number;
  /** The engine's own 0-20-ish skill dial, used when `elo` isn't given. */
  skillLevel?: number;
  /** Search a fixed depth instead of a fixed time. */
  depth?: number;
  /** Search time in milliseconds when `depth` isn't given. Defaults to 1000ms. */
  movetimeMs?: number;
}

export interface AnalyzeOptions {
  /** Search a fixed depth instead of a fixed time. */
  depth?: number;
  /** Search time in milliseconds when `depth` isn't given. Defaults to 1000ms. */
  movetimeMs?: number;
  /** How many candidate lines to ask the engine for (UCI "MultiPV"). Defaults to 1. */
  multiPv?: number;
}

/** An engine evaluation, from the perspective of whichever side is to move in that position. */
export type EngineEvaluation = { type: 'cp'; value: number } | { type: 'mate'; value: number };

export interface AnalysisLine {
  evaluation: EngineEvaluation;
  /** The full principal variation for this line, in UCI form (e.g. ["e2e4", "e7e5", "g1f3"]). */
  moves: string[];
}

export interface AnalysisResult {
  /** Candidate lines ordered best-first (index 0 is the engine's top choice). */
  lines: AnalysisLine[];
}

/**
 * What every chess engine adapter in this app must support — one shared, UCI-protocol-shaped
 * contract, implemented today by StockfishEngineAdapter and intended for any future engine
 * (see EngineSelectScreen / src/logic/engines.ts for the picker this enables) to implement the
 * same way, so screens (BotGameScreen, AnalysisScreen, ...) can depend on this interface alone
 * and never care which concrete engine they were handed.
 *
 * `attachBridge`/`isAttached`/`handleLine` are wiring for the hidden-WebView-on-native /
 * hidden-iframe-on-web transport (see StockfishBridge.tsx / .web.tsx): that bridge is itself
 * UCI-generic (it just relays command strings in and raw engine-output lines out) despite its
 * Stockfish-specific name — a second engine can reuse the exact same bridge component, posting
 * its own UCI-compatible WASM build's HTML instead of stockfishHtml.ts's.
 */
export interface UciChessEngine {
  /** Wires this engine up to a mounted bridge instance (or detaches it with `null`). */
  attachBridge(bridge: StockfishBridgeHandle | null): void;
  /** Whether a bridge is currently attached. */
  isAttached(): boolean;
  /** Feed a raw line of engine output in (called by the mounted bridge's onLine). */
  handleLine(line: string): void;
  /** Initializes the engine (UCI handshake). Safe to call multiple times. */
  initEngine(): Promise<void>;
  /** Sends the given position (as a FEN string) to the engine. */
  setPosition(fen: string): void;
  /** Asks the engine for the best move in the current position, in UCI form (e.g. "e2e4"). */
  getBestMove(options?: BestMoveOptions): Promise<string>;
  /** Evaluates a position, returning the top `multiPv` candidate lines, best first. */
  analyzePosition(fen: string, options?: AnalyzeOptions): Promise<AnalysisResult>;
}
