import { describe, expect, it } from 'vitest';
import {
  applyAtomicMove,
  generateAtomicMoves,
  getAtomicKingWinner,
  squareName,
  type AtomicMove,
  type AtomicPosition,
} from '../atomic';
import { chooseAtomicBotMove } from '../bots';
import { ChessEngine } from '../ChessEngine';
import { START_FEN } from '../../types/chess';

const atomicEngine = (fen: string) => new ChessEngine(fen, { atomic: true });

function seededRng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const key = (m: { from: string; to: string; promotion?: string }) => `${m.from}${m.to}${m.promotion ?? ''}`;
const atomicKey = (m: AtomicMove) => key({ from: squareName(m.from), to: squareName(m.to), promotion: m.promotion });

/** Whether the side to move in `pos` has a move that explodes the enemy king. */
function canExplodeKing(pos: AtomicPosition): boolean {
  return generateAtomicMoves(pos).some((m) => getAtomicKingWinner(applyAtomicMove(pos, m).position) !== null);
}

describe('chooseAtomicBotMove', () => {
  it('returns null when the bot has no legal move (the game is already over)', () => {
    expect(chooseAtomicBotMove(atomicEngine('k7/p7/P7/8/8/8/8/1R5K b - - 0 1'), 1500)).toBeNull(); // stalemate
  });

  it('takes a king explosion whenever it is searched for, at every ELO (the Stockfish-cannot-do-this case)', () => {
    // Qd1xd7 blows up the black king on e8.
    const engine = atomicEngine('4k3/3p4/8/8/8/8/8/3QK3 w - - 0 1');
    for (const elo of [400, 1000, 1600, 2400, 3000]) {
      expect(key(chooseAtomicBotMove(engine, elo, () => 0)!), `elo ${elo}`).toBe('d1d7');
    }
  });

  it('never plays a move that lets the opponent explode its king when a safe move exists', () => {
    // Walk capture-heavy random positions and ask the bot (always taking its searched branch) for a move.
    const random = seededRng(11);
    let checked = 0;
    for (let game = 0; game < 12; game++) {
      let engine = atomicEngine(START_FEN);
      for (let ply = 0; ply < 80 && !engine.isGameOver(); ply++) {
        const pos = engine.getAtomicPosition();
        const moves = generateAtomicMoves(pos);
        const safe = moves.filter((m) => {
          const after = applyAtomicMove(pos, m).position;
          return !getAtomicKingWinner(after) && !canExplodeKing(after);
        });
        const wins = moves.some((m) => getAtomicKingWinner(applyAtomicMove(pos, m).position));
        if (safe.length > 0 && !wins) {
          const choice = chooseAtomicBotMove(engine, 800, () => 0)!; // depth 1 is the weakest searching setting
          const chosen = moves.find((m) => atomicKey(m) === key(choice))!;
          const after = applyAtomicMove(pos, chosen).position;
          expect(canExplodeKing(after), `${engine.getFen()} -> ${key(choice)}`).toBe(false);
          checked++;
        }
        const captures = moves.filter((m) => m.enPassant || pos.squares[m.to] !== 0);
        const pool = captures.length > 0 && random() < 0.5 ? captures : moves;
        const pick = pool[Math.floor(random() * pool.length)];
        const next = atomicEngine(engine.getFen());
        next.move(squareName(pick.from), squareName(pick.to), pick.promotion ?? 'q');
        engine = atomicEngine(next.getFen());
      }
    }
    expect(checked).toBeGreaterThan(200);
  }, 60000);

  it('ELO is the strength dial: the searched best move is chosen far more often at 3000 than at 400', () => {
    const engine = atomicEngine('4k3/3p4/8/8/8/8/8/3QK3 w - - 0 1');
    const frequency = (elo: number) => {
      let best = 0;
      for (let i = 0; i < 200; i++) if (key(chooseAtomicBotMove(engine, elo, seededRng(i * 7 + elo))!) === 'd1d7') best++;
      return best / 200;
    };
    expect(frequency(3000)).toBeGreaterThan(frequency(400) + 0.3);
    expect(frequency(3000)).toBeGreaterThan(0.8);
  });

  it('always plays legal moves, including when it gambles on a random one', () => {
    const engine = atomicEngine('r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5');
    const legal = new Set(generateAtomicMoves(engine.getAtomicPosition()).map(atomicKey));
    for (let i = 0; i < 80; i++) {
      const choice = chooseAtomicBotMove(engine, 400 + (i % 5) * 600, seededRng(i));
      expect(legal.has(key(choice!))).toBe(true);
    }
  });

  it('stays within a sane time budget at the strongest setting on a busy middlegame', () => {
    const engine = atomicEngine('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    const start = performance.now();
    chooseAtomicBotMove(engine, 3000, () => 0);
    // Typically ~0.1s here; the bound is generous because phones run this through Hermes, several times slower.
    expect(performance.now() - start).toBeLessThan(2500);
  });
});

describe('bot-vs-bot Atomic games always stay legal and terminate', () => {
  it('two bots of different ELO play full games without ever making an illegal move', () => {
    let finished = 0;
    let kingExplosions = 0;
    for (let g = 0; g < 6; g++) {
      const random = seededRng(500 + g);
      let engine = atomicEngine(START_FEN);
      for (let ply = 0; ply < 300; ply++) {
        if (engine.isGameOver()) {
          finished++;
          if (getAtomicKingWinner(engine.getAtomicPosition())) kingExplosions++;
          break;
        }
        const elo = engine.getTurn() === 'w' ? 800 : 1500;
        const choice = chooseAtomicBotMove(engine, elo, random);
        expect(choice).not.toBeNull();
        const next = atomicEngine(engine.getFen());
        expect(next.move(choice!.from, choice!.to, choice!.promotion), `${engine.getFen()} -> ${key(choice!)}`).not.toBeNull();
        engine = atomicEngine(next.getFen());
      }
    }
    expect(finished).toBeGreaterThan(0);
    expect(kingExplosions).toBeGreaterThan(0);
  }, 120000);
});
