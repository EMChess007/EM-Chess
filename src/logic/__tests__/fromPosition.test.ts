import { describe, expect, it } from 'vitest';
import { ChessEngine } from '../ChessEngine';
import {
  boardFromFen,
  buildFen,
  DEFAULT_FEN_EXTRAS,
  editorErrorText,
  getTurnFromFen,
  normalizePlayFen,
  parseCastlingFromFen,
  parseFenExtras,
  validateEditorFen,
} from '../boardEditor';
import { buildGamePayload } from '../gamePayload';
import { buildPgn } from '../pgn';
import { parsePgn } from '../pgnImport';
import { replayPgn, replaySanTokens } from '../pgnReplay';
import { isRepetitionDraw } from '../repetitionHistory';
import { START_FEN } from '../../types/chess';

/**
 * COMMAND #50 - "From Position" (Part 1: Local + Bot): standard chess from any LEGAL position. These pin the validation that decides whether a
 * position may be PLAYED, and that the ordinary engine / PGN / repetition code works from a FEN that is not the classical start.
 * FENs are literals on purpose (a test that derives them from the module under test could never fail with it).
 */

const MIDDLEGAME = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
const BLACK_TO_MOVE_EP = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
const ROOK_ENDGAME = '4k3/8/8/8/8/8/R7/4K3 w - - 0 1';

const forPlay = (fen: string) => validateEditorFen(fen, { forPlay: true });
const errorOf = (fen: string): string => {
  const result = forPlay(fen);
  if (result.ok) throw new Error(`expected a refusal for ${fen}`);
  return result.error;
};

describe('From Position: validation before start (validateEditorFen forPlay)', () => {
  it('accepts the classical start, a middlegame, a black-to-move FEN with an en passant square and a rook endgame', () => {
    for (const fen of [START_FEN, MIDDLEGAME, BLACK_TO_MOVE_EP, ROOK_ENDGAME]) expect(forPlay(fen), fen).toEqual({ ok: true });
  });

  it('refuses a missing king and a second king of the same side (exactly one king per side), in English and Greek', () => {
    const missing = forPlay('8/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error).toContain('missing black king');
      expect(missing.errorEl).toBe('Λείπει ο μαύρος βασιλιάς.');
    }
    expect(errorOf('4k3/8/8/8/8/8/8/3KK3 w - - 0 1')).toContain('too many white kings');
    const second = forPlay('4k3/8/8/8/8/8/8/3KK3 w - - 0 1');
    if (!second.ok) expect(second.errorEl).toBe('Υπάρχουν πολλοί λευκοί βασιλιάδες (πρέπει να υπάρχει ακριβώς ένας).');
  });

  it('refuses a position where the side NOT to move is in check', () => {
    // White to move, and the black king on e8 is attacked by the rook on e2: Black could never have left it there.
    expect(errorOf('4k3/8/8/8/8/8/4R3/4K3 w - - 0 1')).toBe('The side not to move cannot be in check.');
    // The same placement with Black to move is simply a check, which is legal.
    expect(forPlay('4k3/8/8/8/8/8/4R3/4K3 b - - 0 1')).toEqual({ ok: true });
  });

  it('refuses pawns on rank 1 and rank 8', () => {
    expect(errorOf('4k3/8/8/8/8/8/8/P3K3 w - - 0 1')).toContain('pawns are on the edge rows');
    expect(errorOf('p3k3/8/8/8/8/8/8/4K3 w - - 0 1')).toContain('pawns are on the edge rows');
  });

  it('refuses a castling right whose king or rook is not on its square (each of K, Q, k, q)', () => {
    expect(errorOf('4k3/8/8/8/8/8/8/4K3 w K - 0 1')).toContain('Castling right "K"');
    expect(errorOf('4k3/8/8/8/8/8/8/R3K3 w K - 0 1')).toContain('Castling right "K"'); // only the a1 rook
    expect(errorOf('4k3/8/8/8/8/8/8/4K2R w Q - 0 1')).toContain('Castling right "Q"'); // only the h1 rook
    expect(errorOf('4k3/8/8/8/8/8/8/4K3 w k - 0 1')).toBe('Castling right "k" needs the king and that rook on their starting squares.');
    expect(errorOf('4k2r/8/8/8/8/8/8/4K3 w q - 0 1')).toContain('Castling right "q"'); // only the h8 rook
    expect(errorOf('r3k3/8/8/8/8/8/8/4K3 w k - 0 1')).toContain('Castling right "k"'); // only the a8 rook
    expect(errorOf('4k3/8/8/8/8/8/8/4K3 w q - 0 1')).toContain('Castling right "q"');
    // The king is on d1: neither side's right is real even though both rooks are home.
    expect(errorOf('4k3/8/8/8/8/8/8/R2K3R w KQ - 0 1')).toContain('Castling right "K"');
  });

  it('accepts castling rights only where the king and the rook are home (partial rights)', () => {
    expect(forPlay('r3k2r/8/8/8/8/8/8/R3K2R w Kq - 0 1')).toEqual({ ok: true });
    expect(forPlay('4k3/8/8/8/8/8/8/4K2R w K - 0 1')).toEqual({ ok: true });
  });

  it('refuses an en passant square that does not match the position', () => {
    const expected = 'The en passant square does not match the position (it must follow a pawn double step).';
    expect(errorOf('4k3/8/8/8/8/8/8/4K3 w - e6 0 1')).toBe(expected); // no black pawn on e5
    expect(errorOf('4k3/8/4p3/4p3/8/8/8/4K3 w - e6 0 1')).toBe(expected); // e6 is occupied
    expect(errorOf('4k3/4p3/8/4p3/8/8/8/4K3 w - e6 0 1')).toBe(expected); // the pawn's start square e7 is occupied
    expect(errorOf('4k3/8/8/4P3/8/8/8/4K3 w - e6 0 1')).toBe(expected); // the pawn on e5 is White's own
    expect(errorOf('4k3/8/8/8/8/8/8/4K3 w - e3 0 1')).toContain('en-passant'); // wrong rank for the side to move (chess.js)
    expect(errorOf('4k3/8/8/8/4p3/8/8/4K3 b - e6 0 1')).toContain('en-passant'); // rank 6 with Black to move
    expect(forPlay('4k3/8/8/4p3/8/8/8/4K3 w - e6 0 1')).toEqual({ ok: true });
  });

  it('refuses a position that is already checkmate, stalemate or a dead draw (no game to play)', () => {
    // Fool's mate, White to move: checkmate.
    expect(errorOf('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')).toContain('already checkmate');
    // Black to move with no legal move and not in check: stalemate.
    expect(errorOf('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toContain('already stalemate');
    // King versus king, and a fifty-move-rule draw already on the clock.
    expect(errorOf('4k3/8/8/8/8/8/8/4K3 w - - 0 1')).toContain('already a draw');
    expect(errorOf('4k3/8/8/8/8/8/R7/4K3 w - - 100 80')).toContain('already a draw');
  });

  it('every refusal carries a Greek message that differs from the English one, and editorErrorText shows both lines', () => {
    for (const fen of [
      '8/8/8/8/8/8/8/4K3 w - - 0 1',
      '4k3/8/8/8/8/8/4R3/4K3 w - - 0 1',
      '4k3/8/8/8/8/8/8/P3K3 w - - 0 1',
      '4k3/8/8/8/8/8/8/4K3 w K - 0 1',
      '4k3/8/8/8/8/8/8/4K3 w - e6 0 1',
      '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
      'not a fen',
    ]) {
      const result = forPlay(fen);
      expect(result.ok, fen).toBe(false);
      if (!result.ok) {
        expect(result.errorEl, fen).toMatch(/[Α-Ωα-ω]/);
        expect(result.errorEl, fen).not.toBe(result.error);
        expect(editorErrorText(result), fen).toBe(`${result.error}\n${result.errorEl}`);
      }
    }
  });

  it('keeps the analysis check as it was: a position with an inconsistent castling right or a finished game may still be ANALYSED', () => {
    expect(validateEditorFen('4k3/8/8/8/8/8/8/4K3 w K - 0 1')).toEqual({ ok: true });
    expect(validateEditorFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toEqual({ ok: true });
    // ...but the rules of the structure and of the side not to move still apply to analysis.
    expect(validateEditorFen('4k3/8/8/8/8/8/4R3/4K3 w - - 0 1').ok).toBe(false);
  });

  it('normalizePlayFen pads a 4-field FEN with "0 1", collapses spaces and leaves a 6-field FEN alone', () => {
    expect(normalizePlayFen('  4k3/8/8/8/8/8/R7/4K3   w - -  ')).toBe('4k3/8/8/8/8/8/R7/4K3 w - - 0 1');
    expect(normalizePlayFen(MIDDLEGAME)).toBe(MIDDLEGAME);
    expect(forPlay(normalizePlayFen('4k3/8/8/8/8/8/R7/4K3 w - -'))).toEqual({ ok: true });
  });
});

describe('From Position: the editor keeps the clocks and en passant square of a loaded FEN', () => {
  it('parseFenExtras reads the three fields and defaults a missing or garbage one', () => {
    expect(parseFenExtras(BLACK_TO_MOVE_EP)).toEqual({ enPassant: 'e3', halfmove: 0, fullmove: 1 });
    expect(parseFenExtras(MIDDLEGAME)).toEqual({ enPassant: '-', halfmove: 2, fullmove: 3 });
    expect(parseFenExtras('4k3/8/8/8/8/8/R7/4K3 w - -')).toEqual(DEFAULT_FEN_EXTRAS);
    expect(parseFenExtras('4k3/8/8/8/8/8/R7/4K3 w - - x 0')).toEqual(DEFAULT_FEN_EXTRAS);
  });

  it('buildFen with the extras of a loaded FEN reproduces that FEN; without extras it is the fresh-position default', () => {
    for (const fen of [MIDDLEGAME, BLACK_TO_MOVE_EP, '4k3/8/8/8/8/8/R7/4K3 w - - 37 61']) {
      expect(buildFen(boardFromFen(fen), getTurnFromFen(fen), parseCastlingFromFen(fen), parseFenExtras(fen)), fen).toBe(fen);
    }
    expect(buildFen(boardFromFen(MIDDLEGAME), 'w', parseCastlingFromFen(MIDDLEGAME))).toBe('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1');
  });
});

describe('From Position: the ordinary engine plays from the FEN', () => {
  it('Black to move: only Black can move, and the first move is Black\'s with the right number', () => {
    const engine = new ChessEngine(BLACK_TO_MOVE_EP, { initialFen: BLACK_TO_MOVE_EP });
    expect(engine.getTurn()).toBe('b');
    expect(engine.getLegalMoves('e7').sort()).toEqual(['e5', 'e6']);
    expect(engine.getLegalMoves('e4')).toEqual([]); // a White pawn: not its turn
    const move = engine.move('e7', 'e5');
    expect(move?.san).toBe('e5');
    expect(engine.getTurn()).toBe('w');
    // Black's move number is 1 (the FEN's), White's reply is move 2; chess.js writes no en passant square when no pawn could capture on it.
    expect(engine.getFen()).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  });

  it('keeps the move numbers of the FEN (fullmove 3 -> the PGN movetext continues at 3)', () => {
    const history = replaySanTokens(MIDDLEGAME, false, ['Bb5', 'a6']);
    expect(history?.map((h) => h.move.san)).toEqual(['Bb5', 'a6']);
    expect(history?.[1].fenAfter).toBe('r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4');
  });

  it('the fifty-move rule counts from the halfmove clock of the FEN (98 -> draw after two more plies)', () => {
    const engine = new ChessEngine('4k3/8/8/8/8/8/R7/4K3 w - - 98 80', { initialFen: '4k3/8/8/8/8/8/R7/4K3 w - - 98 80' });
    expect(engine.getStatus()).toBe('playing');
    engine.move('a2', 'a3');
    expect(engine.getStatus()).toBe('playing');
    engine.move('e8', 'd8');
    expect(engine.getStatus()).toBe('draw');
  });

  it('castling rights of the FEN are honoured: O-O is legal with K, not without it', () => {
    const withRight = new ChessEngine('r3k2r/8/8/8/8/8/8/R3K2R w K - 0 1', { initialFen: 'r3k2r/8/8/8/8/8/8/R3K2R w K - 0 1' });
    expect(withRight.getLegalMoves('e1')).toContain('g1');
    expect(withRight.getLegalMoves('e1')).not.toContain('c1');
    const without = new ChessEngine('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1', { initialFen: 'r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1' });
    expect(without.getLegalMoves('e1')).not.toContain('g1');
  });

  it('threefold repetition is counted from the starting FEN: the start position occurring a third time ends the game', () => {
    const plies = ['Ra3', 'Kd8', 'Ra2', 'Ke8', 'Ra3', 'Kd8', 'Ra2', 'Ke8'];
    const history = replaySanTokens(ROOK_ENDGAME, false, plies);
    expect(history).not.toBeNull();
    expect(isRepetitionDraw(ROOK_ENDGAME, history!.slice(0, 7))).toBe(false);
    expect(isRepetitionDraw(ROOK_ENDGAME, history!)).toBe(true);
  });
});

describe('From Position: PGN / history round trip', () => {
  const play = (fen: string, sans: string[]) => {
    const history = replaySanTokens(fen, false, sans);
    if (!history) throw new Error('replay failed');
    return history;
  };

  it('buildPgn writes [SetUp "1"] and [FEN "..."] and numbers a black-to-move start as "n..."', () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';
    const pgn = buildPgn(fen, play(fen, ['a6', 'Ba4', 'Nf6']), '*');
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain(`[FEN "${fen}"]`);
    expect(pgn).toContain('3...a6 4.Ba4 Nf6');
  });

  it('a classical start writes no SetUp / FEN tags', () => {
    expect(buildPgn(START_FEN, play(START_FEN, ['e4']), '*')).not.toContain('[FEN');
  });

  it('parsePgn (import) and replayPgn (history replay) read the FEN back: same start, same moves, same final FEN', () => {
    for (const [fen, sans] of [
      [MIDDLEGAME, ['Bb5', 'a6', 'Ba4', 'Nf6']],
      [BLACK_TO_MOVE_EP, ['e5', 'Nf3', 'Nc6']],
      ['4k3/8/8/8/8/8/R7/4K3 w - - 37 61', ['Ra3', 'Kd8']],
    ] as const) {
      const history = play(fen, [...sans]);
      const pgn = buildPgn(fen, history, '*');

      const parsed = parsePgn(pgn);
      expect(parsed.ok, fen).toBe(true);
      if (parsed.ok) {
        expect(parsed.parsed.initialFen, fen).toBe(fen);
        expect(parsed.parsed.history.map((h) => h.move.san), fen).toEqual([...sans]);
        expect(parsed.parsed.history[sans.length - 1].fenAfter, fen).toBe(history[sans.length - 1].fenAfter);
      }

      const replayed = replayPgn(pgn, false);
      expect(replayed?.initialFen, fen).toBe(fen);
      expect(replayed?.history.map((h) => h.move.san), fen).toEqual([...sans]);
      expect(replayed?.history[sans.length - 1].fenAfter, fen).toBe(history[sans.length - 1].fenAfter);
    }
  });

  it('buildGamePayload (the saved game) carries the FEN tags and no variant tag', () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1';
    const history = play(fen, ['Ra8#']);
    const payload = buildGamePayload({
      chessStatus: 'checkmate',
      turn: 'b',
      timeoutWinner: null,
      history,
      initialFen: fen,
      chess960: false,
      timeControl: { category: 'blitz', label: '5 min', initialSeconds: 300, incrementSeconds: 0 } as never,
      opponentType: 'human',
    });
    expect(payload?.result).toBe('1-0');
    expect(payload?.pgn).toContain(`[FEN "${fen}"]`);
    expect(payload?.pgn).toContain('[SetUp "1"]');
    expect(payload?.pgn).not.toContain('[Variant');
    expect(payload?.isChess960).toBe(false);
  });
});
