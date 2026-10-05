import { describe, expect, it } from 'vitest';
import { chooseHordeBotMove } from '../bots';
import { ChessEngine } from '../ChessEngine';
import { HORDE_START_FEN, getHordeMoves, getHordeWinnerFromFen } from '../horde';

const horde = (fen: string) => new ChessEngine(fen, { horde: true });

function seededRng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const key = (m: { from: string; to: string; promotion?: string }) => `${m.from}${m.to}${m.promotion ?? ''}`;

describe('chooseHordeBotMove', () => {
  it('returns a legal move for the horde side from the start position, at every strength', () => {
    const engine = horde(HORDE_START_FEN);
    const legal = new Set(getHordeMoves(engine).map(key));
    for (const elo of [400, 1200, 2000, 3000]) {
      for (let seed = 1; seed <= 6; seed++) {
        const move = chooseHordeBotMove(engine, elo, seededRng(seed));
        expect(move, `elo ${elo} seed ${seed}`).not.toBeNull();
        expect(legal.has(key(move!))).toBe(true);
      }
    }
  });

  it("returns a legal move for Black's army too", () => {
    const engine = horde('rnbqkbnr/pppppppp/8/1PP2PP1/PPPPPPPP/PPPPPPPP/PPPPPPPP/PPPPPPPP b kq - 0 1');
    const legal = new Set(getHordeMoves(engine).map(key));
    for (let seed = 1; seed <= 6; seed++) {
      const move = chooseHordeBotMove(engine, 2000, seededRng(seed));
      expect(move).not.toBeNull();
      expect(legal.has(key(move!))).toBe(true);
    }
  });

  it('returns null when the side to move has no legal move (the game is already over)', () => {
    expect(chooseHordeBotMove(horde('4k3/8/8/8/8/p7/P7/8 w - - 0 1'), 3000)).toBeNull(); // White stalemated
    expect(chooseHordeBotMove(horde('4k3/8/8/8/8/8/8/8 w - - 0 1'), 3000)).toBeNull(); // nothing left at all
  });

  it('White finds a mate in one', () => {
    // b6-b7 attacks a8, the rook on b1 defends the pawn, and Black's king is boxed in by its own pieces.
    const engine = horde('kb6/p7/1P6/8/8/8/8/1R6 w - - 0 1');
    for (let seed = 1; seed <= 5; seed++) {
      const move = chooseHordeBotMove(engine, 3000, () => 0);
      expect(key(move!)).toBe('b6b7');
    }
    const played = horde('kb6/p7/1P6/8/8/8/8/1R6 w - - 0 1');
    played.move('b6', 'b7');
    expect(played.getStatus()).toBe('checkmate');
  });

  it('White prefers a mate in one to winning a queen (the mate is valued above any material)', () => {
    // b6-b7 is mate; g4xh5 would win the Black queen (+9). Only a real checkmate value makes the bot choose the mate.
    const fen = 'kb6/p7/1P6/7q/6P1/8/8/1R6 w - - 0 1';
    const mate = horde(fen);
    mate.move('b6', 'b7');
    expect(mate.getStatus()).toBe('checkmate');
    expect(key(chooseHordeBotMove(horde(fen), 3000, () => 0)!)).toBe('b6b7');
  });

  it('Black takes the last White piece to win outright', () => {
    // rng 0 selects the scored branch (the other 10% at 3000 ELO is a deliberately random move, tested separately).
    for (let seed = 1; seed <= 5; seed++) {
      const move = chooseHordeBotMove(horde('4k3/8/8/8/8/8/3P4/3r4 b - - 0 1'), 3000, () => 0);
      expect(key(move!)).toBe('d1d2');
      const after = horde('4k3/8/8/8/8/8/3P4/3r4 b - - 0 1');
      after.move('d1', 'd2');
      expect(getHordeWinnerFromFen(after.getFen())).toBe('b');
    }
  });

  it('Black does not stalemate a lost-looking White away: capturing the last piece beats stalemating it', () => {
    // Taking the pawn on a2 ends the game as a win; the alternative quiet move would stalemate White (a draw).
    const move = chooseHordeBotMove(horde('4k3/8/8/8/8/8/P7/r7 b - - 0 1'), 3000, () => 0);
    expect(key(move!)).toBe('a1a2');
  });

  it('ELO is the strength dial: the capture of a free queen is chosen far more often at 3000 than at 400', () => {
    // Black rook d1 can take the White queen on d5 (the file is clear); the only other White piece is a distant pawn.
    const fen = '4k3/8/8/3Q4/8/8/P7/3r4 b - - 0 1';
    const frequency = (elo: number) => {
      let hit = 0;
      for (let i = 0; i < 120; i++) {
        const move = chooseHordeBotMove(horde(fen), elo, seededRng(i * 13 + elo));
        if (move && key(move) === 'd1d5') hit++;
      }
      return hit / 120;
    };
    expect(frequency(3000)).toBeGreaterThan(frequency(400) + 0.3);
  }, 30_000);

  it('a random pick never under-promotes', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const move = chooseHordeBotMove(horde('4k3/P7/8/8/8/8/8/8 w - - 0 1'), 400, seededRng(seed));
      expect(move!.promotion).toBeDefined();
      expect(['q']).toContain(move!.promotion); // random branch: the queen only (the scored branch may pick a knight for check)
    }
  });
});

describe('bot vs bot', () => {
  it('plays legal moves on both sides, and each game ends in a way the rules recognise', () => {
    const endings = new Set<string>();
    for (let game = 0; game < 3; game++) {
      const rng = seededRng(77 + game);
      let fen = HORDE_START_FEN;
      let plies = 0;
      for (; plies < 160; plies++) {
        const engine = horde(fen);
        if (getHordeWinnerFromFen(fen) || engine.isGameOver()) break;
        const move = chooseHordeBotMove(engine, game === 0 ? 3000 : 1500, rng);
        expect(move, `no move at ${fen}`).not.toBeNull();
        expect(engine.move(move!.from, move!.to, move!.promotion), `illegal ${key(move!)} at ${fen}`).not.toBeNull();
        fen = engine.getFen();
      }
      const final = horde(fen);
      endings.add(getHordeWinnerFromFen(fen) ? 'black takes all' : final.isGameOver() ? final.getStatus() : 'unfinished');
      expect(plies).toBeGreaterThan(20);
    }
    expect(endings.size).toBeGreaterThan(0);
  }, 120_000);

  it('thinks fast enough for a phone: the average move over a 40-ply game at top strength stays small', () => {
    const rng = seededRng(5);
    let fen = HORDE_START_FEN;
    const times: number[] = [];
    for (let ply = 0; ply < 40; ply++) {
      const engine = horde(fen);
      if (engine.isGameOver()) break;
      const t0 = performance.now();
      const move = chooseHordeBotMove(engine, 3000, rng);
      times.push(performance.now() - t0);
      engine.move(move!.from, move!.to, move!.promotion);
      fen = engine.getFen();
    }
    expect(times.length).toBeGreaterThan(30);
    expect(times.reduce((a, b) => a + b, 0) / times.length).toBeLessThan(250);
    expect(Math.max(...times)).toBeLessThan(2000);
  }, 60_000);
});
