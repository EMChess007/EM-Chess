import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { START_FEN } from '../../types/chess';
import { ChessEngine } from '../ChessEngine';
import {
  duckMoveNotation,
  getDuckChessWinner,
  getLegalDuckPlacementSquares,
  hasNoDuckMoves,
  isCastleBlockedByDuck,
  isMoveBlockedByDuck,
  squaresBetween,
} from '../duckChess';

// Every Duck Chess engine is built with duckChess + the duck's CURRENT square (it is not in the FEN), and
// skipValidation because kings can be captured (a finished game's FEN has no king for the loser).
const duckEngine = (fen: string, duckSquare: string | null = null) => new ChessEngine(fen, { skipValidation: true, duckChess: true, duckSquare });
const targets = (engine: ChessEngine, from: string, color: 'w' | 'b' = engine.getTurn()) =>
  engine.getPseudoLegalMoves(color).filter((m) => m.from === from).map((m) => m.to).sort();

describe('geometry helpers', () => {
  it('squaresBetween lists the squares strictly between two squares on a line, nothing otherwise', () => {
    expect(squaresBetween('a1', 'a4')).toEqual(['a2', 'a3']);
    expect(squaresBetween('h8', 'e5')).toEqual(['g7', 'f6']);
    expect(squaresBetween('c1', 'g1')).toEqual(['d1', 'e1', 'f1']);
    expect(squaresBetween('b1', 'c1')).toEqual([]); // adjacent
    expect(squaresBetween('b1', 'c3')).toEqual([]); // a knight's jump
  });

  it('isMoveBlockedByDuck: landing on it, or sliding / double-stepping over it, is blocked', () => {
    expect(isMoveBlockedByDuck('r', 'a1', 'a5', 'a3')).toBe(true); // slides through
    expect(isMoveBlockedByDuck('r', 'a1', 'a3', 'a3')).toBe(true); // lands on it
    expect(isMoveBlockedByDuck('r', 'a1', 'a2', 'a3')).toBe(false); // stops short
    expect(isMoveBlockedByDuck('b', 'c1', 'f4', 'e3')).toBe(true);
    expect(isMoveBlockedByDuck('q', 'd1', 'd8', 'h5')).toBe(false); // elsewhere
    expect(isMoveBlockedByDuck('p', 'e2', 'e4', 'e3')).toBe(true); // double step over it
    expect(isMoveBlockedByDuck('p', 'e2', 'e3', 'e3')).toBe(true);
    expect(isMoveBlockedByDuck('n', 'g1', 'f3', 'g2')).toBe(false); // a knight jumps over it...
    expect(isMoveBlockedByDuck('n', 'g1', 'f3', 'f3')).toBe(true); // ...but cannot land on it
    expect(isMoveBlockedByDuck('k', 'e1', 'e2', 'e2')).toBe(true);
    expect(isMoveBlockedByDuck('r', 'a1', 'a5', null)).toBe(false); // no duck yet
  });

  it('isCastleBlockedByDuck: any square the king or rook crosses or lands on', () => {
    for (const sq of ['f1', 'g1']) expect(isCastleBlockedByDuck('e1', 'g1', sq), sq).toBe(true);
    for (const sq of ['b1', 'c1', 'd1']) expect(isCastleBlockedByDuck('e1', 'c1', sq), sq).toBe(true);
    expect(isCastleBlockedByDuck('e1', 'g1', 'd1')).toBe(false);
    expect(isCastleBlockedByDuck('e1', 'c1', 'f1')).toBe(false);
    expect(isCastleBlockedByDuck('e8', 'g8', 'f8')).toBe(true);
    expect(isCastleBlockedByDuck('e1', 'g1', null)).toBe(false);
  });
});

describe('the duck in the engine\'s move generation', () => {
  it('without a duck (before White\'s first move) the move set is the ordinary pseudo-legal one', () => {
    const plain = new ChessEngine(START_FEN, { skipValidation: true });
    const duck = duckEngine(START_FEN, null);
    expect(duck.getPseudoLegalMoves('w').map((m) => `${m.from}${m.to}`).sort()).toEqual(plain.getPseudoLegalMoves('w').map((m) => `${m.from}${m.to}`).sort());
    expect(duck.getPseudoLegalMoves('w')).toHaveLength(20);
  });

  it('a duck in front of a pawn blocks both its single and its double step', () => {
    expect(targets(duckEngine(START_FEN, 'e3'), 'e2')).toEqual([]);
    expect(targets(duckEngine(START_FEN, 'e4'), 'e2')).toEqual(['e3']);
  });

  it('a knight cannot land on the duck but is not blocked by pieces or the duck elsewhere', () => {
    expect(targets(duckEngine(START_FEN, 'f3'), 'g1')).toEqual(['h3']);
    expect(targets(duckEngine(START_FEN, 'g2'), 'g1')).toEqual(['f3', 'h3']); // jumps over it
  });

  it('sliding pieces stop short of the duck and cannot pass it', () => {
    const fen = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
    expect(targets(duckEngine(fen, 'a4'), 'a1')).toEqual(['a2', 'a3', 'b1', 'c1', 'd1']);
    expect(targets(duckEngine(fen, 'c1'), 'a1')).toEqual(['a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'b1']);
    // A bishop / queen diagonal.
    expect(targets(duckEngine('4k3/8/8/8/8/8/8/2B1K3 w - - 0 1', 'e3'), 'c1')).toEqual(['a3', 'b2', 'd2']);
  });

  it('castling is blocked when the duck sits on a square the king or rook crosses, and only then', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const castles = (duck: string | null) => targets(duckEngine(fen, duck), 'e1').filter((t) => t === 'g1' || t === 'c1');
    expect(castles(null)).toEqual(['c1', 'g1']);
    expect(castles('f1')).toEqual(['c1']);
    expect(castles('g1')).toEqual(['c1']);
    expect(castles('b1')).toEqual(['g1']); // the queenside rook crosses b1
    expect(castles('d1')).toEqual(['g1']);
    expect(castles('d2')).toEqual(['c1', 'g1']); // off the back rank: irrelevant
  });

  it('with no check there is no attack restriction on castling: out of, through and into "check" are all fine', () => {
    const castles = (fen: string) => targets(duckEngine(fen, 'a5'), 'e1').filter((t) => t === 'g1' || t === 'c1');
    expect(castles('4r2k/8/8/8/8/8/8/R3K2R w KQ - 0 1')).toEqual(['c1', 'g1']); // king attacked by Re8
    expect(castles('5r1k/8/8/8/8/8/8/R3K2R w KQ - 0 1')).toEqual(['c1', 'g1']); // f1 attacked (the king crosses it)
    expect(castles('6rk/8/8/8/8/8/8/R3K2R w KQ - 0 1')).toEqual(['c1', 'g1']); // g1 attacked (the king lands on it)
    expect(castles('3r3k/8/8/8/8/8/8/R3K2R w KQ - 0 1')).toEqual(['c1', 'g1']); // d1 attacked
    // The rights and empty squares still matter.
    expect(castles('4r2k/8/8/8/8/8/8/R3K2R w K - 0 1')).toEqual(['g1']);
    expect(castles('4r2k/8/8/8/8/8/8/R3KB1R w KQ - 0 1')).toEqual(['c1']); // a bishop on f1
    const done = duckEngine('5r1k/8/8/8/8/8/8/R3K2R w KQ - 0 1', 'a5');
    expect(done.movePseudoLegal('e1', 'g1')?.san).toBe('O-O');
    expect(done.getFen().split(' ')[0]).toBe('5r1k/8/8/8/8/8/8/R4RK1');
  });

  it('the duck on an en passant target square makes that capture impossible', () => {
    const fen = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';
    expect(targets(duckEngine(fen, 'h4'), 'e5')).toEqual(['d6', 'e6']);
    expect(targets(duckEngine(fen, 'd6'), 'e5')).toEqual(['e6']);
  });

  it('there is no check: moving into attack and leaving the king en prise are fully legal, and a king may be captured', () => {
    const fen = '4r2k/8/8/8/8/8/8/3QK3 w - - 0 1'; // Re8 gives "check"
    const engine = duckEngine(fen, 'a5');
    expect(targets(engine, 'e1')).toContain('e2'); // stays on the attacked file
    expect(targets(engine, 'd1')).toContain('d8'); // ignores the "check" entirely
    const capture = duckEngine('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'a5');
    expect(capture.getPseudoLegalMoves('w').some((m) => m.from === 'a1' && m.to === 'a4')).toBe(true);
    const kingTaken = duckEngine('k7/8/8/8/8/8/8/R3K3 w - - 0 1', 'h4').movePseudoLegal('a1', 'a8');
    expect(kingTaken?.captured).toBe('k');
  });

  it('movePseudoLegal refuses a move through or onto the duck, and writes no check mark in SAN', () => {
    const engine = duckEngine('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'a4');
    expect(engine.movePseudoLegal('a1', 'a6')).toBeNull();
    expect(engine.movePseudoLegal('a1', 'a4')).toBeNull();
    const checking = duckEngine('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'h2').movePseudoLegal('a1', 'a8');
    expect(checking?.san).toBe('Ra8'); // chess.js would say Ra8+
  });

  it('applies the same duck on the other colour\'s generation too (used by the bot\'s look-ahead)', () => {
    const engine = duckEngine('r3k3/8/8/8/8/8/8/4K3 b - - 0 1', 'a5');
    expect(targets(engine, 'a8', 'b')).toEqual(['a6', 'a7', 'b8', 'c8', 'd8']);
    expect(targets(engine, 'a8', 'w')).toEqual([]); // not White's piece
  });
});

describe('duck placement, winner, blockade and notation', () => {
  it('after a regular move the duck may go on any empty square except the one it stands on', () => {
    const afterE4 = duckEngine('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1', null);
    const first = getLegalDuckPlacementSquares(afterE4, null);
    expect(first).toHaveLength(32); // 64 squares - 32 pieces; no duck yet
    expect(first).toContain('e3');
    const next = getLegalDuckPlacementSquares(afterE4, 'e3');
    expect(next).toHaveLength(31);
    expect(next).not.toContain('e3'); // the duck must move somewhere new
    expect(next.every((sq) => !afterE4.getPieceAt(sq))).toBe(true); // empty squares only
  });

  it('getDuckChessWinner reads a king capture off the move', () => {
    expect(getDuckChessWinner({ from: 'a1', to: 'a8', san: 'Rxa8', captured: 'k' }, 'w')).toBe('w');
    expect(getDuckChessWinner({ from: 'a1', to: 'a7', san: 'Rxa7', captured: 'p' }, 'w')).toBeNull();
    expect(getDuckChessWinner(null, 'b')).toBeNull();
  });

  it('a side with no regular move at all (blockaded by the duck) has nothing to play — a draw', () => {
    expect(hasNoDuckMoves(duckEngine('8/8/8/8/8/8/4P3/8 w - - 0 1', 'e3'))).toBe(true);
    expect(hasNoDuckMoves(duckEngine('8/8/8/8/8/8/4P3/8 w - - 0 1', 'h8'))).toBe(false);
  });

  it('moves are written "san @duck"', () => {
    expect(duckMoveNotation({ san: 'e4', duck: 'g6' })).toBe('e4 @g6');
    expect(duckMoveNotation({ san: 'e4' })).toBe('e4');
  });
});

// An independent oracle for the blocking rules: replace the duck with an ordinary piece of the side to move
// (a knight — it blocks exactly like the duck for that side: nothing may land on it or pass through it, and it
// cannot be captured) and ask plain chess.js for that side's pseudo-legal moves, minus the dummy's own moves.
describe('duck-aware move generation vs a "friendly blocker" oracle (random Duck games)', () => {
  function seeded(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function oracleMoves(fen: string, duck: string, color: 'w' | 'b'): string[] {
    const fields = fen.split(' ');
    const ranks = fields[0].split('/');
    const file = duck.charCodeAt(0) - 97;
    const row = ranks[8 - Number(duck[1])];
    let expanded = '';
    for (const ch of row) expanded += ch >= '1' && ch <= '8' ? '.'.repeat(Number(ch)) : ch;
    const dummy = color === 'w' ? 'N' : 'n';
    const chars = expanded.split('');
    chars[file] = dummy;
    ranks[8 - Number(duck[1])] = chars.join('').replace(/\.+/g, (run) => String(run.length));
    const probe = new Chess([ranks.join('/'), color, fields[2], '-', fields[4], fields[5]].join(' '), { skipValidation: true });
    const internals = probe as unknown as { _moves(o: { legal: boolean }): { from: number; to: number; promotion?: string }[] };
    const name = (i: number) => `${'abcdefgh'[i & 0xf]}${'87654321'[i >> 4]}`;
    return internals
      ._moves({ legal: false })
      .map((m) => ({ from: name(m.from), to: name(m.to), promotion: m.promotion }))
      .filter((m) => m.from !== duck)
      .map((m) => `${m.from}${m.to}${m.promotion ?? ''}`)
      .filter((m) => !isCastleMove(m, fen))
      .sort();
  }

  // chess.js refuses castling over attacked squares, which Duck Chess does not (no check), so castling is
  // compared against the plain rule instead: right present, king and rook at home, the squares between empty
  // (the duck counts as occupying its square).
  // (A KING moving two files from e1/e8 — a rook on e8 going to g8 is an ordinary rook move.)
  const isCastleMove = (uci: string, fen: string) =>
    /^e1[gc]1$|^e8[gc]8$/.test(uci) && new ChessEngine(fen, { skipValidation: true }).getPieceAt(uci.slice(0, 2))?.type === 'k';
  function expectedCastles(fen: string, duck: string, color: 'w' | 'b'): string[] {
    const [placement, , rights] = fen.split(' ');
    const at = new Map<string, string>();
    placement.split('/').forEach((row, r) => {
      let file = 0;
      for (const ch of row) {
        if (ch >= '1' && ch <= '8') file += Number(ch);
        else at.set(`${'abcdefgh'[file++]}${8 - r}`, ch);
      }
    });
    const rank = color === 'w' ? '1' : '8';
    const king = color === 'w' ? 'K' : 'k';
    const rook = color === 'w' ? 'R' : 'r';
    const out: string[] = [];
    if (at.get(`e${rank}`) !== king) return out;
    const empty = (sq: string) => !at.has(sq) && sq !== duck;
    if (rights.includes(color === 'w' ? 'K' : 'k') && at.get(`h${rank}`) === rook && empty(`f${rank}`) && empty(`g${rank}`)) out.push(`e${rank}g${rank}`);
    if (rights.includes(color === 'w' ? 'Q' : 'q') && at.get(`a${rank}`) === rook && empty(`b${rank}`) && empty(`c${rank}`) && empty(`d${rank}`)) out.push(`e${rank}c${rank}`);
    return out;
  }

  it('agrees for both colours at every ply, including castling and promotion', () => {
    const problems: string[] = [];
    let checked = 0;
    let castles = 0;
    for (let g = 0; g < 80 && problems.length < 5; g++) {
      const random = seeded(42000 + g);
      let fen = START_FEN;
      let duck: string | null = null;
      for (let ply = 0; ply < 120; ply++) {
        const base = duckEngine(fen, duck);
        const moves = base.getPseudoLegalMoves();
        if (moves.length === 0) break;
        if (duck) {
          for (const color of ['w', 'b'] as const) {
            // Compared on a position with no en passant square (the oracle FEN can't carry one with a piece on it).
            const noEp = fen.split(' ').map((f, i) => (i === 3 ? '-' : f)).join(' ');
            const all = duckEngine(noEp, duck)
              .getPseudoLegalMoves(color)
              .map((m) => `${m.from}${m.to}${m.promotion ?? ''}`);
            const mine = all.filter((m) => !isCastleMove(m, noEp)).sort();
            const expected = oracleMoves(noEp, duck, color);
            const mineCastles = all.filter((m) => isCastleMove(m, noEp)).sort();
            const expectedCastle = expectedCastles(noEp, duck, color).sort();
            if (mineCastles.join() !== expectedCastle.join()) {
              problems.push(`game ${g} ply ${ply} ${color}: castles [${mineCastles}] vs expected [${expectedCastle}] duck ${duck} fen ${fen}`);
            }
            checked++;
            if (mine.join() !== expected.join()) {
              problems.push(`game ${g} ply ${ply} ${color}: duck ${duck} fen ${fen}: only mine [${mine.filter((m) => !expected.includes(m))}] only oracle [${expected.filter((m) => !mine.includes(m))}]`);
            }
          }
        }
        // Prefer castling when it is on offer so the castling-vs-duck rule is well covered.
        const castleMoves = moves.filter((m) => base.getPieceAt(m.from)?.type === 'k' && Math.abs(m.to.charCodeAt(0) - m.from.charCodeAt(0)) === 2);
        const pool = castleMoves.length > 0 && random() < 0.7 ? castleMoves : moves;
        const pick = pool[Math.floor(random() * pool.length)];
        const mover = duckEngine(fen, duck);
        const applied = mover.movePseudoLegal(pick.from, pick.to, pick.promotion);
        if (!applied) {
          problems.push(`offered move failed: ${pick.from}${pick.to} in ${fen}`);
          break;
        }
        if (applied.san === 'O-O' || applied.san === 'O-O-O') castles++;
        if (applied.captured === 'k') break;
        fen = mover.getFen();
        const placements = getLegalDuckPlacementSquares(mover, duck);
        duck = placements[Math.floor(random() * placements.length)];
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
    expect(checked).toBeGreaterThan(5000);
    expect(castles).toBeGreaterThan(5);
  }, 120000);
});

describe('wiring (no React Native renderer available)', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '../../', rel), 'utf8').replace(/\r\n/g, '\n');
  it('the engine drops duck-blocked candidates inside generateRaw (so every move path sees the duck)', () => {
    const engine = read('logic/ChessEngine.ts');
    expect(engine).toContain('isCastleBlockedByDuck(squareFromIndex(m.from)');
    expect(engine).toContain('isMoveBlockedByDuck(m.piece');
  });
});
