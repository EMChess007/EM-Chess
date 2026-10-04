import { describe, expect, it } from 'vitest';
import { chooseDuckBotMove } from '../bots';
import { ChessEngine } from '../ChessEngine';
import { getLegalDuckPlacementSquares } from '../duckChess';
import { START_FEN } from '../../types/chess';

const duckEngine = (fen: string, duckSquare: string | null = null) => new ChessEngine(fen, { skipValidation: true, duckChess: true, duckSquare });

function seededRng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded stream whose FIRST draw selects the bot's searched branch (not its ELO-driven random gamble). */
function searchedBranchRng(seed: number) {
  const rest = seededRng(seed);
  let first = true;
  return () => {
    if (first) {
      first = false;
      return 0.01;
    }
    return rest();
  };
}

/** Whether the side to move in `fen` (with the duck on `duck`) can capture a king. */
function kingCapturable(fen: string, duck: string | null): boolean {
  const e = duckEngine(fen, duck);
  return e.getPseudoLegalMoves(e.getTurn()).some((m) => m.captured === 'k');
}

describe('chooseDuckBotMove', () => {
  it('returns null when the bot has no regular move (a blockade)', () => {
    expect(chooseDuckBotMove(duckEngine('8/8/8/8/8/8/4P3/8 w - - 0 1', 'e3'), 1500)).toBeNull();
  });

  it('takes the enemy king whenever it can — the game is over, so no duck is placed', () => {
    const engine = duckEngine('k7/8/8/8/8/8/8/R3K3 w - - 0 1', 'h4');
    for (const elo of [1000, 2000, 3000]) {
      const turn = chooseDuckBotMove(engine, elo, () => 0);
      expect(turn?.move.captured, `elo ${elo}`).toBe('k');
      expect(turn?.duck).toBeNull();
    }
  });

  it('uses the duck to block the line to its own king', () => {
    // Black's Re8 attacks the white king on e1 along the open e-file; White also has a free a-pawn move.
    const engine = duckEngine('4r2k/8/8/8/8/8/P7/4K3 w - - 0 1', 'h4');
    for (let seed = 0; seed < 25; seed++) {
      const turn = chooseDuckBotMove(engine, 3000, searchedBranchRng(seed * 13 + 1));
      expect(turn).not.toBeNull();
      // Whatever it played, the king must not be capturable once the duck is down.
      const after = duckEngine('4r2k/8/8/8/8/8/P7/4K3 w - - 0 1', 'h4');
      after.movePseudoLegal(turn!.move.from, turn!.move.to, turn!.move.promotion);
      expect(kingCapturable(after.getFen(), turn!.duck), `seed ${seed}: ${turn!.move.san} @${turn!.duck}`).toBe(false);
    }
  });

  it('always names a legal duck square: empty, and not the one the duck already stands on', () => {
    const random = seededRng(9);
    let engine = duckEngine(START_FEN, null);
    let duck: string | null = null;
    for (let ply = 0; ply < 60; ply++) {
      const turn = chooseDuckBotMove(duckEngine(engine.getFen(), duck), 400 + (ply % 4) * 800, random);
      if (!turn) break;
      const mover = duckEngine(engine.getFen(), duck);
      expect(mover.movePseudoLegal(turn.move.from, turn.move.to, turn.move.promotion), `${turn.move.from}${turn.move.to}`).not.toBeNull();
      if (turn.move.captured === 'k') {
        expect(turn.duck).toBeNull();
        break;
      }
      expect(turn.duck).not.toBeNull();
      expect(getLegalDuckPlacementSquares(mover, duck)).toContain(turn.duck);
      engine = duckEngine(mover.getFen(), turn.duck);
      duck = turn.duck;
    }
  });

  it('ELO is the strength dial: the capture of a free queen is chosen far more often at 3000 than at 400', () => {
    const fen = '7k/8/8/3q4/8/8/8/R2RK3 w - - 0 1'; // the white rook d1 can take the queen on d5 (a free queen)
    const frequency = (elo: number) => {
      let hit = 0;
      for (let i = 0; i < 150; i++) {
        const turn = chooseDuckBotMove(duckEngine(fen, 'a5'), elo, seededRng(i * 7 + elo));
        if (turn?.move.from === 'd1' && turn.move.to === 'd5') hit++;
      }
      return hit / 150;
    };
    expect(frequency(3000)).toBeGreaterThan(frequency(400) + 0.3);
  });

  it('bot-vs-bot games stay legal and end by a king capture or a blockade', () => {
    let kingCaptures = 0;
    for (let g = 0; g < 6; g++) {
      const random = seededRng(700 + g);
      let fen = START_FEN;
      let duck: string | null = null;
      for (let ply = 0; ply < 250; ply++) {
        const engine = duckEngine(fen, duck);
        const elo = engine.getTurn() === 'w' ? 800 : 1500;
        const turn = chooseDuckBotMove(engine, elo, random);
        if (!turn) break; // blockade
        const mover = duckEngine(fen, duck);
        expect(mover.movePseudoLegal(turn.move.from, turn.move.to, turn.move.promotion)).not.toBeNull();
        if (turn.move.captured === 'k') {
          kingCaptures++;
          break;
        }
        fen = mover.getFen();
        duck = turn.duck;
      }
    }
    expect(kingCaptures).toBeGreaterThan(0);
  }, 120000);
});
