import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { parseFen } from 'chessops/fen';
import { Crazyhouse } from 'chessops/variant';
import { ChessEngine } from '../ChessEngine';
import { getCrazyhouseMoves, initialCrazyhouseState, type CrazyhouseState, type Reserve } from '../crazyhouse';
import { legalDropsOn, legalMovesOn, seatAt, type BoardVerdict } from '../bughouse';
import { RefMatch } from './bughouseReferenceModel';
import { dropKey, mulberry32, moveKey, newPair, nextStep, feed } from './bughouseTestKit';
import { scene } from './bughouseScenes';

/**
 * THE PER-BOARD DIFFERENTIAL (BUGHOUSE_SPEC.md W1 test 2a). Every single-board position the engine can reach - positions sampled from seeded matches, and thousands of random sparse
 * positions with random pockets (checks, mates, stalemates and promotions are common there) - is questioned three ways and the answers must agree:
 *   1. the Bughouse engine (src/logic/bughouse),
 *   2. the app's 2-player Crazyhouse engine (ChessEngine with the `crazyhouse` option: chess.js + crazyhouse.ts),
 *   3. chessops's Crazyhouse (lichess's rules; dev-only oracle).
 * Legal moves, legal drops and the check flag must be IDENTICAL. The verdict must be the one the DELIBERATE DIFFERENCES below allow, and each difference is asserted, not ignored:
 *   D1  ChessEngine "checkmate", Bughouse "stuck (check)": the check is by ONE slider with an empty square between, so a piece arriving in the pocket could block (rules 18, B4);
 *   D2  ChessEngine "stalemate", Bughouse "stuck (noAction)": the player waits and the clock decides (rule 19, B5);
 *   D3  ChessEngine "draw" by the fifty-move rule, Bughouse plays on (rule 22: no draws of any kind);
 *   D4  chessops ends a position with bare kings (insufficient material), Bughouse plays on (rule 20).
 * Everything else - "playing", "check", and a mate nobody could ever answer - is the same in all three.
 */
type Letter = 'p' | 'n' | 'b' | 'r' | 'q';
const LETTERS: Letter[] = ['p', 'n', 'b', 'r', 'q'];
const ROLE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' } as const;
const reserve = (r: Partial<Reserve> = {}): Reserve => ({ p: 0, n: 0, b: 0, r: 0, q: 0, ...r });

interface Sample {
  fen: string;
  promoted: string[];
  white: Reserve;
  black: Reserve;
}

/** chessops's FEN for a sample: pockets in brackets, a "~" after each promoted piece. */
function opsFen(s: Sample, white = s.white, black = s.black): string {
  const [placement, ...rest] = s.fen.split(' ');
  const ranks = placement.split('/').map((rank, index) => {
    let file = 0;
    let out = '';
    for (const ch of rank) {
      if (/\d/.test(ch)) {
        file += Number(ch);
        out += ch;
      } else {
        const square = `${'abcdefgh'[file]}${8 - index}`;
        out += ch + (s.promoted.includes(square) ? '~' : '');
        file++;
      }
    }
    return out;
  });
  const pockets = LETTERS.map((l) => l.toUpperCase().repeat(white[l])).join('') + LETTERS.map((l) => l.repeat(black[l])).join('');
  return `${ranks.join('/')}[${pockets}] ${rest.join(' ')}`;
}

const dummy = new RefMatch(1, 0, 0, 0); // only its chessops key helpers are used here

interface Answers {
  moves: string[];
  drops: string[];
  check: boolean;
  /** status in the 2-player vocabulary */
  kind: 'playing' | 'check' | 'checkmate' | 'stalemate';
  couldAnswer: boolean;
}

function chessopsAnswers(s: Sample): Answers | null {
  const parsed = Crazyhouse.fromSetup(parseFen(opsFen(s)).unwrap());
  if (parsed.isErr) return null;
  const pos = parsed.unwrap();
  const moves = dummy.moveKeys(pos);
  const drops = dummy.dropKeys(pos);
  const check = pos.isCheck();
  const kind = moves.length + drops.length > 0 ? (check ? 'check' : 'playing') : check ? 'checkmate' : 'stalemate';
  // brute force: would ONE of each non-pawn piece in the pocket give the player a legal drop?
  const rich = reserve({ n: 1, b: 1, r: 1, q: 1 });
  const richPos = Crazyhouse.fromSetup(parseFen(pos.turn === 'white' ? opsFen(s, rich, s.black) : opsFen(s, s.white, rich)).unwrap()).unwrap();
  return { moves, drops, check, kind, couldAnswer: dummy.dropKeys(richPos).length > 0 };
}

function chessEngineAnswers(s: Sample): { moves: string[]; drops: string[]; status: string; halfmove: number } {
  const state: CrazyhouseState = { reserve: { w: { ...s.white }, b: { ...s.black } }, promoted: [...s.promoted].sort() };
  const engine = new ChessEngine(s.fen, { crazyhouse: true, crazyhouseState: state });
  return {
    moves: getCrazyhouseMoves(engine).map((m) => `${m.from}${m.to}${m.promotion ?? ''}`).sort(),
    drops: engine.getLegalDrops().map((d) => `${d.piece}@${d.square}`).sort(),
    status: engine.getStatus(),
    halfmove: Number(s.fen.split(' ')[4]),
  };
}

function bughouseAnswers(s: Sample): { moves: string[]; drops: string[]; verdict: BoardVerdict } {
  const m = scene({ a: s.fen, promotedA: s.promoted, pockets: { [seatAt('A', 'w')]: s.white, [seatAt('A', 'b')]: s.black } });
  return { moves: legalMovesOn(m, 'A').map(moveKey).sort(), drops: legalDropsOn(m, 'A').map(dropKey).sort(), verdict: m.verdicts.A };
}

interface Tally {
  checked: number;
  playing: number;
  check: number;
  mateSame: number;
  d1: number;
  d2: number;
  d3: number;
  d4: number;
  promoted: number;
  withPocket: number;
}
const emptyTally = (): Tally => ({ checked: 0, playing: 0, check: 0, mateSame: 0, d1: 0, d2: 0, d3: 0, d4: 0, promoted: 0, withPocket: 0 });

function compare(s: Sample, tally: Tally, label: string): void {
  const ops = chessopsAnswers(s);
  if (ops === null) return; // a sparse random position chessops refuses as illegal (e.g. the side not to move is in check): not a position of any game
  const ce = chessEngineAnswers(s);
  const mine = bughouseAnswers(s);
  expect(mine.moves, `${label} moves vs ChessEngine: ${s.fen}`).toEqual(ce.moves);
  expect(mine.moves, `${label} moves vs chessops: ${s.fen}`).toEqual(ops.moves);
  expect(mine.drops, `${label} drops vs ChessEngine: ${s.fen} ${JSON.stringify([s.white, s.black])}`).toEqual(ce.drops);
  expect(mine.drops, `${label} drops vs chessops: ${s.fen}`).toEqual(ops.drops);
  expect(mine.verdict.inCheck, `${label} check flag: ${s.fen}`).toBe(ops.check);
  tally.checked++;
  if (s.promoted.length > 0) tally.promoted++;
  if (LETTERS.some((l) => s.white[l] + s.black[l] > 0)) tally.withPocket++;
  const v = mine.verdict;
  switch (ce.status) {
    case 'playing':
      expect(v, `${label} ${s.fen}`).toMatchObject({ status: 'playing', stuck: null });
      tally.playing++;
      break;
    case 'check':
      expect(v, `${label} ${s.fen}`).toMatchObject({ status: 'check', stuck: null });
      tally.check++;
      break;
    case 'stalemate': // D2
      expect(v, `${label} ${s.fen}`).toMatchObject({ status: 'stuck', stuck: 'noAction', inCheck: false });
      tally.d2++;
      break;
    case 'checkmate':
      if (ops.couldAnswer) {
        // D1: some piece could block, so it is not a mate
        expect(v, `${label} ${s.fen}`).toMatchObject({ status: 'stuck', stuck: 'check', inCheck: true });
        tally.d1++;
      } else {
        expect(v, `${label} ${s.fen}`).toMatchObject({ status: 'checkmate', stuck: null, inCheck: true });
        tally.mateSame++;
      }
      break;
    case 'draw': // D3: only ever the fifty-move rule here
      expect(ce.halfmove, `${label} ${s.fen}`).toBeGreaterThanOrEqual(100);
      expect(['playing', 'check', 'stuck', 'checkmate']).toContain(v.status);
      tally.d3++;
      break;
    default:
      throw new Error(`unexpected ChessEngine status ${ce.status}`);
  }
}

/** Random sparse positions: two kings that do not touch and 0-7 other pieces; the side to move is random. */
function sparse(rng: () => number, maxExtra = 8, emptyProb = 0.45): Sample {
  const board: (string | null)[] = Array(64).fill(null);
  const free = () => {
    for (;;) {
      const i = Math.floor(rng() * 64);
      if (!board[i]) return i;
    }
  };
  const wk = free();
  board[wk] = 'K';
  let bk = free();
  while (Math.abs((bk & 7) - (wk & 7)) <= 1 && Math.abs((bk >> 3) - (wk >> 3)) <= 1) bk = free();
  board[bk] = 'k';
  const count = Math.floor(rng() * maxExtra);
  for (let i = 0; i < count; i++) {
    const kind = 'pnbrq'[Math.floor(rng() * 5)];
    let sq = free();
    if (kind === 'p') while (sq >> 3 === 0 || sq >> 3 === 7) sq = free();
    board[sq] = rng() < 0.5 ? kind.toUpperCase() : kind;
  }
  const ranks: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let out = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = board[rank * 8 + file];
      if (piece) {
        if (empty) out += empty;
        empty = 0;
        out += piece;
      } else empty++;
    }
    if (empty) out += empty;
    ranks.push(out);
  }
  const turn = rng() < 0.5 ? 'w' : 'b';
  const halfmove = rng() < 0.03 ? 100 : 0;
  const pocket = (): Reserve => (rng() < emptyProb ? reserve() : reserve({ p: Math.floor(rng() * 2), n: Math.floor(rng() * 2), b: Math.floor(rng() * 2), r: Math.floor(rng() * 2), q: Math.floor(rng() * 2) }));
  return { fen: `${ranks.join('/')} ${turn} - - ${halfmove} 40`, promoted: [], white: pocket(), black: pocket() };
}

/** A lone king in a corner (or on an edge) with a king and one or two attackers against it, Black to move, nothing in the pockets: stalemates, mates and stuck checks are common. */
function cornerHunt(rng: () => number): Sample {
  const corners = [0, 7, 56, 63, 3, 4, 24, 31];
  const bk = corners[Math.floor(rng() * corners.length)];
  const board: (string | null)[] = Array(64).fill(null);
  board[bk] = 'k';
  const free = () => {
    for (;;) {
      const i = Math.floor(rng() * 64);
      if (!board[i]) return i;
    }
  };
  let wk = free();
  while (Math.abs((bk & 7) - (wk & 7)) <= 1 && Math.abs((bk >> 3) - (wk >> 3)) <= 1) wk = free();
  board[wk] = 'K';
  const attackers = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < attackers; i++) board[free()] = 'QQRRBN'[Math.floor(rng() * 6)];
  const ranks: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let out = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = board[rank * 8 + file];
      if (piece) {
        if (empty) out += empty;
        empty = 0;
        out += piece;
      } else empty++;
    }
    if (empty) out += empty;
    ranks.push(out);
  }
  return { fen: `${ranks.join('/')} b - - 0 40`, promoted: [], white: reserve(), black: reserve() };
}

describe('the Bughouse engine against ChessEngine\'s Crazyhouse and chessops, board by board', () => {
  it('thousands of positions: positions from seeded matches (their real pockets, and with the pockets emptied and refilled) and random sparse positions', { timeout: 600_000 }, () => {
    const tally = emptyTally();
    // (1) positions that occur in matches
    for (let i = 0; i < 40; i++) {
      const seed = 4000 + i * 101;
      const pair = newPair(seed);
      const rng = mulberry32(seed ^ 0x5bd1e995);
      for (let step = 0; step < 90 && pair.engine.result === null; step++) {
        feed(pair, nextStep(rng, pair.engine, pair.model));
        if (step % 4 !== 0) continue;
        for (const board of ['A', 'B'] as const) {
          const b = pair.engine.boards[board];
          const white = pair.engine.pockets[seatAt(board, 'w')];
          const black = pair.engine.pockets[seatAt(board, 'b')];
          const base: Sample = { fen: b.fen, promoted: b.promoted, white: { ...white }, black: { ...black } };
          compare(base, tally, `match ${seed} step ${step} ${board}`);
          if (step % 8 === 0) {
            compare({ ...base, white: reserve(), black: reserve() }, tally, `match ${seed} step ${step} ${board} (empty pockets)`);
            compare({ ...base, white: reserve({ n: 1, q: 1 }), black: reserve({ p: 2, b: 1 }) }, tally, `match ${seed} step ${step} ${board} (full pockets)`);
          }
        }
      }
    }
    // (2) sparse positions
    const rng = mulberry32(99);
    for (let i = 0; i < 1800; i++) compare(sparse(rng), tally, `sparse ${i}`);
    // (3) stalemate and mate hunting: a king and one to three pieces a side, nearly always with empty pockets
    for (let i = 0; i < 1500; i++) compare(sparse(rng, 4, 1), tally, `hunt ${i}`);
    for (let i = 0; i < 1500; i++) compare(cornerHunt(rng), tally, `corner ${i}`);
    console.log(`bughouseBoards: ${JSON.stringify(tally)}`);
    expect(tally.checked).toBeGreaterThan(3500);
    expect(tally.playing).toBeGreaterThan(1000);
    expect(tally.check).toBeGreaterThan(100);
    expect(tally.promoted).toBeGreaterThan(5);
    expect(tally.withPocket).toBeGreaterThan(500);
    expect(tally.d1).toBeGreaterThan(5); // the deliberate differences are really reached by the sample
    expect(tally.d2).toBeGreaterThan(5);
    expect(tally.mateSame).toBeGreaterThan(5);
    expect(tally.d3).toBeGreaterThan(5);
  });

  it('the deliberate differences, hand-built, each asserted on its own', () => {
    const tally = emptyTally();
    const sample = (fen: string, white: Partial<Reserve> = {}, black: Partial<Reserve> = {}): Sample => ({ fen, promoted: [], white: reserve(white), black: reserve(black) });
    // D1: a back-rank rook check, empty pocket: ChessEngine says mate, Bughouse says stuck - and with a rook in the pocket both play on
    const d1 = sample('k7/8/8/8/8/8/6PP/r6K w - - 0 1');
    expect(chessEngineAnswers(d1).status).toBe('checkmate');
    expect(bughouseAnswers(d1).verdict).toEqual({ status: 'stuck', turn: 'w', inCheck: true, stuck: 'check' });
    expect(chessopsAnswers(d1)?.couldAnswer).toBe(true);
    const d1b = sample('k7/8/8/8/8/8/6PP/r6K w - - 0 1', { r: 1 });
    expect(chessEngineAnswers(d1b).status).toBe('check');
    expect(bughouseAnswers(d1b).verdict.status).toBe('check');
    // D2: stalemate with an empty pocket
    const d2 = sample('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(chessEngineAnswers(d2).status).toBe('stalemate');
    expect(bughouseAnswers(d2).verdict).toEqual({ status: 'stuck', turn: 'b', inCheck: false, stuck: 'noAction' });
    // D3: the fifty-move rule: ChessEngine's Crazyhouse calls it a draw, Bughouse plays on
    const d3 = sample('k7/8/8/8/8/8/8/7K w - - 100 90');
    expect(chessEngineAnswers(d3).status).toBe('draw');
    expect(bughouseAnswers(d3).verdict.status).toBe('playing');
    compare(sample('k6r/8/8/8/8/8/8/6RK w - - 100 90'), tally, 'fifty-move');
    expect(tally.d3).toBe(1);
    // D4: bare kings: chessops calls the game over (insufficient material), ChessEngine and Bughouse play on
    const d4 = sample('k7/8/8/8/8/8/8/7K w - - 0 1');
    expect(Crazyhouse.fromSetup(parseFen(opsFen(d4)).unwrap()).unwrap().isEnd()).toBe(true);
    expect(chessEngineAnswers(d4).status).toBe('playing');
    expect(bughouseAnswers(d4).verdict.status).toBe('playing');
    expect(bughouseAnswers(d4).moves.length).toBeGreaterThan(0);
    // real mates the same everywhere
    for (const fen of ['k7/1QK5/8/8/8/8/8/8 b - - 0 1', '6k1/8/8/8/8/8/5nPP/6RK w - - 0 1', 'b3k2r/8/8/8/8/8/8/6RK w - - 0 1']) {
      const s = sample(fen);
      expect(chessEngineAnswers(s).status, fen).toBe('checkmate');
      expect(bughouseAnswers(s).verdict.status, fen).toBe('checkmate');
      expect(chessopsAnswers(s)?.couldAnswer, fen).toBe(false);
    }
  });

  it('a position chess.js would load but chessops refuses is skipped, never compared (a sanity check of the sampler)', () => {
    const rng = mulberry32(5);
    let refused = 0;
    for (let i = 0; i < 300; i++) if (chessopsAnswers(sparse(rng)) === null) refused++;
    expect(refused).toBeGreaterThan(0);
    expect(new Chess().fen()).toContain('rnbqkbnr');
    expect(initialCrazyhouseState().promoted).toEqual([]);
  });
});
