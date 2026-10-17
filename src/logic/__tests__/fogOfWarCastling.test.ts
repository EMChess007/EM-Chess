import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { chooseFogOfWarExtraCastle, getFogOfWarExtraCastles } from '../bots';
import { ChessEngine } from '../ChessEngine';
import { getVisibleSquares } from '../fogOfWar';

// fogOfWar.ts logs through diagnosticLog, which pulls in react-native (Flow source vitest cannot parse).
vi.mock('../diagnosticLog', () => ({ logDiagnostic: () => {} }));

// Fog of War has no check (chess.com: "the king can castle while in check, and can castle through, or into check"), so
// castling needs only: king and rook unmoved (castling rights), the squares between them empty, the target squares free.
// chess.js's pseudo-legal generator still withholds O-O/O-O-O when the king's squares are attacked — ChessEngine.generateRaw
// adds those castles back (addUnrestrictedCastles). Server twin: backend/scripts/test-fogOfWarCastling.mjs.

const fow = (fen: string) => new ChessEngine(fen, { skipValidation: true });
const castleTargets = (fen: string, color?: 'w' | 'b') => {
  const engine = fow(fen);
  const rank = (color ?? engine.getTurn()) === 'w' ? '1' : '8';
  return engine
    .getPseudoLegalMoves(color)
    .filter((m) => m.from === `e${rank}` && (m.to === `g${rank}` || m.to === `c${rank}`))
    .map((m) => m.to)
    .sort();
};

// White to move, king e1, rooks a1/h1, both rights. One black rook (plus a black king on h8 or a8 out of the way).
const OUT_OF_CHECK = '4r2k/8/8/8/8/8/8/R3K2R w KQ - 0 1'; // rook e8 checks the king
const THROUGH_KINGSIDE = '5r1k/8/8/8/8/8/8/R3K2R w KQ - 0 1'; // rook f8 attacks f1
const INTO_KINGSIDE = '6rk/8/8/8/8/8/8/R3K2R w KQ - 0 1'; // rook g8 attacks g1
const THROUGH_QUEENSIDE = '3r3k/8/8/8/8/8/8/R3K2R w KQ - 0 1'; // rook d8 attacks d1
const INTO_QUEENSIDE = '2r4k/8/8/8/8/8/8/R3K2R w KQ - 0 1'; // rook c8 attacks c1

describe('Fog of War castling: no check conditions', () => {
  it('out of check: both castles are offered (chess.js alone offers neither)', () => {
    expect(castleTargets(OUT_OF_CHECK)).toEqual(['c1', 'g1']);
    expect(new ChessEngine(OUT_OF_CHECK).getLegalMoves('e1')).not.toContain('g1'); // the ordinary rule, untouched
    expect(new ChessEngine(OUT_OF_CHECK).getLegalMoves('e1')).not.toContain('c1');
  });

  it('through check: the attacked transit square does not matter (kingside f1, queenside d1)', () => {
    expect(castleTargets(THROUGH_KINGSIDE)).toEqual(['c1', 'g1']);
    expect(castleTargets(THROUGH_QUEENSIDE)).toEqual(['c1', 'g1']);
  });

  it('into check: the attacked landing square does not matter (kingside g1, queenside c1)', () => {
    expect(castleTargets(INTO_KINGSIDE)).toEqual(['c1', 'g1']);
    expect(castleTargets(INTO_QUEENSIDE)).toEqual(['c1', 'g1']);
  });

  it.each([
    ['out of check', OUT_OF_CHECK, 'g1', '4r2k/8/8/8/8/8/8/R4RK1 b - - 1 1'],
    ['out of check (queenside)', OUT_OF_CHECK, 'c1', '4r2k/8/8/8/8/8/8/2KR3R b - - 1 1'],
    ['through check', THROUGH_KINGSIDE, 'g1', '5r1k/8/8/8/8/8/8/R4RK1 b - - 1 1'],
    ['into check', INTO_KINGSIDE, 'g1', '6rk/8/8/8/8/8/8/R4RK1 b - - 1 1'],
    ['through check (queenside)', THROUGH_QUEENSIDE, 'c1', '3r3k/8/8/8/8/8/8/2KR3R b - - 1 1'],
    ['into check (queenside)', INTO_QUEENSIDE, 'c1', '2r4k/8/8/8/8/8/8/2KR3R b - - 1 1'],
  ])('movePseudoLegal plays the castle %s — king and rook both land, rights are spent', (_name, fen, target, after) => {
    const engine = fow(fen);
    const move = engine.movePseudoLegal('e1', target);
    expect(move).not.toBeNull();
    expect(move!.san).toMatch(/^O-O(-O)?/);
    expect(engine.getFen()).toBe(after);
  });

  it('black castles the same way', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/4R2K b kq - 0 1'; // white rook e1 checks the king
    expect(castleTargets(fen)).toEqual(['c8', 'g8']);
    const engine = fow('r3k2r/8/8/8/8/8/8/5R1K b kq - 0 1'); // rook f1 attacks f8 (through)
    expect(engine.movePseudoLegal('e8', 'g8')).not.toBeNull();
    expect(engine.getFen()).toBe('r4rk1/8/8/8/8/8/8/5R1K w - - 1 2');
  });

  it('game 171 ply 42: the client view (hidden attacker invisible) and the true board (hidden bishop b4) both allow e1-c1', () => {
    const redactedView = '1b6/8/8/8/P4B2/N2P1p1N/2P1P1BP/R3K2R w KQ - 0 22'; // what the player's client holds
    const truth = '1b2k3/8/8/8/Pb3B2/N2P1p1N/2P1P1BP/R3K2R w KQ - 0 22'; // the server's board: bishop b4 checks e1
    expect(new ChessEngine(truth, { skipValidation: true }).getLegalMoves('e1')).not.toContain('c1'); // ordinary rule would refuse
    for (const fen of [redactedView, truth]) {
      expect(castleTargets(fen)).toContain('c1');
      expect(fow(fen).movePseudoLegal('e1', 'c1')).not.toBeNull();
    }
    // The client and the server agree on EVERY king move, not just the castle.
    const kingMoves = (fen: string) => fow(fen).getPseudoLegalMoves().filter((m) => m.from === 'e1').map((m) => m.to).sort();
    expect(kingMoves(truth)).toEqual(kingMoves(redactedView));
  });
});

describe('Fog of War castling: what still forbids it', () => {
  it.each([
    ['no right on that side', '4r2k/8/8/8/8/8/8/R3K2R w Q - 0 1', ['c1']],
    ['no rights at all', '4r2k/8/8/8/8/8/8/R3K2R w - - 0 1', []],
    ['own piece between (f1)', '4r2k/8/8/8/8/8/8/R3KB1R w KQ - 0 1', ['c1']],
    ['enemy piece between (g1)', '4r2k/8/8/8/8/8/8/R3K1rR w KQ - 0 1', ['c1']],
    ['piece on b1 blocks only the queenside', '4r2k/8/8/8/8/8/8/Rn2K2R w KQ - 0 1', ['g1']],
    ['piece on d1 blocks the queenside', '4r2k/8/8/8/8/8/8/R2nK2R w KQ - 0 1', ['g1']],
    ['rook gone from the corner (right still flagged)', '4r2k/8/8/8/8/8/8/4K2R w KQ - 0 1', ['g1']],
    ['king not on e1', '4r2k/8/8/8/8/8/8/R2K3R w KQ - 0 1', []],
    ['a knight on e1 (rights still flagged)', '4r2k/8/8/8/8/8/8/R3N2R w KQ - 0 1', []],
    ['the enemy king on e1', '4r3/8/8/8/8/8/8/R3k2R w KQ - 0 1', []],
  ])('%s', (_name, fen, expected) => {
    expect(castleTargets(fen)).toEqual(expected);
  });
});

describe('Fog of War castling: nothing else changes', () => {
  it('the visible squares are the same with and without the added castles (the rook already sees both targets)', () => {
    for (const fen of [OUT_OF_CHECK, THROUGH_KINGSIDE, INTO_KINGSIDE, THROUGH_QUEENSIDE, INTO_QUEENSIDE]) {
      const engine = fow(fen);
      const withCastles = getVisibleSquares(engine, 'w');
      const rooksOnly = new Set<string>();
      for (const row of engine.getBoard()) for (const sq of row) if (sq.piece?.color === 'w') rooksOnly.add(sq.square);
      for (const m of engine.getPseudoLegalMoves('w')) {
        const isCastle = m.from === 'e1' && (m.to === 'g1' || m.to === 'c1');
        if (!isCastle) rooksOnly.add(m.to);
      }
      expect([...withCastles].sort()).toEqual([...rooksOnly].sort());
    }
  });

  it('an ordinary (non Fog of War) engine keeps the ordinary rule: no castling out of, through or into check', () => {
    for (const fen of [OUT_OF_CHECK, THROUGH_KINGSIDE, INTO_KINGSIDE]) {
      expect(new ChessEngine(fen).move('e1', 'g1')).toBeNull();
    }
    expect(new ChessEngine(THROUGH_QUEENSIDE).move('e1', 'c1')).toBeNull();
  });

  it('Spell Chess (the one other user of the pseudo-legal API) keeps chess.js castling, freeze-escape included', () => {
    const spell = (fen: string) => new ChessEngine(fen, { spellChess: true, skipValidation: true, freezeEscapeActive: true });
    expect(spell(OUT_OF_CHECK).getPseudoLegalMoves('w').some((m) => m.from === 'e1' && m.to === 'g1')).toBe(false);
    expect(spell(THROUGH_KINGSIDE).getPseudoLegalMoves('w').some((m) => m.from === 'e1' && m.to === 'g1')).toBe(false);
    // ... and where chess.js allows the castle, it is still offered.
    const calm = '7k/8/8/8/8/8/8/R3K2R w KQ - 0 1';
    expect(spell(calm).getPseudoLegalMoves('w').filter((m) => m.from === 'e1' && (m.to === 'g1' || m.to === 'c1'))).toHaveLength(2);
  });

  it('Giveaway still has no castling at all', () => {
    const giveaway = new ChessEngine('7k/8/8/8/8/8/8/R3K2R w KQ - 0 1', { skipValidation: true, giveaway: true });
    expect(giveaway.getPseudoLegalMoves('w').some((m) => m.from === 'e1' && (m.to === 'g1' || m.to === 'c1'))).toBe(false);
  });

  it('a castle chess.js already offers is not added a second time', () => {
    expect(castleTargets('7k/8/8/8/8/8/8/R3K2R w KQ - 0 1')).toEqual(['c1', 'g1']);
    expect(castleTargets('r3k2r/8/8/8/8/8/8/7K b kq - 0 1', 'b')).toEqual(['c8', 'g8']);
  });

  it('an unrelated move is not affected: every non-castle pseudo-legal move equals the one chess.js generates', () => {
    const engine = fow(OUT_OF_CHECK);
    const nonCastles = engine.getPseudoLegalMoves('w').filter((m) => !(m.from === 'e1' && (m.to === 'g1' || m.to === 'c1')));
    expect(nonCastles.length).toBeGreaterThan(10);
    expect(new Set(nonCastles.map((m) => `${m.from}${m.to}`)).size).toBe(nonCastles.length); // no duplicates
  });
});

describe('Fog of War bot: castling that Stockfish can never suggest', () => {
  it('getFogOfWarExtraCastles lists only the castles ordinary chess forbids', () => {
    expect(getFogOfWarExtraCastles(new ChessEngine(OUT_OF_CHECK), 'w').map((m) => m.to).sort()).toEqual(['c1', 'g1']);
    expect(getFogOfWarExtraCastles(new ChessEngine(THROUGH_KINGSIDE), 'w').map((m) => m.to)).toEqual(['g1']);
    // an ordinary legal castle is NOT an extra (Stockfish handles those)
    expect(getFogOfWarExtraCastles(new ChessEngine('7k/8/8/8/8/8/8/R3K2R w KQ - 0 1'), 'w')).toEqual([]);
  });

  it('out of check onto a safe square: always taken, whatever the dice say', () => {
    const fen = '4r2k/8/8/8/8/8/8/R3K2R w KQ - 0 1';
    const castle = chooseFogOfWarExtraCastle(new ChessEngine(fen), 'w', () => 0.99);
    expect(castle).not.toBeNull();
    expect(['c1', 'g1']).toContain(castle!.to);
    // with two safe castles to choose from, the dice pick between them
    const picks = new Set([0, 0.99].map((r) => chooseFogOfWarExtraCastle(new ChessEngine(fen), 'w', () => r)?.to));
    expect(picks).toEqual(new Set(['c1', 'g1']));
  });

  it('not in check: taken only on the 1/2 chance', () => {
    const engine = new ChessEngine(THROUGH_KINGSIDE); // king safe, f1 attacked: kingside is an extra
    expect(chooseFogOfWarExtraCastle(engine, 'w', () => 0.9)).toBeNull();
    expect(chooseFogOfWarExtraCastle(engine, 'w', () => 0)?.to).toBe('g1');
  });

  it('never castles onto a square the opponent could capture the king on', () => {
    // rook g8 attacks g1 (into check): the kingside castle is an extra, but unsafe -> nothing to play (c1 is an ordinary castle)
    expect(getFogOfWarExtraCastles(new ChessEngine(INTO_KINGSIDE), 'w').map((m) => m.to)).toEqual(['g1']);
    expect(chooseFogOfWarExtraCastle(new ChessEngine(INTO_KINGSIDE), 'w', () => 0)).toBeNull();
    // rooks on g8 (into check on g1) and d8 (through check on d1): both are extras, only the queenside one is safe
    const mixed = '3r2rk/8/8/8/8/8/8/R3K2R w KQ - 0 1';
    expect(getFogOfWarExtraCastles(new ChessEngine(mixed), 'w').map((m) => m.to).sort()).toEqual(['c1', 'g1']);
    expect(chooseFogOfWarExtraCastle(new ChessEngine(mixed), 'w', () => 0)?.to).toBe('c1');
    // both landing squares attacked -> nothing to play
    const both = '2r3rk/8/8/8/8/8/8/R3K2R w KQ - 0 1';
    expect(getFogOfWarExtraCastles(new ChessEngine(both), 'w').map((m) => m.to).sort()).toEqual(['c1', 'g1']);
    expect(chooseFogOfWarExtraCastle(new ChessEngine(both), 'w', () => 0)).toBeNull();
  });

  it('BotGameScreen asks for it only in Fog of War, after the king-capture check and before Stockfish', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'screens', 'BotGameScreen.tsx'), 'utf8').replace(/\r\n/g, '\n');
    const capture = src.indexOf("m.captured === 'k'");
    const castle = src.indexOf('chooseFogOfWarExtraCastle(engine, botColor)');
    const stockfish = src.indexOf('engineRuntime.engine.getBestMove', castle);
    expect(capture).toBeGreaterThan(0);
    expect(castle).toBeGreaterThan(capture);
    expect(stockfish).toBeGreaterThan(castle);
    expect(src.slice(capture, castle)).not.toContain('getBestMove');
    expect(src.slice(castle - 80, castle)).toContain('fogOfWar && !move');
  });
});
