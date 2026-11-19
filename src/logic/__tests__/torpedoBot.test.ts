import { describe, expect, it } from 'vitest';
import { chooseTorpedoBotMove } from '../bots';
import { ChessEngine } from '../ChessEngine';
import { TORPEDO_START_FEN, getTorpedoMoves } from '../torpedo';

const torpedo = (fen: string) => new ChessEngine(fen, { torpedo: true });

function seededRng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const key = (m: { from: string; to: string; promotion?: string }) => `${m.from}${m.to}${m.promotion ?? ''}`;

describe('chooseTorpedoBotMove', () => {
  it('returns a legal move from the start position for both colours, at every strength', () => {
    for (const fen of [TORPEDO_START_FEN, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1']) {
      const engine = torpedo(fen);
      const legal = new Set(getTorpedoMoves(engine).map(key));
      for (const elo of [400, 1200, 2000, 3000]) {
        for (let seed = 1; seed <= 6; seed++) {
          const move = chooseTorpedoBotMove(engine, elo, seededRng(seed));
          expect(move, `elo ${elo} seed ${seed}`).not.toBeNull();
          expect(legal.has(key(move!))).toBe(true);
        }
      }
    }
  });

  it('returns null when the side to move has no legal move (the game is already over)', () => {
    expect(chooseTorpedoBotMove(torpedo('7K/r7/8/8/1k6/7P/8/b5r1 w - - 0 1'), 3000)).toBeNull(); // checkmated
    expect(chooseTorpedoBotMove(torpedo('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), 3000)).toBeNull(); // stalemated
  });

  it('plays the one move that saves it: the double step that blocks the check', () => {
    const engine = torpedo('7K/r7/8/8/1k6/4P3/8/b5r1 w - - 0 1');
    expect(key(chooseTorpedoBotMove(engine, 3000, () => 0)!)).toBe('e3e5');
    expect(key(chooseTorpedoBotMove(engine, 400, () => 0.99)!)).toBe('e3e5');
  });

  it('finds a mate in one', () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1';
    expect(key(chooseTorpedoBotMove(torpedo(fen), 3000, () => 0)!)).toBe('a1a8');
    const played = torpedo(fen);
    played.move('a1', 'a8');
    expect(played.getStatus()).toBe('checkmate');
  });

  it('takes a hanging queen rather than a quiet move', () => {
    const free = torpedo('4k3/8/8/8/3q4/4P3/8/4K3 w - - 0 1'); // exd4
    expect(key(chooseTorpedoBotMove(free, 3000, () => 0)!)).toBe('e3d4');
  });

  it('promotes to a queen (never under-promotes) when it chooses a double-step promotion', () => {
    const engine = torpedo('8/7k/4P3/8/8/8/8/K7 w - - 0 1');
    const move = chooseTorpedoBotMove(engine, 3000, () => 0);
    expect(move?.from).toBe('e6');
    expect(['e7', 'e8']).toContain(move?.to);
    if (move?.to === 'e8') expect(move.promotion).toBe('q');
  });

  it('plays 4 seeded bot-versus-bot games without ever choosing an illegal move, and the double step really occurs', () => {
    let doubleSteps = 0;
    let plies = 0;
    for (let game = 0; game < 4; game++) {
      const rng = seededRng(500 + game);
      let fen = TORPEDO_START_FEN;
      for (let ply = 0; ply < 60; ply++) {
        const engine = torpedo(fen);
        if (engine.isGameOver()) break;
        const legal = new Set(getTorpedoMoves(engine).map(key));
        const move = chooseTorpedoBotMove(engine, ply % 2 === 0 ? 2500 : 900, rng);
        expect(move).not.toBeNull();
        expect(legal.has(key(move!))).toBe(true);
        const piece = engine.getPieceAt(move!.from);
        if (piece?.type === 'p' && move!.from[0] === move!.to[0] && Math.abs(Number(move!.to[1]) - Number(move!.from[1])) === 2) doubleSteps++;
        expect(engine.move(move!.from, move!.to, move!.promotion)).not.toBeNull();
        fen = engine.getFen();
        plies++;
      }
    }
    expect(plies).toBeGreaterThan(100);
    expect(doubleSteps).toBeGreaterThan(3);
  });
});
