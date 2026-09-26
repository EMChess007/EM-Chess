import type { AnalysisLine, AnalyzeOptions, AnalysisResult, BestMoveOptions, EngineEvaluation, UciChessEngine } from './ChessEngine';
import type { StockfishBridgeHandle } from './StockfishBridge';

type LineListener = (line: string) => void;

const BEST_MOVE_RE = /^bestmove\s+(\S+)/;
const INFO_LINE_RE = /^info\s+.*?\bmultipv\s+(\d+)\s+.*?\bscore\s+(cp|mate)\s+(-?\d+)\s+.*?\bpv\s+(.+)$/;
const READY_TIMEOUT_MS = 10000;
const BEST_MOVE_TIMEOUT_MS = 20000;
const ANALYSIS_TIMEOUT_MS = 30000;

// How many candidate root moves to ask the engine for when `skillLevel` is set, so a weak bot's
// "maximum error"/"probability" blunder can be picked from real engine-evaluated alternatives
// instead of relying on the engine's own internal Skill Level weakening. Live UCI testing showed
// that internal mechanism essentially never substitutes a genuinely bad move (only ever nudges
// between near-equal top choices), regardless of movetime or how extreme the configured error/
// probability values are — so weak bots played at full strength in practice. This MultiPV-based
// substitution is time-independent (it only needs the search to have ranked a few root moves,
// which happens even at very low movetime), fixing that gap.
const WEAK_BOT_CANDIDATE_MULTIPV = 6;

interface ScoredCandidate {
  move: string;
  virtualCp: number;
}

/** Converts a UCI score to a single comparable number (mate scores treated as far outside any
 * realistic `skillLevelMaximumError` window, signed by which side is winning). */
function scoreToVirtualCp(type: 'cp' | 'mate', value: number): number {
  if (type === 'cp') return value;
  return value > 0 ? 100000 - value : -100000 - value;
}

/**
 * Controls a Stockfish-family engine instance running inside a StockfishBridge (a hidden
 * WebView on native, a hidden iframe on web — see StockfishBridge.tsx / .web.tsx).
 *
 * The bridge component itself must be mounted somewhere in the tree and wired up with
 * `attachBridge`/`handleLine` (see StockfishBridge usage in StockfishTestScreen) before
 * any of the methods below will do anything.
 *
 * Implements the shared `UciChessEngine` contract (see ./ChessEngine.ts) — screens should
 * depend on that interface, not on this class, wherever they don't specifically need to know
 * which build the engine is. The UCI wiring here is entirely generic (it just speaks the UCI
 * protocol over whatever bridge it's attached to) — it doesn't care whether that bridge is
 * running the current NNUE Stockfish build or the classical Stockfish 11 build (see
 * Stockfish11EngineAdapter.ts, a second independent instance of this same class), so there's
 * no need for a second, duplicated class just to support a second Stockfish build.
 */
export class StockfishEngineAdapter implements UciChessEngine {
  private bridge: StockfishBridgeHandle | null = null;
  private lineListeners = new Set<LineListener>();
  private uciReadyPromise: Promise<void> | null = null;
  private bridgeReadyPromise: Promise<void> | null = null;
  private resolveBridgeReady: (() => void) | null = null;

  attachBridge(bridge: StockfishBridgeHandle | null): void {
    this.bridge = bridge;
    // A newly (re)mounted bridge is a fresh WebView/iframe running its own fresh engine
    // instance, so any previous "engine is ready" handshake no longer applies to it.
    this.uciReadyPromise = null;
    this.resolveBridgeReady = null;
    this.bridgeReadyPromise = bridge
      ? new Promise((resolve) => {
          this.resolveBridgeReady = resolve;
        })
      : null;
  }

  isAttached(): boolean {
    return this.bridge !== null;
  }

  /** Feed a raw line of engine output in (called by the mounted StockfishBridge's onLine). */
  handleLine(line: string): void {
    // The bridge's own "I've loaded and I'm listening" signal (see stockfishHtml.ts) — commands
    // sent before this arrives would be posted into the iframe/WebView before its message
    // listener even exists, and silently lost. Track it regardless of whether anything is
    // awaiting it yet, since it may well arrive before initEngine() is ever called.
    if (line.trim() === 'BRIDGE_READY' && this.resolveBridgeReady) {
      this.resolveBridgeReady();
      this.resolveBridgeReady = null;
    }

    for (const listener of this.lineListeners) {
      listener(line);
    }
  }

  private send(command: string): void {
    if (!this.bridge) {
      throw new Error('StockfishEngineAdapter: no bridge attached (mount <StockfishBridge> first)');
    }
    this.bridge.postCommand(command);
  }

  private waitForLine(predicate: (line: string) => boolean, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.lineListeners.delete(onLine);
        reject(new Error('StockfishEngineAdapter: timed out waiting for engine response'));
      }, timeoutMs);

      const onLine: LineListener = (line) => {
        if (predicate(line)) {
          clearTimeout(timeout);
          this.lineListeners.delete(onLine);
          resolve(line);
        }
      };
      this.lineListeners.add(onLine);
    });
  }

  /** Initializes the engine (UCI handshake). Safe to call multiple times. */
  async initEngine(): Promise<void> {
    if (!this.uciReadyPromise) {
      this.uciReadyPromise = (async () => {
        if (this.bridgeReadyPromise) {
          await this.bridgeReadyPromise;
        }

        const uciAck = this.waitForLine((line) => line.trim() === 'uciok', READY_TIMEOUT_MS);
        this.send('uci');
        await uciAck;

        const readyAck = this.waitForLine((line) => line.trim() === 'readyok', READY_TIMEOUT_MS);
        this.send('isready');
        await readyAck;
      })();
    }
    return this.uciReadyPromise;
  }

  /** Sends the given position (as a FEN string) to the engine. */
  setPosition(fen: string): void {
    this.send(`position fen ${fen}`);
  }

  /** Asks the engine for the best move in the current position, returned in UCI form (e.g. "e2e4"). */
  async getBestMove(options: BestMoveOptions = {}): Promise<string> {
    await this.initEngine();

    if (options.elo !== undefined) {
      this.send('setoption name UCI_LimitStrength value true');
      this.send(`setoption name UCI_Elo value ${Math.round(options.elo)}`);
    } else {
      this.send('setoption name UCI_LimitStrength value false');
    }

    // A weak (skillLevel-based) bot gets its blunder injected below, from real MultiPV
    // candidates — see WEAK_BOT_CANDIDATE_MULTIPV. Still send the engine's own Skill Level
    // options too (harmless, and it does provide some native weakening on its own), but they're
    // no longer solely relied on for producing genuine mistakes.
    const injectingBlunders =
      options.skillLevel !== undefined &&
      options.skillLevelMaximumError !== undefined &&
      options.skillLevelProbability !== undefined;

    if (options.skillLevel !== undefined) {
      this.send(`setoption name Skill Level value ${Math.round(options.skillLevel)}`);
    }
    if (options.skillLevelMaximumError !== undefined) {
      this.send(`setoption name Skill Level Maximum Error value ${Math.round(options.skillLevelMaximumError)}`);
    }
    if (options.skillLevelProbability !== undefined) {
      this.send(`setoption name Skill Level Probability value ${Math.round(options.skillLevelProbability)}`);
    }
    this.send(`setoption name MultiPV value ${injectingBlunders ? WEAK_BOT_CANDIDATE_MULTIPV : 1}`);

    const candidatesByRank = new Map<number, ScoredCandidate>();
    const infoListener: LineListener = (line) => {
      const match = INFO_LINE_RE.exec(line);
      if (!match) return;
      const rank = parseInt(match[1], 10);
      const type = match[2] as 'cp' | 'mate';
      const value = parseInt(match[3], 10);
      const move = match[4].trim().split(/\s+/)[0];
      candidatesByRank.set(rank, { move, virtualCp: scoreToVirtualCp(type, value) });
    };
    if (injectingBlunders) {
      this.lineListeners.add(infoListener);
    }

    const bestMove = this.waitForLine((line) => BEST_MOVE_RE.test(line), BEST_MOVE_TIMEOUT_MS);

    if (options.depth !== undefined) {
      this.send(`go depth ${Math.round(options.depth)}`);
    } else {
      this.send(`go movetime ${Math.round(options.movetimeMs ?? 1000)}`);
    }

    let line: string;
    try {
      line = await bestMove;
    } finally {
      this.lineListeners.delete(infoListener);
    }
    const match = BEST_MOVE_RE.exec(line);
    if (!match) {
      throw new Error(`StockfishEngineAdapter: could not parse bestmove line: "${line}"`);
    }
    const engineMove = match[1];

    if (!injectingBlunders) return engineMove;

    const best = candidatesByRank.get(1);
    if (!best) return engineMove;

    const eligible: ScoredCandidate[] = [];
    for (const [rank, candidate] of candidatesByRank) {
      if (rank === 1) continue;
      if (best.virtualCp - candidate.virtualCp <= options.skillLevelMaximumError!) {
        eligible.push(candidate);
      }
    }
    if (eligible.length > 0 && Math.random() * 1000 < options.skillLevelProbability!) {
      return eligible[Math.floor(Math.random() * eligible.length)].move;
    }
    return engineMove;
  }

  /**
   * Evaluates a single position at full strength (no ELO/skill limiting), returning the top
   * `multiPv` candidate lines (evaluation + move sequence), best first. Used by analysis mode,
   * one call per position — do not call this concurrently on the same engine instance, since
   * UCI is a single stateful conversation.
   */
  async analyzePosition(fen: string, options: AnalyzeOptions = {}): Promise<AnalysisResult> {
    await this.initEngine();

    const multiPv = Math.max(1, Math.round(options.multiPv ?? 1));
    this.send('setoption name UCI_LimitStrength value false');
    this.send(`setoption name MultiPV value ${multiPv}`);
    this.setPosition(fen);

    const linesByRank = new Map<number, AnalysisLine>();
    const infoListener: LineListener = (line) => {
      const match = INFO_LINE_RE.exec(line);
      if (!match) return;
      const rank = parseInt(match[1], 10);
      const evaluation: EngineEvaluation = { type: match[2] as 'cp' | 'mate', value: parseInt(match[3], 10) };
      const moves = match[4].trim().split(/\s+/);
      linesByRank.set(rank, { evaluation, moves });
    };
    this.lineListeners.add(infoListener);

    const bestMoveLine = this.waitForLine((line) => BEST_MOVE_RE.test(line), ANALYSIS_TIMEOUT_MS);

    if (options.depth !== undefined) {
      this.send(`go depth ${Math.round(options.depth)}`);
    } else {
      this.send(`go movetime ${Math.round(options.movetimeMs ?? 1000)}`);
    }

    let line: string;
    try {
      line = await bestMoveLine;
    } finally {
      this.lineListeners.delete(infoListener);
    }

    if (!BEST_MOVE_RE.test(line)) {
      throw new Error(`StockfishEngineAdapter: could not parse bestmove line: "${line}"`);
    }
    if (linesByRank.size === 0) {
      throw new Error('StockfishEngineAdapter: engine returned a move but no evaluation');
    }

    const lines = Array.from(linesByRank.keys())
      .sort((a, b) => a - b)
      .map((rank) => linesByRank.get(rank)!);
    return { lines };
  }
}

export const stockfishEngine: UciChessEngine = new StockfishEngineAdapter();
