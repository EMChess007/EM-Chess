import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { START_FEN } from '../../types/chess';
import type { GameHistoryEntry } from '../../types/history';
import { ChessEngine } from '../ChessEngine';
import { buildGamePayload } from '../gamePayload';
import { HORDE_START_FEN } from '../horde';
import { parsePgn } from '../pgnImport';
import { replayPgn } from '../pgnReplay';

const SRC = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');

/** Plays `sans` from `fen` as a game history, the way a game screen records it. */
function playHistory(fen: string, moves: [string, string][]): GameHistoryEntry[] {
  const history: GameHistoryEntry[] = [];
  let current = fen;
  for (const [from, to] of moves) {
    const engine = new ChessEngine(current, { horde: true });
    const move = engine.move(from, to)!;
    history.push({ move, fenBefore: current, fenAfter: engine.getFen() });
    current = engine.getFen();
  }
  return history;
}

describe('a finished Horde game is saved and exported as Horde', () => {
  const history = playHistory(HORDE_START_FEN, [
    ['e4', 'e5'],
    ['a7', 'a6'],
    ['a4', 'a5'],
  ].map(([a, b]) => [a, b]) as [string, string][]);

  it('buildGamePayload tags the PGN [Variant "Horde"] with the SetUp/FEN headers (the start position is not standard)', () => {
    const payload = buildGamePayload({
      chessStatus: 'playing',
      turn: 'w',
      timeoutWinner: null,
      resignedBy: 'w',
      history,
      initialFen: HORDE_START_FEN,
      chess960: false,
      horde: true,
      timeControl: { id: 'x', label: '10 min', initialSeconds: 600, incrementSeconds: 0, category: 'rapid' },
      opponentType: 'human',
    });
    expect(payload).not.toBeNull();
    expect(payload!.pgn).toContain('[Variant "Horde"]');
    expect(payload!.pgn).toContain('[SetUp "1"]');
    expect(payload!.pgn).toContain(`[FEN "${HORDE_START_FEN}"]`);
    expect(payload!.result).toBe('0-1');
  });

  it("Black capturing the whole horde is Black's win with the horde reason in the saved result", () => {
    const payload = buildGamePayload({
      chessStatus: 'playing',
      turn: 'w',
      timeoutWinner: null,
      hordeWinner: 'b',
      history,
      initialFen: HORDE_START_FEN,
      chess960: false,
      horde: true,
      timeControl: { id: 'x', label: '10 min', initialSeconds: 600, incrementSeconds: 0, category: 'rapid' },
      opponentType: 'bot',
      opponentElo: 1200,
    });
    expect(payload!.result).toBe('0-1');
  });

  it('a saved Horde game can neither be replayed for analysis nor imported (ordinary chess rules cannot play it) — refused, not crashed', () => {
    const pgn = `[Variant "Horde"]\n[SetUp "1"]\n[FEN "${HORDE_START_FEN}"]\n[Result "0-1"]\n\n1. a5 a6 0-1`;
    expect(replayPgn(pgn, false)).toBeNull();
    const parsed = parsePgn(pgn);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/horde/i);
    // ...while an ordinary PGN is untouched by the refusal.
    expect(parsePgn(`[Result "*"]\n\n1. e4 e5 *`).ok).toBe(true);
    expect(START_FEN).toContain('rnbqkbnr');
  });
});

describe('Horde wiring (no React Native renderer available)', () => {
  it('ChessEngine: the horde option implies skipValidation, answers status/over itself, and uses the shared en-passant policy', () => {
    const engine = read('logic/ChessEngine.ts');
    expect(engine).toContain('horde?: boolean;');
    expect(engine).toContain('(options?.skipValidation ?? false) || this.atomic || this.horde');
    expect(engine).toContain('this.chess.isDrawByFiftyMoves()');
    expect(engine).toContain('HORDE_FIRST_RANK_DOUBLE_STEP_ALLOWS_EN_PASSANT ?');
    // The insufficient-material draw is deliberately NOT consulted for Horde: chess.js\'s isDraw() sits outside the horde branch.
    const hordeStatus = engine.slice(engine.indexOf('if (this.horde) {\n      // Never chess.js'), engine.indexOf('if (this.chess.isCheckmate()) return \'checkmate\';\n    if (this.chess.isStalemate()) return \'stalemate\';\n    if (this.chess.isDraw())'));
    expect(hordeStatus.length).toBeGreaterThan(100);
    const codeOnly = hordeStatus.split(/\r?\n/).filter((line) => !line.trim().startsWith('//')).join(' ');
    expect(codeOnly).not.toContain('isDraw()');
  });

  it('ChessBoard passes horde to every engine it builds, and forces skipValidation for it', () => {
    const board = read('components/ChessBoard.tsx');
    expect(board).toContain('const needsSkipValidation = usesPseudoLegalMoves || spellChess || horde;');
    expect(board.match(/\bhorde,\n/g)?.length).toBe(2); // the memoized engine and the tryMove engine
    expect(board).toContain('giveaway, atomic, duckChess, horde })'); // the animation's piece lookup
  });

  for (const screen of ['screens/LocalGameScreen.tsx', 'screens/BotGameScreen.tsx']) {
    it(`${screen} starts from the Horde position, feeds the Horde winner into getGameOutcome and the payload, and turns the Stockfish-only extras off`, () => {
      const src = read(screen);
      expect(src).toContain('horde ? HORDE_START_FEN : chess960');
      expect(src).toContain('const hordeWinner = useMemo(() => (horde ? getHordeWinner(engine) : null), [horde, engine]);');
      expect(src).toMatch(/getGameOutcome\([\s\S]*?spellChessWinner,\s*hordeWinner\s*\)/);
      expect(src).toContain('hordeWinner,\n        horde,');
      expect(src).toContain("? 'playing' // chess.js calls \"White has nothing left\" stalemate");
      expect(src).toContain('horde={horde}');
      expect(src).toContain('!spellChess && !horde && !crazyhouse && openingName');
      expect(src).toContain('spellChess || horde || crazyhouse) return;'); // no hints
      expect(src).toContain('isReviewing || fogOfWar || giveaway || atomic || duckChess || spellChess || horde');
    });
  }

  it('the bot plays Horde with chooseHordeBotMove BEFORE it would ever ask Stockfish, on either side, with no premoves and no rating change', () => {
    const bot = read('screens/BotGameScreen.tsx');
    const hordeBranch = bot.indexOf('if (horde) {');
    const stockfishCall = bot.lastIndexOf('engineRuntime.engine.getBestMove');
    expect(hordeBranch).toBeGreaterThan(-1);
    expect(bot).toContain('chooseHordeBotMove(moveEngine');
    expect(stockfishCall).toBeGreaterThan(hordeBranch);
    expect(bot).toContain('premoveColor={giveaway || atomic || duckChess || spellChess || horde || crazyhouse ? undefined : userColor}');
    expect(bot).toContain('onPremove={giveaway || atomic || duckChess || spellChess || horde || crazyhouse ? undefined : handleQueuePremove}');
    // Rating: Horde IS excluded (heuristic bot) while Spell Chess deliberately is not.
    expect(bot).toContain('if (ratingCategory && !giveaway && !atomic && !duckChess && !horde && !crazyhouse) recordRatedGame(');
    expect(bot).toContain('if (result === 1 && !giveaway && !atomic && !duckChess && !horde && !crazyhouse) {');
    expect(bot).toContain('skipValidation: giveaway || duckChess || spellChess || horde,');
  });

  it('Game Review is off for Horde (Stockfish cannot be given a position with no White king)', () => {
    const modal = read('components/PostGameSummaryModal.tsx');
    expect(modal).toContain('!giveaway && !atomic && !duckChess && !spellChess && !horde && !crazyhouse ? new StockfishEngineAdapter() : null');
    expect(modal).toContain('{!giveaway && !atomic && !duckChess && !spellChess && !horde && !crazyhouse && (');
  });

  it('the pickers: Horde is a Local and a Bot mode, shown honestly in the bot list, and never offered custom UCI engines', () => {
    const play = read('screens/PlayModeSelectScreen.tsx');
    expect(play).toContain('onPress={onBotHorde}');
    expect(play).toContain('onPress={onLocalHorde}');
    const bots = read('screens/BotSelectScreen.tsx');
    expect(bots).toContain("horde ? 'Horde bot'");
    expect(bots).toContain('customEngines.length > 0 && !horde && !crazyhouse && (');
    const app = readFileSync(join(SRC, '../App.tsx'), 'utf8').split(/\r?\n/).join(' ');
    expect(app).toContain("mode.kind !== 'engineVsEngine' && mode.horde");
    // Not an Engine-vs-Engine mode either: those need UCI engines.
    expect(app).not.toMatch(/kind: 'engineVsEngine'[^}]*horde/);
  });

  it('Horde is excluded from Tournaments (a tournament never creates a Horde room)', () => {
    expect(read('screens/TournamentScreen.tsx')).toContain("'spellChess', 'horde', 'crazyhouse']");
    expect(read('screens/TournamentStandingsScreen.tsx').match(/isHorde: false/g)?.length).toBe(2);
  });

  it('chessops (GPL, dev-only) is imported by tests alone — never by anything that ships', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (name === '__tests__' || name === 'node_modules' || name === 'generated') continue;
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && /from ['"]chessops/.test(readFileSync(full, 'utf8'))) offenders.push(full);
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});
