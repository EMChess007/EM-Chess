import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { START_FEN, type Move } from '../../types/chess';
import type { GameHistoryEntry } from '../../types/history';
import { ChessEngine } from '../ChessEngine';
import { duckMoveNotation, getDuckChessWinner, getLegalDuckPlacementSquares, hasNoDuckMoves } from '../duckChess';
import { describeEndReason } from '../gameOutcomeText';
import { buildGamePayload } from '../gamePayload';
import { getGameOutcome } from '../gameResult';
import { parsePgn } from '../pgnImport';
import { replayPgn } from '../pgnReplay';

const duckEngine = (fen: string, duckSquare: string | null) => new ChessEngine(fen, { skipValidation: true, duckChess: true, duckSquare });

/** One whole Duck Chess TURN exactly as the screens commit it: a regular move, then the duck's new square. */
function playTurn(history: GameHistoryEntry[], from: string, to: string, duck: string | null, promotion?: Move['promotion']): GameHistoryEntry[] {
  const fen = history.length ? history[history.length - 1].fenAfter : START_FEN;
  const currentDuck = history.length ? history[history.length - 1].duckSquare ?? null : null;
  const engine = duckEngine(fen, currentDuck);
  const move = engine.movePseudoLegal(from, to, promotion);
  if (!move) throw new Error(`illegal duck move ${from}${to} (duck ${currentDuck}) in ${fen}`);
  if (duck !== null) expect(getLegalDuckPlacementSquares(engine, currentDuck), `duck ${duck}`).toContain(duck);
  const committed: Move = duck ? { ...move, duck } : move;
  return [...history, { move: committed, fenBefore: fen, fenAfter: engine.getFen(), duckSquare: committed.duck ?? currentDuck }];
}

describe('a Duck Chess game, turn by turn (as LocalGameScreen/BotGameScreen build it)', () => {
  it('White\'s very first turn already includes both actions; the duck then moves every turn', () => {
    let h = playTurn([], 'e2', 'e4', 'e6'); // move + the first-ever duck placement
    expect(h[0].duckSquare).toBe('e6');
    expect(duckMoveNotation(h[0].move)).toBe('e4 @e6');
    // Black cannot push e7-e6 (the duck is there) but may play e7-e5.
    const black = duckEngine(h[0].fenAfter, 'e6');
    expect(black.getPseudoLegalMoves('b').some((m) => m.from === 'e7' && m.to === 'e6')).toBe(false);
    expect(black.getPseudoLegalMoves('b').some((m) => m.from === 'e7' && m.to === 'e5')).toBe(false); // the double step passes over it too
    h = playTurn(h, 'd7', 'd5', 'c4');
    expect(h.map((e) => e.duckSquare)).toEqual(['e6', 'c4']);
    // The duck's own square is never a legal placement: it must move.
    expect(getLegalDuckPlacementSquares(duckEngine(h[1].fenAfter, 'c4'), 'c4')).not.toContain('c4');
  });

  it('Undo is atomic: dropping the last entry restores BOTH the position and the duck', () => {
    let h = playTurn([], 'e2', 'e4', 'a3');
    h = playTurn(h, 'e7', 'e5', 'h6');
    h = playTurn(h, 'g1', 'f3', 'd5');
    const afterUndo = h.slice(0, -1);
    expect(afterUndo[afterUndo.length - 1].duckSquare).toBe('h6'); // the duck is back where it stood before the undone turn
    expect(afterUndo[afterUndo.length - 1].fenAfter).toBe(h[1].fenAfter);
  });

  it('capturing the king ends the game at once, with no duck placement, and the winner is read off the turn', () => {
    // 1.e4 f5 2.Qh5 — with f7 gone the queen already looks down the h5-e8 diagonal; there is no check, so Black
    // may ignore it, and White then simply takes the king.
    let h = playTurn([], 'e2', 'e4', 'a6');
    h = playTurn(h, 'f7', 'f5', 'a5');
    h = playTurn(h, 'd1', 'h5', 'b3');
    h = playTurn(h, 'h7', 'h6', 'b4'); // Black ignores the "check"
    const engine = duckEngine(h[h.length - 1].fenAfter, 'b4');
    const capture = engine.movePseudoLegal('h5', 'e8');
    expect(capture?.captured).toBe('k');
    expect(getDuckChessWinner(capture, 'w')).toBe('w');
    const last: GameHistoryEntry = { move: capture!, fenBefore: h[h.length - 1].fenAfter, fenAfter: engine.getFen(), duckSquare: h[h.length - 1].duckSquare };
    expect(last.move.duck).toBeUndefined();
    expect(getGameOutcome('playing', 'b', null, null, false, null, null, null, null, null, 'w')).toEqual({ over: true, result: '1-0', reason: 'duckChess' });
    expect(describeEndReason('duckChess')).toBe('by King Capture');
  });

  it('a side with no regular move at all (blockaded) is a draw', () => {
    // White's only pawn on e2 with the duck on e3: nothing to play. (Kingless positions are fine in Duck Chess.)
    expect(hasNoDuckMoves(duckEngine('8/8/8/8/8/8/4P3/8 w - - 0 1', 'e3'))).toBe(true);
  });

  it('getGameOutcome: the Duck winner sits in the top tier (outranks timeout, resignation, agreement, mate)', () => {
    expect(getGameOutcome('checkmate', 'b', 'b', 'b', true, 'b', 'b', null, null, null, 'w')).toEqual({ over: true, result: '1-0', reason: 'duckChess' });
    expect(getGameOutcome('playing', 'w', null, null, false, null, null, null, null, null, null)).toEqual({ over: false });
    expect(getGameOutcome('draw', 'w', null)).toEqual({ over: true, result: '1/2-1/2', reason: 'draw' }); // blockade
  });
});

describe('saved games', () => {
  it('are tagged [Variant "Duck"] and carry the duck as a PGN comment after each move', () => {
    let h = playTurn([], 'e2', 'e4', 'e6');
    h = playTurn(h, 'd7', 'd5', 'c4');
    const payload = buildGamePayload({
      chessStatus: 'playing',
      turn: 'w',
      timeoutWinner: null,
      resignedBy: 'b',
      duckChess: true,
      history: h,
      initialFen: START_FEN,
      chess960: false,
      timeControl: { label: 'Unlimited', category: 'unlimited' } as never,
      opponentType: 'human',
    });
    expect(payload?.pgn).toContain('[Variant "Duck"]');
    expect(payload?.pgn).toContain('1.e4 {@e6} d5 {@c4}');
  });

  it('replay and PGN import refuse Duck games', () => {
    const pgn = '[Variant "Duck"]\n\n1.e4 {@e6} d5 {@c4} *';
    expect(replayPgn(pgn, false)).toBeNull();
    expect(parsePgn(pgn).ok).toBe(false);
  });
});

describe('wiring (no React Native renderer available)', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '../../', rel), 'utf8').replace(/\r\n/g, '\n');
  const board = read('components/ChessBoard.tsx');

  it('ChessBoard holds a regular move until the duck is placed, then commits ONE move carrying the duck', () => {
    expect(board).toContain('setPendingDuck({ move, fen: result.fen })');
    expect(board).toContain("duckChess && move.captured !== 'k'"); // a king capture needs no placement
    expect(board).toContain('const committed: Move = { ...pendingDuck.move, duck: square };');
    expect(board).toContain('onMove(committed, pendingDuck.fen)');
    expect(board).toContain('getLegalDuckPlacementSquares(engine, duckSquare)');
    expect(board).toContain('skipAnimationRef.current = true');
  });

  for (const screen of ['screens/LocalGameScreen.tsx', 'screens/BotGameScreen.tsx']) {
    it(`${screen} derives the duck from the history (so Undo restores it), feeds the winner into getGameOutcome and the payload`, () => {
      const src = read(screen);
      expect(src).toContain('history[history.length - 1].duckSquare ?? null');
      expect(src).toMatch(/getGameOutcome\([\s\S]*?atomicWinner,\s*duckWinner,\s*spellChessWinner\s*\)/);
      expect(src).toContain('duckChessWinner: duckWinner,\n        duckChess,');
      expect(src).toContain('duckChess={duckChess}');
      expect(src).toContain('onDuckPlacementChange={setPlacingDuck}');
      expect(src).toContain('duckMoveNotation(h.move)');
    });
  }

  it('the bot never asks Stockfish for a Duck Chess turn, and has no premoves or rating change', () => {
    const bot = read('screens/BotGameScreen.tsx');
    const duckBranch = bot.indexOf('if (duckChess) {');
    const stockfishCall = bot.lastIndexOf('engineRuntime.engine.getBestMove');
    expect(duckBranch).toBeGreaterThan(-1);
    expect(bot).toContain('chooseDuckBotMove(moveEngine');
    expect(stockfishCall).toBeGreaterThan(duckBranch);
    expect(bot).toContain('premoveColor={giveaway || atomic || duckChess || spellChess ? undefined : userColor}');
    expect(bot).toContain('!giveaway && !atomic && !duckChess) recordRatedGame');
  });

  it('is reachable from the play-mode menu for Local and Bots, and is a variant-selector option', () => {
    const menu = read('screens/PlayModeSelectScreen.tsx');
    expect(menu).toContain('onBotDuckChess');
    expect(menu).toContain('onLocalDuckChess');
    expect(read('components/VariantSelector.tsx')).toContain("value: 'duckChess'");
  });

  it('Game Review is off for Duck Chess (Stockfish knows nothing of the duck)', () => {
    expect(read('components/PostGameSummaryModal.tsx')).toContain('!giveaway && !atomic && !duckChess');
  });
});
