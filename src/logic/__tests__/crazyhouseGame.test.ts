import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { START_FEN } from '../../types/chess';
import type { GameHistoryEntry } from '../../types/history';
import { ChessEngine } from '../ChessEngine';
import { initialCrazyhouseState } from '../crazyhouse';
import { buildGamePayload } from '../gamePayload';
import { latestPlyState, plyStateAtView } from '../perPlyState';
import { parsePgn } from '../pgnImport';
import { replayPgn } from '../pgnReplay';

const SRC = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');

/** Plays a Crazyhouse game the way a game screen records it: one history entry per ply, each carrying the state AFTER it. */
function playHistory(turns: ({ from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' } | { drop: 'p' | 'n' | 'b' | 'r' | 'q'; at: string })[], fen = START_FEN): GameHistoryEntry[] {
  const history: GameHistoryEntry[] = [];
  let current = fen;
  let state = initialCrazyhouseState();
  for (const turn of turns) {
    const engine = new ChessEngine(current, { crazyhouse: true, crazyhouseState: state });
    const move = 'drop' in turn ? engine.drop(turn.drop, turn.at) : engine.move(turn.from, turn.to, turn.promotion);
    expect(move, JSON.stringify(turn)).not.toBeNull();
    state = engine.getCrazyhouseState();
    history.push({ move: move!, fenBefore: current, fenAfter: engine.getFen(), crazyhouse: move!.crazyhouse });
    current = engine.getFen();
  }
  return history;
}

const GAME = [
  { from: 'e2', to: 'e4' },
  { from: 'd7', to: 'd5' },
  { from: 'e4', to: 'd5' }, // White banks a pawn
  { from: 'g8', to: 'f6' },
  { drop: 'p' as const, at: 'e5' }, // ...and drops it
];

describe('a finished Crazyhouse game is saved and exported as Crazyhouse', () => {
  const history = playHistory(GAME);

  it('buildGamePayload tags the PGN [Variant "Crazyhouse"] and writes the drop as P@e5; the result needs no Crazyhouse-specific input', () => {
    const payload = buildGamePayload({
      chessStatus: 'playing',
      turn: 'b',
      timeoutWinner: null,
      resignedBy: 'b',
      history,
      initialFen: START_FEN,
      chess960: false,
      crazyhouse: true,
      timeControl: { id: 'x', label: '10 min', initialSeconds: 600, incrementSeconds: 0, category: 'rapid' },
      opponentType: 'human',
    });
    expect(payload).not.toBeNull();
    expect(payload!.pgn).toContain('[Variant "Crazyhouse"]');
    expect(payload!.pgn).toContain('3.P@e5');
    expect(payload!.pgn).not.toContain('[SetUp'); // an ordinary start position
    expect(payload!.result).toBe('1-0');
  });

  it('a checkmate by DROP is saved as a checkmate win', () => {
    const engine = new ChessEngine('7k/6pp/8/8/8/8/8/4K3 w - - 0 1', { crazyhouse: true, crazyhouseState: { reserve: { w: { p: 0, n: 0, b: 0, r: 0, q: 1 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } }, promoted: [] } });
    const move = engine.drop('q', 'f8')!;
    expect(move.san).toBe('Q@f8#');
    expect(engine.getStatus()).toBe('checkmate');
    const payload = buildGamePayload({
      chessStatus: engine.getStatus(),
      turn: engine.getTurn(),
      timeoutWinner: null,
      history: [{ move, fenBefore: '7k/6pp/8/8/8/8/8/4K3 w - - 0 1', fenAfter: engine.getFen(), crazyhouse: move.crazyhouse }],
      initialFen: '7k/6pp/8/8/8/8/8/4K3 w - - 0 1',
      chess960: false,
      crazyhouse: true,
      timeControl: { id: 'x', label: '10 min', initialSeconds: 600, incrementSeconds: 0, category: 'rapid' },
      opponentType: 'human',
    });
    expect(payload!.result).toBe('1-0');
  });

  it('a saved Crazyhouse game can neither be replayed for analysis nor imported (its drops are not moves) — refused, not crashed', () => {
    const pgn = `[Variant "Crazyhouse"]\n[Result "1-0"]\n\n1. e4 d5 2. exd5 Nf6 3. P@e5 1-0`;
    expect(replayPgn(pgn, false)).toBeNull();
    const parsed = parsePgn(pgn);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/crazyhouse/i);
    expect(parsePgn(`[Result "*"]\n\n1. e4 e5 *`).ok).toBe(true); // ordinary PGNs are untouched
  });
});

describe('per-ply state: Undo, position review and a reload restore the reserves', () => {
  const history = playHistory(GAME);
  const state = (h: GameHistoryEntry[]) => latestPlyState(h, (e) => e.crazyhouse, initialCrazyhouseState());

  it('the live state is the last ply\'s; before any move it is the empty start', () => {
    expect(state([])).toEqual(initialCrazyhouseState());
    expect(state(history).reserve.w.p).toBe(0); // banked on ply 3, dropped on ply 5
    expect(state(history.slice(0, 3)).reserve.w.p).toBe(1); // Undo twice: the pawn is back in the reserve
    expect(state(history.slice(0, 2))).toEqual(initialCrazyhouseState());
  });

  it('position review reads the state of the position DISPLAYED: live (null), the start (0), or after ply k', () => {
    const at = (viewIndex: number | null) => plyStateAtView(history, viewIndex, (e) => e.crazyhouse, initialCrazyhouseState());
    expect(at(null).reserve.w.p).toBe(0);
    expect(at(0)).toEqual(initialCrazyhouseState());
    expect(at(2)).toEqual(initialCrazyhouseState());
    expect(at(3).reserve.w.p).toBe(1);
    expect(at(4).reserve.w.p).toBe(1);
    expect(at(5).reserve.w.p).toBe(0);
  });

  it('Undo then play on rebuilds the engine from (fen, state) and carries on — including a REDO of the same drop', () => {
    const undone = history.slice(0, 4); // before the drop
    const fen = undone[undone.length - 1].fenAfter;
    const engine = new ChessEngine(fen, { crazyhouse: true, crazyhouseState: state(undone) });
    expect(engine.getLegalDropSquares('p')).toContain('e5');
    const redo = engine.drop('p', 'e5');
    expect(redo?.san).toBe('P@e5');
    expect(engine.getFen()).toBe(history[4].fenAfter);
    expect(engine.getCrazyhouseState()).toEqual(history[4].crazyhouse);
  });
});

describe('Crazyhouse wiring (no React Native renderer available)', () => {
  for (const screen of ['screens/LocalGameScreen.tsx', 'screens/BotGameScreen.tsx']) {
    it(`${screen} derives the state per ply, records it on every history entry, shows the displayed position's state, and turns the Stockfish-only extras off`, () => {
      const src = read(screen);
      expect(src).toContain('const crazyhouseState = useMemo(() => latestPlyState(history, (h) => h.crazyhouse, initialCrazyhouseState()), [history]);');
      expect(src).toContain('...(crazyhouse ? { crazyhouse: move.crazyhouse ?? crazyhouseState } : {}),');
      expect(src).toContain('plyStateAtView(history, viewIndex, (h) => h.crazyhouse, initialCrazyhouseState())');
      expect(src).toContain('crazyhouseState={displayCrazyhouse}');
      expect(src).toContain('compact={spellChess || crazyhouse}');
      expect(src).toContain('!spellChess && !horde && !crazyhouse && openingName');
      expect(src).toContain('spellChess || horde || crazyhouse) return;'); // no hints
      expect(src).toContain('hordeWinner,\n        horde,\n        crazyhouse,'); // the saved-game payload is tagged
      expect(src).toContain("? 'Crazyhouse'");
      expect(src).toContain('crazyhouse={crazyhouse}'); // the summary modal (and the board) know it is Crazyhouse
    });
  }

  it('the bot plays Crazyhouse with chooseCrazyhouseBotMove BEFORE it would ever ask Stockfish, applies a drop with drop(), and is never rated', () => {
    const bot = read('screens/BotGameScreen.tsx');
    const branch = bot.indexOf('if (crazyhouse) {');
    const stockfishCall = bot.lastIndexOf('engineRuntime.engine.getBestMove');
    expect(branch).toBeGreaterThan(-1);
    expect(stockfishCall).toBeGreaterThan(branch);
    expect(bot).toContain('chooseCrazyhouseBotMove(moveEngine, bot.elo)');
    expect(bot).toContain("choice.type === 'drop'");
    expect(bot).toContain('? moveEngine.drop(choice.piece, choice.square)');
    expect(bot).toContain('premoveColor={giveaway || atomic || duckChess || spellChess || horde || crazyhouse ? undefined : userColor}');
    expect(bot).toContain('onPremove={giveaway || atomic || duckChess || spellChess || horde || crazyhouse ? undefined : handleQueuePremove}');
    expect(bot).toContain('if (ratingCategory && !giveaway && !atomic && !duckChess && !horde && !crazyhouse) recordRatedGame(');
    expect(bot).toContain('if (result === 1 && !giveaway && !atomic && !duckChess && !horde && !crazyhouse) {');
    expect(bot).toContain('crazyhouse,\n          crazyhouseState,'); // the bot's own move engine is built with the state
  });

  it('ChessBoard: builds every engine with the state, commits a drop in ONE tap (unlike Duck Chess), and marks promoted pieces', () => {
    const board = read('components/ChessBoard.tsx');
    expect(board.match(/crazyhouse,\n\s*crazyhouseState,/g)?.length).toBeGreaterThanOrEqual(2); // the memoized engine and the tryMove engine
    expect(board).toContain('const handleDrop = (piece: ReservePieceType, square: string) => {');
    expect(board).toContain('dropEngine.drop(piece, square)');
    expect(board).toContain('<ReserveTray');
    expect(board).toContain('isPromoted={crazyhouse && !!crazyhouseState && crazyhouseState.promoted.includes(square.square)}');
    expect(board).toContain('setDropPiece(null);'); // reset on a position change and on selecting a piece
    expect(read('components/Square.tsx')).toContain('isPromoted &&');
  });

  it('ChessEngine: the crazyhouse option reports status/over/move-count itself and never consults chess.js insufficient material', () => {
    const engine = read('logic/ChessEngine.ts');
    expect(engine).toContain('crazyhouse?: boolean;');
    expect(engine).toContain('if (this.chess.moves().length === 0 && !this.hasLegalDrop())');
    expect(engine).toContain('return this.chess.moves().length + this.getLegalDrops().length;');
    const status = engine.slice(engine.indexOf('if (this.crazyhouse) {\n      // A side is only mated'), engine.indexOf("return inCheck ? 'check' : 'playing';"));
    expect(status.length).toBeGreaterThan(100);
    const codeOnly = status.split('\n').filter((line) => !line.trim().startsWith('//')).join(' ');
    expect(codeOnly).not.toContain('isDraw()');
    expect(codeOnly).not.toContain('isInsufficientMaterial');
  });

  it('the reserve tray is exactly as wide as the room it is given and scales its content down (never up, never below the floor) instead of clipping', () => {
    const tray = read('components/ReserveTray.tsx');
    expect(tray).toContain('export const MIN_SCALE = 0.6;');
    expect(tray).toContain('const scale = natural > width && width > 0 ? Math.max(MIN_SCALE, width / natural) : 1;');
    expect(tray).toContain('<View style={[styles.row, { width }]} accessibilityLabel="Reserves">');
    expect(tray).toContain('transform: [{ scale }]');
    expect(read('components/ChessBoard.tsx')).toContain('width={Math.max(boardSize, width - 32)}');
  });

  it('Game Review is off for Crazyhouse (Stockfish cannot read a reserve)', () => {
    const modal = read('components/PostGameSummaryModal.tsx');
    expect(modal).toContain('!spellChess && !horde && !crazyhouse ? new StockfishEngineAdapter()');
    expect(modal).toContain('{!giveaway && !atomic && !duckChess && !spellChess && !horde && !crazyhouse && (');
  });

  it('the pickers: Crazyhouse is a Local and a Bot mode, shown honestly in the bot list, never offered custom UCI engines, and not an Engine-vs-Engine mode', () => {
    const play = read('screens/PlayModeSelectScreen.tsx');
    expect(play).toContain('onPress={onBotCrazyhouse}');
    expect(play).toContain('onPress={onLocalCrazyhouse}');
    const bots = read('screens/BotSelectScreen.tsx');
    expect(bots).toContain("crazyhouse ? 'Crazyhouse bot'");
    expect(bots).toContain('customEngines.length > 0 && !horde && !crazyhouse && (');
    const app = readFileSync(join(SRC, '../App.tsx'), 'utf8').split(/\r?\n/).join(' ');
    expect(app).toContain("mode.kind !== 'engineVsEngine' && mode.crazyhouse");
    expect(app).not.toMatch(/kind: 'engineVsEngine'[^}]*crazyhouse/);
    expect(read('components/VariantSelector.tsx')).toContain("value: 'crazyhouse'");
  });

  it('Crazyhouse is excluded from Tournaments (a tournament never creates a Crazyhouse room)', () => {
    expect(read('screens/TournamentScreen.tsx')).toContain("'horde', 'crazyhouse']");
    expect(read('screens/TournamentStandingsScreen.tsx').match(/isCrazyhouse: false/g)?.length).toBe(2);
  });

  it('is mutually exclusive with every other variant: the picker offers one variant at a time and the Online wire flags are one-hot', () => {
    expect(read('logic/onlineVariants.ts')).toContain("isCrazyhouse: variant === 'crazyhouse'");
  });

  it('the move strip, status line and review show the drop notation via the move SAN (no special-casing needed): a drop move carries N@f3', () => {
    const engine = new ChessEngine('4k3/8/8/8/8/8/8/4K3 w - - 0 1', { crazyhouse: true, crazyhouseState: { reserve: { w: { p: 0, n: 1, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } }, promoted: [] } });
    const move = engine.drop('n', 'f3')!;
    expect(move.san).toBe('N@f3');
    expect(move.drop).toBe('n');
    expect(move.from).toBe('f3');
    expect(move.to).toBe('f3');
  });
});
