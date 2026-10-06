import { describe, expect, it } from 'vitest';
import { chooseCrazyhouseBotMove, type CrazyhouseBotChoice } from '../bots';
import { ChessEngine } from '../ChessEngine';
import { getCrazyhouseMoves, initialCrazyhouseState, type CrazyhouseState } from '../crazyhouse';
import { START_FEN } from '../../types/chess';

const crazyhouse = (fen: string, state: CrazyhouseState = initialCrazyhouseState()) => new ChessEngine(fen, { crazyhouse: true, crazyhouseState: state });
const reserves = (white: Partial<CrazyhouseState['reserve']['w']>, black: Partial<CrazyhouseState['reserve']['b']> = {}): CrazyhouseState => {
  const state = initialCrazyhouseState();
  Object.assign(state.reserve.w, white);
  Object.assign(state.reserve.b, black);
  return state;
};

function seededRng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Applies a bot choice the way BotGameScreen does; null when the engine refuses it. */
function play(engine: ChessEngine, choice: CrazyhouseBotChoice) {
  return choice.type === 'drop' ? engine.drop(choice.piece, choice.square) : engine.move(choice.move.from, choice.move.to, choice.move.promotion);
}

describe('chooseCrazyhouseBotMove', () => {
  it('returns a legal move from the start position at every strength', () => {
    const engine = crazyhouse(START_FEN);
    const legal = new Set(getCrazyhouseMoves(engine).map((m) => `${m.from}${m.to}${m.promotion ?? ''}`));
    for (const elo of [400, 1200, 2000, 3000]) {
      for (let seed = 1; seed <= 6; seed++) {
        const choice = chooseCrazyhouseBotMove(engine, elo, seededRng(seed));
        expect(choice, `elo ${elo} seed ${seed}`).not.toBeNull();
        expect(choice!.type).toBe('move'); // empty reserves: nothing to drop
        if (choice && choice.type === 'move') expect(legal.has(`${choice.move.from}${choice.move.to}${choice.move.promotion ?? ''}`)).toBe(true);
      }
    }
  });

  it('returns null when the side to move has no legal turn at all (checkmated, or stalemated with an empty reserve)', () => {
    expect(chooseCrazyhouseBotMove(crazyhouse('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'), 3000)).toBeNull(); // fool's mate
    expect(chooseCrazyhouseBotMove(crazyhouse('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), 3000)).toBeNull(); // Black stalemated, reserve empty
  });

  it('a stalemated side that holds a piece still has a turn: it drops', () => {
    const engine = crazyhouse('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', reserves({}, { p: 1 }));
    const choice = chooseCrazyhouseBotMove(engine, 3000, seededRng(1));
    expect(choice).not.toBeNull();
    expect(choice!.type).toBe('drop');
    if (choice && choice.type === 'drop') expect(engine.getLegalDropSquares(choice.piece)).toContain(choice.square);
  });

  it('finds a mate in one with an ordinary move', () => {
    const engine = crazyhouse('k7/8/1K6/8/8/8/8/7R w - - 0 1');
    for (let seed = 1; seed <= 5; seed++) {
      const choice = chooseCrazyhouseBotMove(engine, 3000, () => 0);
      expect(choice).toEqual({ type: 'move', move: expect.objectContaining({ from: 'h1', to: 'h8' }) });
    }
  });

  it('finds a mate in one by DROPPING a piece', () => {
    // Black's king is boxed in by its own pawns: any queen on the 8th rank is mate.
    const engine = crazyhouse('7k/6pp/8/8/8/8/8/4K3 w - - 0 1', reserves({ q: 1 }));
    const choice = chooseCrazyhouseBotMove(engine, 3000, () => 0);
    expect(choice).not.toBeNull();
    expect(choice!.type).toBe('drop');
    const after = crazyhouse('7k/6pp/8/8/8/8/8/4K3 w - - 0 1', reserves({ q: 1 }));
    expect(play(after, choice!)).not.toBeNull();
    expect(after.getStatus()).toBe('checkmate');
  });

  it('does not walk into a mate by drop: it keeps the back rank guarded while Black holds a queen', () => {
    // Back-rank pattern: White's rook on a1 is the only thing that stops Q@e1#. Any rook move off the first rank (and several
    // others) would allow it; a bot that ignores the opponent's reserve would not notice.
    const fen = '6k1/8/8/8/8/8/5PPP/R5K1 w - - 0 1';
    for (const rng of [() => 0, () => 0.1, () => 0.3]) {
      const choice = chooseCrazyhouseBotMove(crazyhouse(fen, reserves({}, { q: 1 })), 3000, rng)!;
      const after = crazyhouse(fen, reserves({}, { q: 1 }));
      expect(play(after, choice)).not.toBeNull();
      const matedByDrop = after.getLegalDrops().some((d) => {
        const probe = crazyhouse(after.getFen(), after.getCrazyhouseState());
        probe.drop(d.piece, d.square);
        return probe.getStatus() === 'checkmate';
      });
      expect(matedByDrop, JSON.stringify(choice)).toBe(false);
    }
  });

  it('takes a free queen', () => {
    const engine = crazyhouse('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1');
    expect(chooseCrazyhouseBotMove(engine, 3000, () => 0)).toEqual({ type: 'move', move: expect.objectContaining({ from: 'd1', to: 'd5' }) });
  });

  it('a random-branch pick is still legal and never an under-promotion', () => {
    const engine = crazyhouse('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', reserves({ n: 1 }));
    const legalDrops = new Set(engine.getLegalDrops().map((d) => `${d.piece}@${d.square}`));
    for (let seed = 1; seed <= 40; seed++) {
      const choice = chooseCrazyhouseBotMove(engine, 400, seededRng(seed))!; // ELO 400: mostly the random branch
      if (choice.type === 'move') {
        expect(['q', 'n', undefined]).toContain(choice.move.promotion === 'q' ? 'q' : choice.move.promotion);
        expect(choice.move.promotion === 'r' || choice.move.promotion === 'b').toBe(false);
      } else {
        expect(legalDrops.has(`${choice.piece}@${choice.square}`)).toBe(true);
      }
    }
  });

  it('plays whole games: every choice is applied by the engine, only on its own turn, and games with captures fill reserves', () => {
    let drops = 0;
    let captures = 0;
    for (const [seed, whiteElo, blackElo] of [[11, 3000, 1200], [12, 1200, 3000], [13, 2000, 2000]] as const) {
      const rng = seededRng(seed);
      let fen = START_FEN;
      let state = initialCrazyhouseState();
      for (let ply = 0; ply < 70; ply++) {
        const engine = crazyhouse(fen, state);
        if (engine.isGameOver()) break;
        const choice = chooseCrazyhouseBotMove(engine, engine.getTurn() === 'w' ? whiteElo : blackElo, rng);
        expect(choice, `seed ${seed} ply ${ply}`).not.toBeNull();
        const turn = engine.getTurn();
        const played = play(engine, choice!);
        expect(played, `seed ${seed} ply ${ply}: ${JSON.stringify(choice)}`).not.toBeNull();
        expect(engine.getTurn()).not.toBe(turn);
        if (choice!.type === 'drop') drops++;
        else if (played!.captured) captures++;
        fen = engine.getFen();
        state = engine.getCrazyhouseState();
      }
    }
    expect(captures).toBeGreaterThan(5);
    expect(drops).toBeGreaterThan(0);
  }, 120_000);

  it('decides within a reasonable time even when both reserves are full of pieces (a hundred-plus candidate drops)', () => {
    const engine = crazyhouse('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', reserves({ p: 2, n: 2, b: 1, r: 1, q: 1 }, { p: 2, n: 1, b: 1, r: 1, q: 1 }));
    expect(engine.getLegalDrops().length).toBeGreaterThan(100);
    const started = Date.now();
    const choice = chooseCrazyhouseBotMove(engine, 3000, seededRng(7));
    const elapsed = Date.now() - started;
    expect(choice).not.toBeNull();
    expect(elapsed).toBeLessThan(3000);
  });
});
