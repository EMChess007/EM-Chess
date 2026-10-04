import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  atomicFen,
  atomicPositionKey,
  generateAtomicMoves,
  getAtomicKingWinner,
  getAtomicMoves,
  getAtomicStatus,
  getAtomicWinner,
  isAtomicThreefoldRepetition,
  parseAtomicFen,
} from '../atomic';
import { ChessEngine } from '../ChessEngine';
import { buildGamePayload } from '../gamePayload';
import { parsePgn } from '../pgnImport';
import { replayPgn } from '../pgnReplay';
import { START_FEN } from '../../types/chess';

// Every Atomic engine is built like this: the option forces skipValidation itself (a finished game's
// FEN has no king for the loser, which chess.js's strict loader rejects).
const atomicEngine = (fen: string) => new ChessEngine(fen, { atomic: true });
const ordinaryEngine = (fen: string) => new ChessEngine(fen, { skipValidation: true });
const uci = (engine: ChessEngine) => getAtomicMoves(engine).map((m) => `${m.from}${m.to}${m.promotion ?? ''}`).sort();
const placement = (engine: ChessEngine) => engine.getFen().split(' ')[0];
const castlingField = (engine: ChessEngine) => engine.getFen().split(' ')[2];

describe('explosions', () => {
  // White Rd4 takes the pawn on d5; Black has a knight on c6 (next to d5) and a pawn on e6 (also next to d5).
  const FEN = '4k3/8/2n1p3/3p4/3R4/8/8/4K3 w - - 0 1';

  it('removes the capturer, the captured piece and every non-pawn neighbour — but not neighbouring pawns', () => {
    const engine = atomicEngine(FEN);
    const move = engine.move('d4', 'd5');
    expect(move?.captured).toBe('p');
    // Only the kings and the surviving e6 pawn are left: rook, d5 pawn and the c6 knight are gone.
    expect(placement(engine)).toBe('4k3/8/4p3/8/8/8/8/4K3');
    expect(move?.exploded?.map((e) => `${e.piece.color}${e.piece.type}@${e.square}`).sort()).toEqual(['bn@c6', 'bp@d5', 'wr@d5']);
  });

  it('a non-capturing move carries no explosion', () => {
    const move = atomicEngine(START_FEN).move('e2', 'e4');
    expect(move?.exploded).toBeUndefined();
    expect(move?.captured).toBeUndefined();
  });

  it('en passant: the blast is centred on the LANDING square, and the captured pawn is removed too', () => {
    // White e5xd6 e.p. lands on d6. The knight on c7 touches d6 (blown up); the bishop on c4 touches only
    // the captured pawn's square d5 (survives).
    const engine = atomicEngine('7k/2n5/8/3pP3/2b5/8/8/K7 w - d6 0 1');
    const move = engine.move('e5', 'd6');
    expect(move?.captured).toBe('p');
    expect(placement(engine)).toBe('7k/8/8/8/2b5/8/8/K7');
    expect(move?.exploded?.map((e) => `${e.piece.type}@${e.square}`).sort()).toEqual(['n@c7', 'p@d5', 'p@d6']);
  });

  it('a pawn is the one piece a blast cannot destroy (unless it is the capturer or the captured piece)', () => {
    const engine = atomicEngine('4k3/8/8/2ppp3/3N4/8/8/4K3 w - - 0 1');
    // Nd4 attacks c6, e6, b5, f5, b3, f3, c2, e2 — none is a capture here; use a rook instead.
    expect(getAtomicMoves(engine, 'd4').some((m) => m.captured)).toBe(false);
    const rook = atomicEngine('4k3/8/2np4/3p4/3R4/8/8/4K3 w - - 0 1');
    rook.move('d4', 'd5');
    expect(placement(rook)).toBe('4k3/8/3p4/8/8/8/8/4K3'); // c6 knight gone, d6 pawn survives
  });
});

describe('kings', () => {
  it('a king can never capture (it would blow itself up)', () => {
    const engine = atomicEngine('4k3/8/8/8/8/8/3pr3/3QK3 w - - 0 1');
    expect(engine.getLegalMoves('e1')).not.toContain('d2');
    expect(engine.getLegalMoves('e1')).not.toContain('e2');
  });

  it('a move whose blast would reach your OWN king is illegal', () => {
    // Qd1xd2 would explode e1; Qd1xe2 would too.
    const moves = uci(atomicEngine('4k3/8/8/8/8/8/3pr3/3QK3 w - - 0 1'));
    expect(moves).not.toContain('d1d2');
    expect(moves).not.toContain('d1e2');
  });

  it('exploding the enemy king wins on the spot — even while your own king is in check', () => {
    // White Ke1 is in check from the rook on e8, but Qd4xg7 blows up the black king on h8.
    const engine = atomicEngine('4r2k/6p1/8/8/3Q4/8/8/4K3 w - - 0 1');
    expect(engine.getStatus()).toBe('check');
    expect(engine.getLegalMoves('d4')).toContain('g7');
    const move = engine.move('d4', 'g7');
    expect(move?.san).toBe('Qxg7#');
    expect(getAtomicWinner(engine)).toBe('w');
    expect(engine.isGameOver()).toBe(true);
    expect(getAtomicMoves(engine)).toEqual([]); // nothing left to play
  });

  it('kings may stand next to each other and are then never in check — chess.js says the opposite', () => {
    // Black rook a5 "attacks" e5 along the rank; the h2 pawn keeps the material sufficient (K+R vs K is a draw).
    const adjacent = '8/8/8/r2kK3/8/8/7p/8 w - - 0 1';
    expect(atomicEngine(adjacent).getStatus()).toBe('playing');
    expect(ordinaryEngine(adjacent).getStatus()).toBe('check'); // documents the divergence this file exists for
    // Same rook, kings far apart: a genuine check.
    expect(atomicEngine('8/8/8/r3K3/8/8/p7/7k w - - 0 1').getStatus()).toBe('check');
  });

  it('a king may step next to the enemy king even onto an attacked square', () => {
    // White Kf6 vs black Kh7... black king moves to g6/g7? g7 is adjacent to f6, so Rg1's file attack is moot.
    const engine = atomicEngine('7k/8/5K2/8/8/8/8/6R1 b - - 0 1');
    expect(engine.getLegalMoves('h8')).toContain('g7'); // attacked by Rg1, but next to the white king
  });
});

describe('checkmate, stalemate and draws (judged against Atomic\'s own legal moves)', () => {
  it('back-rank mate is checkmate', () => {
    const engine = atomicEngine('R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1');
    expect(engine.getStatus()).toBe('checkmate');
    expect(engine.isGameOver()).toBe(true);
  });

  it('with the kings touching there is no check, so no mate', () => {
    const status = atomicEngine('6k1/5Kpp/8/8/8/8/8/R7 b - - 0 1').getStatus();
    expect(status).not.toBe('checkmate');
    expect(status).not.toBe('check');
  });

  it('no legal move and not in check is stalemate (a draw)', () => {
    // Black Ka8, pawn a7 blocked by the white a6 pawn, Rb1 covers b7/b8; nothing attacks a8.
    const engine = atomicEngine('k7/p7/P7/8/8/8/8/1R5K b - - 0 1');
    expect(engine.getStatus()).toBe('stalemate');
    expect(engine.isGameOver()).toBe(true);
  });

  it('applies the 50-move rule from the halfmove clock', () => {
    expect(atomicEngine('4k3/8/8/8/8/8/4P3/R3K3 w - - 99 80').getStatus()).toBe('playing');
    expect(atomicEngine('4k3/8/8/8/8/8/4P3/R3K3 w - - 100 80').getStatus()).toBe('draw');
  });

  it("uses Atomic's own insufficient-material rule", () => {
    expect(atomicEngine('4k3/8/8/8/8/8/8/4K3 w - - 0 1').getStatus()).toBe('draw'); // bare kings
    expect(atomicEngine('4k3/8/8/8/8/8/8/R3K3 w - - 0 1').getStatus()).toBe('draw'); // a lone rook cannot mate
    expect(atomicEngine('4k3/8/8/8/8/8/8/Q3K3 w - - 0 1').getStatus()).toBe('playing'); // a queen can
  });

  it("follows lichess's scalachess rule where it differs from chessops (see TESTING.md §7)", () => {
    // Closed pawn positions are dead: kings cannot capture and no pawn can move or take anything...
    expect(atomicEngine('4k3/8/8/1p6/1P3K2/8/8/8 w - - 0 1').getStatus()).toBe('draw');
    // ...but a pawn that can still advance keeps the game alive.
    expect(atomicEngine('4k3/8/8/8/1P3K2/8/8/8 w - - 0 1').getStatus()).toBe('playing');
    // K + two same-coloured bishops vs a bare king cannot mate (both on light squares here)...
    expect(atomicEngine('7k/8/8/1B6/4B3/7K/8/8 w - - 0 1').getStatus()).toBe('draw');
    // ...whereas bishops on opposite colours can (the dark d4 bishop here).
    expect(atomicEngine('7k/8/8/1B6/3B4/7K/8/8 w - - 0 1').getStatus()).toBe('playing');
    // Two same-coloured bishops vs an opposite-coloured bishop: a help-mate exists, so play goes on.
    expect(atomicEngine('5K2/5k2/8/8/1b2B3/8/6B1/8 w - - 0 1').getStatus()).toBe('playing');
    // K+B vs K+B: opposite-coloured bishops can never meet (dead); same-coloured ones can explode each other.
    expect(atomicEngine('4k3/8/8/8/8/8/8/B3K2b w - - 0 1').getStatus()).toBe('draw'); // a1 dark vs h1 light
    expect(atomicEngine('4k3/8/8/8/8/8/8/B3K1b1 w - - 0 1').getStatus()).toBe('playing'); // a1 dark vs g1 dark
    // A bishop that CAN capture a blocked pawn keeps a closed-looking position alive; one that never can does not.
    expect(atomicEngine('7k/8/8/8/3p4/3P4/8/B3K3 w - - 0 1').getStatus()).toBe('playing'); // Ba1 reaches the d4 pawn
    expect(atomicEngine('7k/8/8/3p4/3P4/8/8/B3K3 w - - 0 1').getStatus()).toBe('draw'); // d5 is a colour it can never touch
    // K+N vs K+N is not dead (the knights can explode each other); K+2N vs K is; K+3N vs K is not.
    expect(atomicEngine('4k3/8/8/8/8/8/8/N3K2n w - - 0 1').getStatus()).toBe('playing');
    expect(atomicEngine('4k3/8/8/8/8/8/8/N2NK3 w - - 0 1').getStatus()).toBe('draw');
    expect(atomicEngine('4k3/8/8/8/8/8/8/N1NNK3 w - - 0 1').getStatus()).toBe('playing');
  });
});

describe('castling', () => {
  const BOTH = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

  it('is offered both ways and moves the rook, clearing that side\'s rights', () => {
    const engine = atomicEngine(BOTH);
    expect(engine.getLegalMoves('e1')).toEqual(expect.arrayContaining(['g1', 'c1']));
    const short = atomicEngine(BOTH);
    expect(short.move('e1', 'g1')?.san).toBe('O-O');
    expect(placement(short)).toBe('r3k2r/8/8/8/8/8/8/R4RK1');
    expect(castlingField(short)).toBe('kq');
    const long = atomicEngine(BOTH);
    expect(long.move('e1', 'c1')?.san).toBe('O-O-O');
    expect(placement(long)).toBe('r3k2r/8/8/8/8/8/8/2KR3R');
  });

  it('a rook that is EXPLODED (not captured) loses its castling right', () => {
    const engine = atomicEngine('4k3/8/8/8/8/8/6p1/4KB1R w K - 0 1');
    expect(castlingField(engine)).toBe('K');
    engine.move('f1', 'g2'); // Bxg2 blows up the h1 rook next door
    expect(castlingField(engine)).toBe('-');
  });

  it('is not allowed out of check or through an attacked square', () => {
    expect(atomicEngine('4r2k/8/8/8/8/8/8/R3K2R w KQ - 0 1').getLegalMoves('e1')).not.toContain('g1');
    const throughF1 = atomicEngine('5r1k/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    expect(throughF1.getLegalMoves('e1')).not.toContain('g1');
    expect(throughF1.getLegalMoves('e1')).toContain('c1');
  });

  it("squares next to the enemy king count as safe, so you may castle 'through' them", () => {
    // Rg8 attacks g1, but the black king on f2 touches g1 — so O-O is legal here...
    expect(atomicEngine('6r1/8/8/8/8/8/5k2/4K2R w K - 0 1').getLegalMoves('e1')).toContain('g1');
    // ...and illegal when the black king is far away.
    expect(atomicEngine('6r1/8/8/8/8/8/k7/4K2R w K - 0 1').getLegalMoves('e1')).not.toContain('g1');
  });
});

describe('promotion', () => {
  it('a quiet promotion needs a piece and keeps it', () => {
    const missing = atomicEngine('8/4P2k/8/8/8/8/8/K7 w - - 0 1');
    expect(missing.move('e7', 'e8')).toBeNull();
    const engine = atomicEngine('8/4P2k/8/8/8/8/8/K7 w - - 0 1');
    expect(engine.move('e7', 'e8', 'n')?.san).toBe('e8=N');
    expect(placement(engine)).toBe('4N3/7k/8/8/8/8/8/K7');
  });

  it('a promoting capture explodes the new piece, so every choice gives the same board', () => {
    const results = (['q', 'r', 'b', 'n'] as const).map((p) => {
      const engine = atomicEngine('5r1k/4P3/8/8/8/8/8/K7 w - - 0 1');
      const move = engine.move('e7', 'f8', p);
      expect(move).not.toBeNull();
      return engine.getFen();
    });
    expect(new Set(results).size).toBe(1);
    expect(results[0].split(' ')[0]).toBe('7k/8/8/8/8/8/8/K7');
  });
});

describe('SAN, computed under Atomic\'s rules', () => {
  it('uses standard notation for ordinary moves, pawn captures and en passant', () => {
    expect(atomicEngine(START_FEN).move('g1', 'f3')?.san).toBe('Nf3');
    expect(atomicEngine('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1').move('e4', 'd5')?.san).toBe('exd5');
    expect(atomicEngine('7k/2n5/8/3pP3/2b5/8/8/K7 w - d6 0 1').move('e5', 'd6')?.san).toBe('exd6');
  });

  it('disambiguates from the Atomic legal set', () => {
    const fen = '4k3/8/8/R7/8/8/8/R3K3 w - - 0 1';
    expect(atomicEngine(fen).move('a1', 'a3')?.san).toBe('R1a3');
    expect(atomicEngine(fen).move('a5', 'a3')?.san).toBe('R5a3');
  });

  it("marks check '+' and checkmate '#', and an exploded enemy king '#'", () => {
    expect(atomicEngine('4k3/8/8/8/8/8/8/R3K3 w - - 0 1').move('a1', 'a8')?.san).toBe('Ra8+');
    expect(atomicEngine('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1').move('a1', 'a8')?.san).toBe('Ra8#');
    expect(atomicEngine('4k3/3p4/8/8/8/8/8/3QK3 w - - 0 1').move('d1', 'd7')?.san).toBe('Qxd7#');
  });

  it('does not mark a "check" the Atomic rules do not recognise (kings touching)', () => {
    // Re1-e8?? with the kings adjacent after the move there is no check by Atomic's rules.
    const engine = atomicEngine('8/8/8/8/8/3k4/8/R2K4 w - - 0 1'); // kings d1/d3 are two apart, rook a1
    const move = engine.move('d1', 'e2'); // Ke2 next to Kd3
    expect(move?.san).toBe('Ke2');
  });
});

describe('FEN, undo and reload', () => {
  it('the position after a move round-trips through FEN, including en passant and castling rights', () => {
    const engine = atomicEngine(START_FEN);
    engine.move('e2', 'e4');
    const fen = engine.getFen();
    expect(fen).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    expect(atomicFen(parseAtomicFen(fen))).toBe(fen);
    expect(atomicEngine(fen).getTurn()).toBe('b');
  });

  it('a kingless final position loads without throwing (skipValidation is implied)', () => {
    const engine = atomicEngine('7k/8/8/8/8/8/8/8 w - - 0 1');
    expect(getAtomicWinner(engine)).toBe('b');
    expect(engine.getBoard().flat().filter((s) => s.piece).length).toBe(1);
  });

  it('undo is a FEN restore: replaying the same move from the earlier FEN gives the same result', () => {
    const start = atomicEngine('4k3/8/2n1p3/3p4/3R4/8/8/4K3 w - - 0 1');
    const before = start.getFen();
    const first = start.move('d4', 'd5');
    const again = atomicEngine(before).move('d4', 'd5');
    expect(again?.san).toBe(first?.san);
    expect(atomicEngine(before).getFen()).toBe(before);
  });

  it('leaves non-Atomic engines completely alone', () => {
    const ordinary = new ChessEngine(START_FEN);
    expect(ordinary.getLegalMoves('e2')).toEqual(['e3', 'e4']);
    expect(ordinary.move('e2', 'e4')?.exploded).toBeUndefined();
    // chess.js's own rules still apply: here the king may capture the unprotected rook (Atomic forbids it).
    expect(new ChessEngine('4k3/8/8/8/8/8/3pr3/3QK3 w - - 0 1', { skipValidation: true }).getLegalMoves('e1')).toContain('e2');
  });
});

describe('threefold repetition (Atomic only, derived from the history)', () => {
  const shuffle = (plies: number) => {
    const engine = atomicEngine(START_FEN);
    const fens = [engine.getFen()];
    const moves: [string, string][] = [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8']];
    for (let i = 0; i < plies; i++) {
      const [from, to] = moves[i % 4];
      engine.move(from, to);
      fens.push(engine.getFen());
    }
    return fens;
  };

  it('fires on the third occurrence of the position, not before', () => {
    expect(isAtomicThreefoldRepetition(shuffle(7))).toBe(false);
    expect(isAtomicThreefoldRepetition(shuffle(8))).toBe(true);
  });

  it('is correct after Undo: dropping the last position takes the draw away again', () => {
    expect(isAtomicThreefoldRepetition(shuffle(8).slice(0, -1))).toBe(false);
  });

  it('ignores an en passant square nobody can use, but not one that can be captured', () => {
    const noCapturer = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    expect(atomicPositionKey(noCapturer)).toBe(atomicPositionKey(noCapturer.replace(' e3 ', ' - ')));
    const withCapturer = 'rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 2';
    expect(atomicPositionKey(withCapturer)).not.toBe(atomicPositionKey(withCapturer.replace(' e3 ', ' - ')));
  });
});

describe('game-level integration', () => {
  it('a king-exploded win reports the winner through atomic.ts', () => {
    const engine = atomicEngine('4k3/3p4/8/8/8/8/8/3QK3 w - - 0 1');
    expect(getAtomicKingWinner(parseAtomicFen(engine.getFen()))).toBeNull();
    engine.move('d1', 'd7');
    expect(getAtomicWinner(engine)).toBe('w');
  });

  it('saved games are tagged [Variant "Atomic"], and replay/import refuse them', () => {
    const engine = atomicEngine(START_FEN);
    const history = [{ move: engine.move('e2', 'e4')!, fenBefore: START_FEN, fenAfter: engine.getFen() }];
    const payload = buildGamePayload({
      chessStatus: 'playing',
      turn: 'b',
      timeoutWinner: null,
      atomicWinner: 'w',
      atomic: true,
      history,
      initialFen: START_FEN,
      chess960: false,
      timeControl: { label: 'Unlimited', category: 'unlimited' } as never,
      opponentType: 'human',
    });
    expect(payload?.result).toBe('1-0');
    expect(payload?.pgn).toContain('[Variant "Atomic"]');
    expect(replayPgn(payload!.pgn, false)).toBeNull();
    const imported = parsePgn('[Variant "Atomic"]\n\n1. e4 e5 2. Nf3 *');
    expect(imported.ok).toBe(false);
  });
});

describe('random play through the engine API stays consistent', () => {
  it('every offered move applies, reloading from the FEN never changes the answer, games finish', () => {
    let seed = 424242;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const problems: string[] = [];
    let plies = 0;
    let finished = 0;
    for (let game = 0; game < 25 && problems.length < 5; game++) {
      let engine = atomicEngine(START_FEN);
      for (let ply = 0; ply < 140; ply++) {
        if (engine.isGameOver()) {
          finished++;
          break;
        }
        const moves = getAtomicMoves(engine);
        // getLegalMoves per square agrees with the full list.
        const fromList = new Set(moves.map((m) => `${m.from}${m.to}`));
        const fromSquares = new Set<string>();
        for (const m of moves) fromSquares.add(m.from);
        for (const from of fromSquares) {
          for (const to of engine.getLegalMoves(from)) if (!fromList.has(`${from}${to}`)) problems.push(`getLegalMoves offered ${from}${to} in ${engine.getFen()}`);
        }
        // A few offered moves must apply on a scratch engine built from the FEN.
        for (const m of moves.slice(0, 5)) {
          if (!atomicEngine(engine.getFen()).move(m.from, m.to, m.promotion ?? 'q')) problems.push(`offered ${m.from}${m.to} but it failed in ${engine.getFen()}`);
        }
        const captures = moves.filter((m) => m.captured);
        const pool = captures.length > 0 && random() < 0.5 ? captures : moves;
        const pick = pool[Math.floor(random() * pool.length)];
        const next = atomicEngine(engine.getFen());
        const result = next.move(pick.from, pick.to, pick.promotion ?? 'q');
        if (!result) {
          problems.push(`chosen move failed: ${engine.getFen()}`);
          break;
        }
        plies++;
        engine = atomicEngine(next.getFen()); // forces the strict-reload path every ply
        if (engine.getLegalMoveCount() !== getAtomicMoves(engine).length) problems.push(`legal move count mismatch in ${engine.getFen()}`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
    expect(plies).toBeGreaterThan(1000);
    expect(finished).toBeGreaterThan(0); // games really do end (king explosions, mate, draws)
  }, 120000);
});

describe('performance budget', () => {
  it('building an engine and asking for legal moves/status stays cheap on a realistic 40+ move game', () => {
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let fen = START_FEN;
    for (let ply = 0; ply < 90; ply++) {
      const engine = atomicEngine(fen);
      if (engine.isGameOver()) break;
      const moves = getAtomicMoves(engine);
      const pick = moves[Math.floor(next() * moves.length)];
      engine.move(pick.from, pick.to, pick.promotion ?? 'q');
      fen = engine.getFen();
    }
    const start = performance.now();
    for (let i = 0; i < 200; i++) {
      // What one board render / one tap costs: a fresh engine (the memo key is the FEN), the status line
      // and the legal targets of a selected piece.
      const engine = atomicEngine(fen);
      engine.getStatus();
      engine.getLegalMoves('e1');
      engine.getLegalMoveCount();
    }
    const perRenderMs = (performance.now() - start) / 200;
    // Generous (typically well under 1ms): this runs on every position change, so a regression to a
    // per-candidate chess.js scratch engine (~2ms+) or per-render recomputation would show up here.
    expect(perRenderMs).toBeLessThan(5);
  });
});

describe('isolation and wiring (no React Native renderer available)', () => {
  const srcRoot = join(__dirname, '../../');
  // Line endings normalised to LF: the source files are checked out with CRLF on Windows.
  const read = (rel: string) => readFileSync(join(srcRoot, rel), 'utf8').replace(/\r\n/g, '\n');

  it('chessops (GPL, dev/test-only) is never imported by any shipped source file', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name === '__tests__' || name === 'node_modules' || name === 'generated') continue;
          walk(full);
        } else if (/\.(ts|tsx)$/.test(name) && /from\s+['"]chessops/.test(readFileSync(full, 'utf8'))) {
          offenders.push(full);
        }
      }
    };
    walk(srcRoot);
    expect(readFileSync(join(srcRoot, '../App.tsx'), 'utf8')).not.toMatch(/from\s+['"]chessops/);
    expect(offenders).toEqual([]);
    const pkg = JSON.parse(readFileSync(join(srcRoot, '../package.json'), 'utf8'));
    expect(pkg.dependencies?.chessops).toBeUndefined();
    expect(pkg.devDependencies?.chessops).toBeDefined();
  });

  const board = read('components/ChessBoard.tsx');

  it('ChessBoard builds every engine with the atomic option and skips the picker only for capture-promotions', () => {
    expect(board.match(/giveaway, atomic \}/g)?.length).toBe(3);
    expect(board).toContain("autoPromotion = 'q'");
    expect(board).toContain('atomic && board.flat().some((s) => s.square === square && s.piece !== null)');
  });

  for (const screen of ['screens/LocalGameScreen.tsx', 'screens/BotGameScreen.tsx']) {
    it(`${screen} feeds the Atomic winner into getGameOutcome and the saved-game payload, and passes the flag on`, () => {
      const src = read(screen);
      expect(src).toMatch(/getGameOutcome\([\s\S]*?atomicWinner\s*\n?\s*\)/);
      expect(src).toContain('atomicWinner,\n        atomic,');
      expect(src).toContain('atomic={atomic}');
      expect(src).toContain('isAtomicThreefoldRepetition');
      expect(src).toContain('exploded: h.move.exploded');
    });
  }

  it('Atomic is Local + Bots only: every Online setup screen excludes it', () => {
    expect(read('screens/ChallengeScreen.tsx')).toContain("excludeVariants={['atomic']}");
    expect(read('screens/OnlineTimeControlSelectScreen.tsx')).toContain("excludeVariants={['atomic']}");
    expect(read('screens/TournamentScreen.tsx')).toContain("'atomic'");
  });

  it('the bot never asks Stockfish for an Atomic move, and Atomic has no premoves or rating changes', () => {
    const bot = read('screens/BotGameScreen.tsx');
    const atomicBranch = bot.indexOf('if (atomic) {');
    const stockfishCall = bot.lastIndexOf('engineRuntime.engine.getBestMove');
    expect(atomicBranch).toBeGreaterThan(-1);
    expect(bot).toContain('chooseAtomicBotMove(moveEngine');
    expect(stockfishCall).toBeGreaterThan(atomicBranch);
    expect(bot).toContain('premoveColor={giveaway || atomic ? undefined : userColor}');
    expect(bot).toContain('onPremove={giveaway || atomic ? undefined : handleQueuePremove}');
    expect(bot).toContain('!giveaway && !atomic) recordRatedGame');
  });

  it('hints and Game Review are off for Atomic (Stockfish knows nothing of explosions)', () => {
    for (const screen of ['screens/LocalGameScreen.tsx', 'screens/BotGameScreen.tsx']) {
      expect(read(screen).match(/giveaway \|\| atomic/g)?.length).toBeGreaterThanOrEqual(2);
    }
    expect(read('components/PostGameSummaryModal.tsx')).toContain('!giveaway && !atomic');
  });

  it('is reachable from the play-mode menu for Local and Bots, and is a variant-selector option', () => {
    expect(read('screens/PlayModeSelectScreen.tsx')).toContain('onBotAtomic');
    expect(read('screens/PlayModeSelectScreen.tsx')).toContain('onLocalAtomic');
    expect(read('components/VariantSelector.tsx')).toContain("value: 'atomic'");
  });
});

describe('legal move generation sanity from the start position', () => {
  it('20 moves for White', () => {
    expect(generateAtomicMoves(parseAtomicFen(START_FEN))).toHaveLength(20);
    expect(getAtomicStatus(parseAtomicFen(START_FEN))).toBe('playing');
  });
});
