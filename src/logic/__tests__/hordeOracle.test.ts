import { describe, expect, it } from 'vitest';
// DEV/TEST-ONLY dependency: chessops is GPL-3.0-or-later and lives in devDependencies, used here as an independent
// oracle for Horde's rules (lichess's implementation). It must NEVER be imported from any file that ships in the app
// bundle or the backend — only from tests like this one.
import { makeFen, parseFen } from 'chessops/fen';
import { parseUci } from 'chessops/util';
import { Horde } from 'chessops/variant';
import { ChessEngine } from '../ChessEngine';
import { HORDE_FIRST_RANK_DOUBLE_STEP_ALLOWS_EN_PASSANT, HORDE_START_FEN, getHordeMoves, getHordeWinnerFromFen } from '../horde';

/**
 * Differential tests: this repo's Horde (src/logic/horde.ts + ChessEngine's `horde` option, on top of chess.js) against
 * chessops's `Horde` class, over random games from the start position and a set of hand-picked positions. At every
 * ply the LEGAL MOVE SET, the resulting piece placement/turn/castling, and the game-over state (checkmate, stalemate,
 * Black capturing everything) must agree.
 *
 * THE ONE KNOWN, DELIBERATE DIVERGENCE: after a White pawn double-steps from RANK 1 (rank 1 -> 3), chessops/lichess
 * does not let Black capture it en passant, while chess.com's documentation says only "en passant captures are
 * allowed" — so this app follows the rule as stated (see HORDE_FIRST_RANK_DOUBLE_STEP_ALLOWS_EN_PASSANT). The test
 * allows exactly that difference — only the en passant capture, only right after such a step — and nothing else.
 */

type OpsPosition = ReturnType<typeof Horde.default>;
const opsFromFen = (fen: string): OpsPosition => Horde.fromSetup(parseFen(fen).unwrap()).unwrap();
const squareName = (i: number) => 'abcdefgh'[i & 7] + ((i >> 3) + 1);

/** chessops reports castling as king->own-rook; this repo uses the king's two-square step. */
function opsKeys(pos: OpsPosition): string[] {
  const keys: string[] = [];
  for (const [from, dests] of pos.allDests()) {
    const role = pos.board.getRole(from);
    for (const to of dests) {
      const target = pos.board.get(to);
      if (role === 'king' && target && target.color === pos.turn && target.role === 'rook') {
        const rank = from >> 3;
        keys.push(squareName(from) + squareName(rank * 8 + ((to & 7) > (from & 7) ? 6 : 2)));
      } else if (role === 'pawn' && (to >> 3 === 7 || to >> 3 === 0)) {
        for (const p of 'qrbn') keys.push(squareName(from) + squareName(to) + p);
      } else {
        keys.push(squareName(from) + squareName(to));
      }
    }
  }
  return keys.sort();
}
const myKeys = (engine: ChessEngine) => getHordeMoves(engine).map((m) => `${m.from}${m.to}${m.promotion ?? ''}`).sort();

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Compares one position; returns a description of an UNEXPECTED difference, or null. */
function compareLegalMoves(fen: string, lastWasRankOneDoubleStep: boolean): string | null {
  const mine = myKeys(new ChessEngine(fen, { horde: true }));
  const theirs = opsKeys(opsFromFen(fen));
  if (mine.join() === theirs.join()) return null;
  const mineOnly = mine.filter((k) => !theirs.includes(k));
  const theirsOnly = theirs.filter((k) => !mine.includes(k));
  const epSquare = fen.split(' ')[3];
  const allowedDivergence =
    HORDE_FIRST_RANK_DOUBLE_STEP_ALLOWS_EN_PASSANT &&
    lastWasRankOneDoubleStep &&
    theirsOnly.length === 0 &&
    mineOnly.length > 0 &&
    epSquare !== '-' &&
    mineOnly.every((k) => k.slice(2, 4) === epSquare);
  return allowedDivergence ? null : `legal moves differ at ${fen}: only mine ${mineOnly}, only chessops ${theirsOnly}`;
}

describe('Horde against the chessops oracle', () => {
  it('agrees on the start position: the same eight moves', () => {
    expect(myKeys(new ChessEngine(HORDE_START_FEN, { horde: true }))).toEqual(opsKeys(opsFromFen(HORDE_START_FEN)));
  });

  it('agrees on hand-picked positions (double steps, blocked double steps, promotion, mate, stalemate, castling)', () => {
    const fens = [
      '4k3/8/8/8/8/8/8/4P3 w - - 0 1', // rank-1 double step available
      '4k3/8/8/8/8/4p3/8/4P3 w - - 0 1', // blocked on rank 3
      '4k3/8/8/8/8/8/4p3/4P3 w - - 0 1', // blocked on rank 2
      'rnbqkbnr/pppppppp/8/8/8/8/8/PPPPPPPP w kq - 0 1', // a whole first-rank horde
      '4k3/P7/8/8/8/8/8/8 w - - 0 1', // promotion
      '1r2k3/P7/8/8/8/8/8/8 w - - 0 1', // capturing promotion
      '4k3/8/8/8/8/8/p7/4P3 b - - 0 1', // Black promotion
      'r3k2r/8/8/8/8/8/8/4P3 b kq - 0 1', // Black castling
      'kb6/pP6/8/8/8/8/8/1R6 b - - 0 1', // pawn mate
      'R5k1/5ppp/8/8/8/8/8/8 b - - 0 1', // back-rank mate
      'k7/8/1Q6/8/8/8/8/8 b - - 0 1', // Black stalemate
      '4k3/8/8/8/8/p7/P7/8 w - - 0 1', // White stalemate
    ];
    for (const fen of fens) {
      expect(compareLegalMoves(fen, false), fen).toBeNull();
      const mine = new ChessEngine(fen, { horde: true });
      const ops = opsFromFen(fen);
      const outcome = ops.outcome();
      expect(mine.isGameOver() || getHordeWinnerFromFen(fen) !== null, `game over at ${fen}`).toBe(outcome !== undefined);
    }
  });

  it('agrees ply by ply over random games: legal moves, resulting position and how the game ends', () => {
    const endings: Record<string, number> = {};
    let plies = 0;
    let divergences = 0;
    for (let game = 0; game < 14; game++) {
      const random = seeded(4000 + game);
      let fen = HORDE_START_FEN;
      let lastWasRankOneDoubleStep = false;
      for (let ply = 0; ply < 110; ply++) {
        const engine = new ChessEngine(fen, { horde: true });
        const ops = opsFromFen(fen);
        plies++;

        const problem = compareLegalMoves(fen, lastWasRankOneDoubleStep);
        expect(problem, `game ${game} ply ${ply}`).toBeNull();
        if (myKeys(engine).join() !== opsKeys(ops).join()) divergences++;

        const outcome = ops.outcome();
        const myWinner = getHordeWinnerFromFen(fen);
        expect(engine.isGameOver() || myWinner !== null, `game over at ${fen}`).toBe(outcome !== undefined);
        if (outcome) {
          const key = myWinner ? 'black takes everything' : engine.getStatus() === 'checkmate' ? 'white mates' : engine.getStatus();
          endings[key] = (endings[key] ?? 0) + 1;
          // The winner agrees as well.
          if (outcome.winner === 'white') expect(engine.getStatus()).toBe('checkmate');
          if (outcome.winner === 'black') expect(myWinner ?? engine.getStatus()).toBe('b' === myWinner ? 'b' : 'checkmate');
          if (outcome.winner === undefined) expect(['stalemate', 'draw']).toContain(engine.getStatus());
          break;
        }

        const keys = myKeys(engine);
        // Play from the INTERSECTION so both sides can follow the same move, then compare the results.
        const common = keys.filter((k) => opsKeys(ops).includes(k));
        const key = common[Math.floor(random() * common.length)];
        const piece = engine.getPieceAt(key.slice(0, 2));
        lastWasRankOneDoubleStep = piece?.type === 'p' && piece.color === 'w' && key[1] === '1' && key[3] === '3';
        expect(engine.move(key.slice(0, 2), key.slice(2, 4), key[4] as 'q' | undefined), `${key} from ${fen}`).not.toBeNull();
        ops.play(parseUci(key)!);

        const mineFen = engine.getFen().split(' ');
        const theirFen = makeFen(ops.toSetup()).split(' ');
        expect(mineFen[0], `placement after ${key} from ${fen}`).toBe(theirFen[0]);
        expect(mineFen[1]).toBe(theirFen[1]);
        expect(mineFen[2]).toBe(theirFen[2]);
        fen = engine.getFen();
      }
    }
    expect(plies).toBeGreaterThan(900);
    // Checkmate and stalemate really occurred, so the ending checks above were exercised.
    expect(Object.values(endings).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  }, 180_000);
});
