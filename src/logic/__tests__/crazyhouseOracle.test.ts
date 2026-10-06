import { describe, expect, it } from 'vitest';
// DEV/TEST-ONLY dependency: chessops is GPL-3.0-or-later and lives in devDependencies, used here as an independent
// oracle for Crazyhouse's rules (lichess's implementation). It must NEVER be imported from any file that ships in the app
// bundle or the backend — only from tests like this one.
import { makeFen, parseFen } from 'chessops/fen';
import { parseUci } from 'chessops/util';
import { Crazyhouse } from 'chessops/variant';
import { START_FEN } from '../../types/chess';
import { ChessEngine } from '../ChessEngine';
import { RESERVE_PIECE_TYPES, initialCrazyhouseState, type CrazyhouseState, type ReservePieceType } from '../crazyhouse';

/**
 * Differential tests: this repo's Crazyhouse (crazyhouse.ts + ChessEngine's `crazyhouse` option, on top of chess.js)
 * against chessops's `Crazyhouse`, over random games from the start position and hand-picked positions. At every ply the
 * legal MOVES, the legal DROPS, the RESERVES, the set of PROMOTED squares and the game-over verdict must agree.
 *
 * KNOWN, DELIBERATE DIVERGENCE: chessops ends the game on "insufficient material" (e.g. bare kings with empty pockets);
 * this app never does (chess.com's documentation names no such rule, and the fifty-move rule still ends a dead position).
 * The test accepts exactly that difference — chessops calling a game over by insufficient material while this engine plays on.
 */

type OpsPosition = ReturnType<typeof Crazyhouse.default>;
const ROLES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' } as const;
const opsFromFen = (fen: string): OpsPosition => Crazyhouse.fromSetup(parseFen(fen).unwrap()).unwrap();
const squareName = (i: number) => 'abcdefgh'[i & 7] + ((i >> 3) + 1);
const squareIndex = (name: string) => 'abcdefgh'.indexOf(name[0]) + 8 * (Number(name[1]) - 1);

function opsMoveKeys(pos: OpsPosition): string[] {
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

/** Every legal drop in chessops, found by asking isLegal for each (role in the pocket) × (square). */
function opsDropKeys(pos: OpsPosition): string[] {
  const keys: string[] = [];
  const pocket = pos.pockets?.[pos.turn];
  if (!pocket) return keys;
  for (const letter of RESERVE_PIECE_TYPES) {
    if (!pocket[ROLES[letter]]) continue;
    for (let sq = 0; sq < 64; sq++) {
      if (pos.board.has(sq)) continue;
      if (pos.isLegal({ role: ROLES[letter], to: sq })) keys.push(`${letter.toUpperCase()}@${squareName(sq)}`);
    }
  }
  return keys.sort();
}

function myMoveKeys(engine: ChessEngine): string[] {
  const keys: string[] = [];
  const turn = engine.getTurn();
  for (const s of engine.getBoard().flat()) {
    if (s.piece?.color !== turn) continue;
    for (const to of new Set(engine.getLegalMoves(s.square))) {
      const lastRank = (turn === 'w' && to[1] === '8') || (turn === 'b' && to[1] === '1');
      if (s.piece.type === 'p' && lastRank) for (const p of 'qrbn') keys.push(`${s.square}${to}${p}`);
      else keys.push(`${s.square}${to}`);
    }
  }
  return keys.sort();
}
const myDropKeys = (engine: ChessEngine) => engine.getLegalDrops().map((d) => `${d.piece.toUpperCase()}@${d.square}`).sort();

function stateMatches(mine: CrazyhouseState, pos: OpsPosition): string | null {
  for (const color of ['w', 'b'] as const) {
    for (const letter of RESERVE_PIECE_TYPES) {
      const theirs = pos.pockets?.[color === 'w' ? 'white' : 'black'][ROLES[letter]] ?? 0;
      if (mine.reserve[color][letter] !== theirs) return `reserve ${color}${letter}: mine ${mine.reserve[color][letter]} vs chessops ${theirs}`;
    }
  }
  const theirPromoted = [...pos.board.promoted].map(squareName).sort();
  if (mine.promoted.join() !== theirPromoted.join()) return `promoted squares: mine ${mine.promoted} vs chessops ${theirPromoted}`;
  return null;
}

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The board part of a FEN with chessops's promotion marks and pockets removed. */
const placementOnly = (fen: string) => fen.split(' ')[0].replace(/\[.*\]/, '').replace(/~/g, '');

describe('Crazyhouse against the chessops oracle', () => {
  it('agrees on the start position: no drops, the same twenty moves', () => {
    const engine = new ChessEngine(START_FEN, { crazyhouse: true });
    const ops = opsFromFen(START_FEN);
    expect(myMoveKeys(engine)).toEqual(opsMoveKeys(ops));
    expect(myDropKeys(engine)).toEqual([]);
    expect(opsDropKeys(ops)).toEqual([]);
  });

  it('agrees on drop legality in hand-picked positions (free board, blocking a check, no drop against a knight or double check, pawn ranks)', () => {
    const cases: { fen: string; state: CrazyhouseState }[] = [];
    const withReserve = (white: Partial<Record<ReservePieceType, number>>, black: Partial<Record<ReservePieceType, number>> = {}): CrazyhouseState => {
      const state = initialCrazyhouseState();
      Object.assign(state.reserve.w, white);
      Object.assign(state.reserve.b, black);
      return state;
    };
    const all = { p: 2, n: 1, b: 1, r: 1, q: 1 };
    cases.push({ fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', state: withReserve(all) }); // nothing in the way
    cases.push({ fen: '4k3/8/8/8/8/8/8/r3K3 w - - 0 1', state: withReserve(all) }); // rook check along rank 1: block on b1-d1
    cases.push({ fen: '4k3/8/8/8/8/8/8/4K2r w - - 0 1', state: withReserve(all) }); // block on f1,g1
    cases.push({ fen: '4k3/8/8/8/1b6/8/8/4K3 w - - 0 1', state: withReserve(all) }); // bishop check on the diagonal
    cases.push({ fen: '4k3/8/8/8/8/3n4/8/4K3 w - - 0 1', state: withReserve(all) }); // knight check: no drop
    cases.push({ fen: '4k3/8/8/8/8/8/3p4/4K3 w - - 0 1', state: withReserve(all) }); // pawn check: no drop
    cases.push({ fen: '4k3/8/8/8/8/8/8/r3K2r w - - 0 1', state: withReserve(all) }); // double check: no drop
    cases.push({ fen: '4k3/8/8/8/8/8/4q3/4K3 w - - 0 1', state: withReserve(all) }); // adjacent queen: no block possible
    cases.push({ fen: '4k3/8/8/8/8/8/8/4K3 b - - 0 1', state: withReserve({}, all) }); // Black to drop
    cases.push({ fen: 'r3k3/8/8/8/8/8/8/4K3 b - - 0 1', state: withReserve({}, all) }); // Black not in check
    for (const { fen, state } of cases) {
      const engine = new ChessEngine(fen, { crazyhouse: true, crazyhouseState: state });
      const ops = opsFromFen(`${fen.split(' ')[0]}[${(['w', 'b'] as const).map((c) => RESERVE_PIECE_TYPES.map((t) => (c === 'w' ? t.toUpperCase() : t).repeat(state.reserve[c][t])).join('')).join('')}] ${fen.split(' ').slice(1).join(' ')}`);
      expect(myDropKeys(engine), fen).toEqual(opsDropKeys(ops));
      expect(myMoveKeys(engine), fen).toEqual(opsMoveKeys(ops));
    }
  });

  it('agrees ply by ply over random games: moves, drops, reserves, promoted squares and how the game ends', () => {
    const stats = { plies: 0, drops: 0, captures: 0, promotions: 0, promotedCaptures: 0, ended: 0, insufficient: 0 };
    for (let game = 0; game < 10; game++) {
      const random = seeded(7000 + game);
      let fen = START_FEN;
      let state = initialCrazyhouseState();
      let ops = opsFromFen(START_FEN);
      for (let ply = 0; ply < 130; ply++) {
        const engine = new ChessEngine(fen, { crazyhouse: true, crazyhouseState: state });
        stats.plies++;

        const myMoves = myMoveKeys(engine);
        const myDrops = myDropKeys(engine);
        expect(myMoves, `moves at ${fen} (${makeFen(ops.toSetup())})`).toEqual(opsMoveKeys(ops));
        expect(myDrops, `drops at ${fen} (${makeFen(ops.toSetup())})`).toEqual(opsDropKeys(ops));
        expect(stateMatches(state, ops), `state at ${fen}`).toBeNull();

        const outcome = ops.outcome();
        const status = engine.getStatus();
        if (outcome) {
          if (ops.isInsufficientMaterial() && !ops.isCheckmate() && !ops.isStalemate()) {
            stats.insufficient++; // the documented divergence: this app plays on
            expect(engine.isGameOver()).toBe(false);
            break;
          }
          stats.ended++;
          expect(engine.isGameOver(), `game over at ${fen}`).toBe(true);
          expect(status).toBe(outcome.winner ? 'checkmate' : status === 'draw' ? 'draw' : 'stalemate');
          break;
        }
        expect(engine.isGameOver(), `not over at ${fen}`).toBe(false);

        const all = [...myMoves, ...myDrops];
        // Bias toward drops, promotions and captures of promoted pieces so the rare paths actually get exercised.
        const promotions = myMoves.filter((k) => k.length === 5);
        const hitsPromoted = myMoves.filter((k) => state.promoted.includes(k.slice(2, 4)));
        const preferred =
          hitsPromoted.length > 0 && random() < 0.8
            ? hitsPromoted
            : promotions.length > 0 && random() < 0.6
              ? promotions
              : random() < 0.45 && myDrops.length > 0
                ? myDrops
                : all;
        const key = preferred[Math.floor(random() * preferred.length)];

        let move;
        if (key.includes('@')) {
          move = engine.drop(key[0].toLowerCase() as ReservePieceType, key.slice(2));
          stats.drops++;
        } else {
          move = engine.move(key.slice(0, 2), key.slice(2, 4), key[4] as 'q' | undefined);
          if (move?.captured) stats.captures++;
          if (move?.promotion) stats.promotions++;
          if (move?.captured && state.promoted.includes(key.slice(2, 4))) stats.promotedCaptures++;
        }
        expect(move, `${key} from ${fen}`).not.toBeNull();
        ops.play(parseUci(key)!);

        state = engine.getCrazyhouseState();
        fen = engine.getFen();
        expect(placementOnly(makeFen(ops.toSetup())), `placement after ${key}`).toBe(placementOnly(fen));
        expect(makeFen(ops.toSetup()).split(' ')[1]).toBe(fen.split(' ')[1]);
        expect(makeFen(ops.toSetup()).split(' ')[2]).toBe(fen.split(' ')[2]); // castling rights: flags, never re-derived
        // The SAN a drop prints: "N@f3", with the check suffix.
        if (key.includes('@')) expect(move!.san.replace(/[+#]$/, '')).toBe(key);
      }
    }
    // The run really exercised the machinery.
    expect(stats.drops).toBeGreaterThan(100);
    expect(stats.captures).toBeGreaterThan(100);
    expect(stats.promotions).toBeGreaterThan(5);
    expect(stats.promotedCaptures).toBeGreaterThan(3);
  }, 240_000);
});
