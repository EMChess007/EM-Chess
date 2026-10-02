import { describe, expect, it } from 'vitest';
import { chooseGiveawayBotMove } from '../bots';
import { ChessEngine } from '../ChessEngine';
import { getGiveawayMoves, getGiveawayWinner } from '../giveaway';
import { START_FEN } from '../../types/chess';

const giveawayEngine = (fen: string) => new ChessEngine(fen, { skipValidation: true, giveaway: true });

function seededRng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('chooseGiveawayBotMove', () => {
  it('returns null when the bot has no legal move (the game is already over)', () => {
    expect(chooseGiveawayBotMove(giveawayEngine('8/8/8/8/p7/P7/8/8 b - - 0 1'), 1500)).toBeNull();
  });

  it('plays the only legal move without gambling on randomness', () => {
    const engine = giveawayEngine('4k3/8/8/3p4/4P3/8/8/R3K3 w - - 0 1'); // e4xd5 is forced
    const choice = chooseGiveawayBotMove(engine, 400, () => 0.99);
    expect(`${choice?.from}${choice?.to}`).toBe('e4d5');
  });

  it('never breaks mandatory capture, at any ELO and with any random draw (the Stockfish problem)', () => {
    const engine = giveawayEngine('4k3/8/8/3p4/4P3/8/8/R3K3 w - - 0 1');
    for (const elo of [400, 1200, 2000, 3000]) {
      for (let i = 0; i < 40; i++) {
        const choice = chooseGiveawayBotMove(engine, elo, seededRng(i * 31 + elo));
        expect(choice?.captured, `elo ${elo} seed ${i}`).toBeTruthy();
      }
    }
  });

  it('strong setting reliably feeds material: prefers the move that hands the opponent a piece to take', () => {
    // Lone white rook a1; black pawn b3 attacks a2 and c2. Moving the rook to a2 offers it for
    // capture — the aim in Giveaway is to LOSE material, so that is the best-scoring move.
    const engine = giveawayEngine('8/7p/8/8/8/1p6/8/R7 w - - 0 1');
    const choice = chooseGiveawayBotMove(engine, 3000, () => 0); // rng 0 => always take the best-scoring branch
    expect(`${choice?.from}${choice?.to}`).toBe('a1a2');
  });

  it('avoids a move that leaves the opponent with no legal move (that would hand them the win)', () => {
    // Black's lone pawn a4 can still advance to a3. White's pawn a2-a3 would block it for good, so
    // Black (to move, no legal move) would WIN — the one move the bot must not play. The free rook
    // supplies plenty of harmless alternatives.
    const engine = giveawayEngine('8/8/8/8/p7/8/P7/7R w - - 0 1');
    expect(getGiveawayMoves(engine).some((m) => m.from === 'a2' && m.to === 'a3')).toBe(true);
    for (const elo of [1500, 3000]) {
      const choice = chooseGiveawayBotMove(engine, elo, () => 0);
      expect(`${choice?.from}${choice?.to}`, `elo ${elo}`).not.toBe('a2a3');
    }
  });

  it('weak settings still play legal moves but are not always the heuristic best', () => {
    const engine = giveawayEngine('8/7p/8/8/8/1p6/8/R7 w - - 0 1');
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const choice = chooseGiveawayBotMove(engine, 400, seededRng(i));
      seen.add(`${choice!.from}${choice!.to}`);
      expect(getGiveawayMoves(engine).some((m) => m.from === choice!.from && m.to === choice!.to)).toBe(true);
    }
    expect(seen.size).toBeGreaterThan(1); // varied play, not one fixed move
  });
});

describe('bot-vs-bot Giveaway games always stay legal and terminate', () => {
  it('two bots of different ELO play full games without ever making an illegal move', () => {
    let finished = 0;
    for (let g = 0; g < 8; g++) {
      const random = seededRng(900 + g);
      let engine = giveawayEngine(START_FEN);
      for (let ply = 0; ply < 300; ply++) {
        if (getGiveawayWinner(engine)) {
          finished++;
          break;
        }
        const elo = engine.getTurn() === 'w' ? 800 : 2800;
        const choice = chooseGiveawayBotMove(engine, elo, random);
        expect(choice).not.toBeNull();
        const legal = getGiveawayMoves(engine).some(
          (m) => m.from === choice!.from && m.to === choice!.to && m.promotion === choice!.promotion
        );
        expect(legal).toBe(true);
        const next = giveawayEngine(engine.getFen());
        expect(next.movePseudoLegal(choice!.from, choice!.to, choice!.promotion)).not.toBeNull();
        engine = giveawayEngine(next.getFen());
      }
    }
    expect(finished).toBeGreaterThan(0);
  }, 60000);
});
