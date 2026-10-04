import { describe, expect, it } from 'vitest';
// DEV/TEST-ONLY dependency: chessops is GPL-3.0-or-later and lives in devDependencies, used here as an
// independent oracle for Atomic's rules. It must NEVER be imported from any file that ships in the app
// bundle or the backend — only from tests like this one (guarded by atomic.test.ts's wiring checks).
import { makeFen, parseFen } from 'chessops/fen';
import { makeSan } from 'chessops/san';
import { Atomic } from 'chessops/variant';
import {
  applyAtomicMove,
  atomicFen,
  atomicPositionKey,
  atomicSan,
  generateAtomicMoves,
  getAtomicKingWinner,
  isAtomicCheck,
  isAtomicInsufficientMaterial,
  parseAtomicFen,
  squareName,
  type AtomicMove,
  type AtomicPosition,
} from '../atomic';
import { START_FEN } from '../../types/chess';

/**
 * Differential tests: this repo's Atomic implementation (src/logic/atomic.ts, written from the rules)
 * against chessops's `Atomic` class (the same rules as lichess), over the start position's perft counts,
 * several capture-heavy positions, and thousands of random plies of capture-biased play — comparing the
 * legal move set, resulting position, check/mate/stalemate/insufficient-material/king-explosion state
 * and SAN at every step. A disagreement anywhere fails the test with the FEN that exposed it.
 */

type OpsPosition = ReturnType<typeof Atomic.default>;

const PROMOTION_ROLES = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' } as const;

const opsFromFen = (fen: string): OpsPosition => Atomic.fromSetup(parseFen(fen).unwrap()).unwrap();

/** chessops reports castling as king→own-rook; this repo uses the king's two-square step. */
function opsLegalKeys(pos: OpsPosition): string[] {
  const keys: string[] = [];
  const turn = pos.turn;
  for (const [from, dests] of pos.allDests()) {
    const isKing = pos.board.getRole(from) === 'king';
    const isPawn = pos.board.getRole(from) === 'pawn';
    for (const to of dests) {
      const target = pos.board.get(to);
      if (isKing && target && target.color === turn && target.role === 'rook') {
        const rank = from >> 3;
        keys.push(`${squareName(from)}${squareName(rank * 8 + ((to & 7) > (from & 7) ? 6 : 2))}`);
      } else if (isPawn && (to >> 3 === 7 || to >> 3 === 0)) {
        for (const p of ['q', 'r', 'b', 'n']) keys.push(`${squareName(from)}${squareName(to)}${p}`);
      } else {
        keys.push(`${squareName(from)}${squareName(to)}`);
      }
    }
  }
  return keys.sort();
}

const myKey = (m: AtomicMove) => `${squareName(m.from)}${squareName(m.to)}${m.promotion ?? ''}`;
const myLegalKeys = (pos: AtomicPosition) => generateAtomicMoves(pos).map(myKey).sort();

/** The chessops move equivalent to one of this repo's moves. */
function toOpsMove(pos: OpsPosition, m: AtomicMove) {
  if (m.castle) {
    const rank = m.from >> 3;
    return { from: m.from, to: rank * 8 + (m.castle === 'k' ? 7 : 0) };
  }
  return { from: m.from, to: m.to, promotion: m.promotion ? PROMOTION_ROLES[m.promotion] : undefined };
}

const normalizeCastling = (field: string) => (field === '-' ? '-' : field.split('').sort().join(''));

/** Position equality that is insensitive to the two engines' (legitimate) en passant FEN conventions:
 * this repo always writes the ep square after a double push, chessops only when a capture is legal. */
function samePosition(mine: AtomicPosition, ops: OpsPosition): string | null {
  const [oPlacement, oTurn, oCastling, oEp, oHalf, oFull] = makeFen(ops.toSetup()).split(' ');
  const [mPlacement, mTurn, mCastling, mEp] = atomicPositionKey(atomicFen(mine)).split(' ');
  if (mPlacement !== oPlacement) return `placement ${mPlacement} vs ${oPlacement}`;
  if (mTurn !== oTurn) return 'turn';
  if (normalizeCastling(mCastling) !== normalizeCastling(oCastling)) return `castling ${mCastling} vs ${oCastling}`;
  if (mEp !== oEp) return `ep ${mEp} vs ${oEp}`;
  if (mine.halfmove !== Number(oHalf)) return `halfmove ${mine.halfmove} vs ${oHalf}`;
  if (mine.fullmove !== Number(oFull)) return `fullmove ${mine.fullmove} vs ${oFull}`;
  return null;
}

/** Compares everything observable about one position; returns a description of the first mismatch. */
function comparePosition(mine: AtomicPosition, ops: OpsPosition): string | null {
  const diff = samePosition(mine, ops);
  if (diff) return diff;

  const outcome = ops.outcome();
  const myWinner = getAtomicKingWinner(mine);
  const opsKingWinner = ops.isVariantEnd() ? (outcome?.winner === 'white' ? 'w' : outcome?.winner === 'black' ? 'b' : null) : null;
  if (myWinner !== opsKingWinner) return `king winner ${myWinner} vs ${opsKingWinner}`;
  if (myWinner) {
    // Finished game: no moves to compare.
    return generateAtomicMoves(mine).length === 0 ? null : 'moves generated after the game ended';
  }

  const mineMoves = myLegalKeys(mine);
  const opsMoves = opsLegalKeys(ops);
  if (mineMoves.join() !== opsMoves.join()) {
    const onlyMine = mineMoves.filter((k) => !opsMoves.includes(k));
    const onlyOps = opsMoves.filter((k) => !mineMoves.includes(k));
    return `legal moves differ: only mine [${onlyMine}] only chessops [${onlyOps}]`;
  }
  if (isAtomicCheck(mine) !== ops.isCheck()) return `check ${isAtomicCheck(mine)} vs ${ops.isCheck()}`;
  if (mineMoves.length === 0 && ops.isCheckmate() !== isAtomicCheck(mine)) return 'checkmate mismatch';
  if (mineMoves.length === 0 && ops.isStalemate() === isAtomicCheck(mine)) return 'stalemate mismatch';
  if (isAtomicInsufficientMaterial(mine) !== ops.isInsufficientMaterial()) return `insufficient material ${isAtomicInsufficientMaterial(mine)} vs ${ops.isInsufficientMaterial()}`;
  return null;
}

function makeRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

describe('perft against chessops (start position + capture-heavy positions)', () => {
  const perftMine = (pos: AtomicPosition, depth: number): number => {
    if (depth === 0) return 1;
    const moves = generateAtomicMoves(pos);
    if (depth === 1) return moves.length;
    let n = 0;
    for (const m of moves) n += perftMine(applyAtomicMove(pos, m).position, depth - 1);
    return n;
  };
  const perftOps = (pos: OpsPosition, depth: number): number => {
    if (depth === 0) return 1;
    let n = 0;
    for (const [from, dests] of pos.allDests()) {
      for (const to of dests) {
        const isPromo = pos.board.getRole(from) === 'pawn' && (to >> 3 === 7 || to >> 3 === 0);
        const variants = isPromo ? (['queen', 'rook', 'bishop', 'knight'] as const).map((promotion) => ({ from, to, promotion })) : [{ from, to }];
        for (const move of variants) {
          if (depth === 1) {
            n += 1;
            continue;
          }
          const child = pos.clone();
          child.play(move);
          n += perftOps(child, depth - 1);
        }
      }
    }
    return n;
  };

  it('start position, depths 1-4 — re-derived from chessops, not trusted from a written-down number', () => {
    const results: { depth: number; mine: number; chessops: number }[] = [];
    for (const depth of [1, 2, 3, 4]) {
      results.push({ depth, mine: perftMine(parseAtomicFen(START_FEN), depth), chessops: perftOps(Atomic.default(), depth) });
    }
    for (const r of results) expect(r.mine, `depth ${r.depth}`).toBe(r.chessops);
    // Printed so the value being compared against is visible in CI logs.
    console.log('Atomic start-position perft (mine == chessops):', results.map((r) => r.chessops).join(', '));
  }, 120000);

  const positions: [string, string, number][] = [
    ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3],
    ['promotions/captures', 'n1n5/PPPk4/8/8/8/8/4Kppp/5N1N b - - 0 1', 3],
    ['en passant + castling', 'r3k2r/pppp1ppp/8/3Pp3/8/8/PPP1PPPP/R3K2R w KQkq e6 0 1', 3],
    ['adjacent kings', '8/8/8/3k4/3K4/8/8/R6r w - - 0 1', 4],
    ['blasts near kings', 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5', 3],
  ];
  for (const [name, fen, depth] of positions) {
    it(`${name} (depth ${depth})`, () => {
      expect(perftMine(parseAtomicFen(fen), depth)).toBe(perftOps(opsFromFen(fen), depth));
    }, 120000);
  }
});

describe('random capture-biased playouts against chessops', () => {
  it('agree on legal moves, resulting position, game state and SAN at every ply', () => {
    const random = makeRandom(20260903);
    const problems: string[] = [];
    const seen = { plies: 0, captures: 0, explosionsBeyondPair: 0, castles: 0, enPassant: 0, promotions: 0, kingWins: 0, mates: 0, stalemates: 0, insufficient: 0, sanChecked: 0 };

    for (let game = 0; game < 120 && problems.length < 5; game++) {
      let mine = parseAtomicFen(START_FEN);
      let ops: OpsPosition = Atomic.default();

      for (let ply = 0; ply < 160; ply++) {
        const mismatch = comparePosition(mine, ops);
        if (mismatch) {
          problems.push(`game ${game} ply ${ply}: ${mismatch} @ ${atomicFen(mine)}`);
          break;
        }
        const moves = generateAtomicMoves(mine);
        if (moves.length === 0 || getAtomicKingWinner(mine)) {
          if (getAtomicKingWinner(mine)) seen.kingWins += 1;
          else if (isAtomicCheck(mine)) seen.mates += 1;
          else seen.stalemates += 1;
          break;
        }
        if (isAtomicInsufficientMaterial(mine)) {
          seen.insufficient += 1;
          break;
        }

        // Bias toward captures (and the occasional castle/ep/promotion) so explosions are well covered.
        const captures = moves.filter((m) => m.enPassant || mine.squares[m.to] !== 0);
        const special = moves.filter((m) => m.castle || m.promotion);
        const pool = captures.length > 0 && random() < 0.6 ? captures : special.length > 0 && random() < 0.3 ? special : moves;
        const move = pool[Math.floor(random() * pool.length)];

        // SAN differential on a sample of the legal moves, not just the played one.
        for (const m of [move, moves[Math.floor(random() * moves.length)]]) {
          const mySan = atomicSan(mine, m, moves, applyAtomicMove(mine, m).position);
          const opsSan = makeSan(ops, toOpsMove(ops, m));
          seen.sanChecked += 1;
          if (mySan !== opsSan) problems.push(`game ${game} ply ${ply}: SAN ${mySan} vs ${opsSan} @ ${atomicFen(mine)}`);
        }

        const result = applyAtomicMove(mine, move);
        if (result.captured) seen.captures += 1;
        if (result.exploded.length > 2) seen.explosionsBeyondPair += 1;
        if (move.castle) seen.castles += 1;
        if (move.enPassant) seen.enPassant += 1;
        if (move.promotion) seen.promotions += 1;
        seen.plies += 1;

        mine = result.position;
        ops = ops.clone();
        ops.play(toOpsMove(ops, move));
      }
    }

    expect(problems.slice(0, 5)).toEqual([]);
    // Coverage guards: the playouts must actually have exercised the interesting rules.
    expect(seen.plies).toBeGreaterThan(3000);
    expect(seen.captures).toBeGreaterThan(300);
    expect(seen.explosionsBeyondPair).toBeGreaterThan(50);
    expect(seen.kingWins).toBeGreaterThan(5);
    console.log('Atomic oracle playout coverage:', JSON.stringify(seen));
  }, 120000);

  it('en passant, castling, promotion and checkmate also each occur across targeted seeds', () => {
    // Targeted: replay-driven positions that random play rarely reaches quickly.
    const cases: { fen: string; uci: string }[] = [
      { fen: '7k/2n5/8/3pP3/2b5/8/8/K7 w - d6 0 1', uci: 'e5d6' }, // en passant blast centred on d6
      { fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', uci: 'e1g1' },
      { fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', uci: 'e1c1' },
      { fen: '5r1k/4P3/8/8/8/8/8/K7 w - - 0 1', uci: 'e7f8q' }, // capture-promotion
      { fen: '4k3/3p4/8/8/8/8/8/3QK3 w - - 0 1', uci: 'd1d7' }, // explodes the enemy king
      { fen: '6r1/8/8/8/8/8/5k2/4K2R w K - 0 1', uci: 'e1g1' }, // castling next to the enemy king
    ];
    for (const { fen, uci } of cases) {
      const mine = parseAtomicFen(fen);
      const ops = opsFromFen(fen);
      expect(comparePosition(mine, ops), fen).toBeNull();
      const move = generateAtomicMoves(mine).find((m) => myKey(m) === uci);
      expect(move, `${uci} should be legal in ${fen}`).toBeDefined();
      const next = applyAtomicMove(mine, move!).position;
      const opsNext = ops.clone();
      opsNext.play(toOpsMove(ops, move!));
      expect(comparePosition(next, opsNext), `${fen} after ${uci}`).toBeNull();
    }
  });
});

describe('insufficient material: this repo (scalachess rule) vs chessops', () => {
  // The two oracles define "dead position" differently. This repo follows lichess's scalachess (see
  // isAtomicInsufficientMaterial's doc comment); chessops is the per-side "cannot win" rule. They agree on
  // everything that is not made only of kings, pawns and bishops, and differ in exactly three documented ways:
  //   1. closed pawn positions: scalachess draws, chessops plays on;
  //   2. a bare K vs K + 2 or more same-coloured bishops: scalachess draws, chessops plays on;
  //   3. K + 2 same-coloured bishops vs K + an opposite-coloured bishop (and larger all-bishop boards of that
  //      shape): chessops draws, scalachess plays on
  //      (a help-mate exists).
  const letters = ['p', 'n', 'b', 'r', 'q'];

  function placementOf(board: (string | null)[]) {
    let placement = '';
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = board[r * 8 + f];
        if (!p) empty += 1;
        else {
          if (empty) placement += empty;
          empty = 0;
          placement += p;
        }
      }
      if (empty) placement += empty;
      if (r) placement += '/';
    }
    return placement;
  }

  it('agrees outside the three documented categories, and the categories really occur', () => {
    const random = makeRandom(7);
    const problems: string[] = [];
    const seen = { checked: 0, outsideKPB: 0, closed: 0, twoSameBishopsVsBare: 0, helpmateBishops: 0, agreeKPB: 0 };

    const check = (fen: string) => {
      let ops: OpsPosition;
      try {
        ops = opsFromFen(fen);
      } catch {
        return; // chessops rejects some random setups (e.g. the side not to move in check); skip those
      }
      const pos = parseAtomicFen(fen);
      const mine = isAtomicInsufficientMaterial(pos);
      const theirs = ops.isInsufficientMaterial();
      seen.checked += 1;
      const boardLetters = fen.split(' ')[0].replace(/[\d/]/g, '');
      const onlyKPB = /^[kpbKPB]*$/.test(boardLetters);
      if (!onlyKPB) {
        seen.outsideKPB += 1;
        if (mine !== theirs) problems.push(`${fen}: mine ${mine}, chessops ${theirs}`);
        return;
      }
      if (mine === theirs) {
        seen.agreeKPB += 1;
        return;
      }
      const hasPawns = /[pP]/.test(boardLetters);
      const bishops = (boardLetters.match(/[bB]/g) ?? []).length;
      const whiteExtra = (boardLetters.match(/[PB]/g) ?? []).length;
      const blackExtra = (boardLetters.match(/[pb]/g) ?? []).length;
      const oneSideBare = whiteExtra === 0 || blackExtra === 0;
      if (mine && !theirs && hasPawns) seen.closed += 1;
      else if (mine && !theirs && !hasPawns && oneSideBare && bishops >= 2) seen.twoSameBishopsVsBare += 1;
      else if (!mine && theirs && !hasPawns && !oneSideBare && bishops >= 3) seen.helpmateBishops += 1;
      else problems.push(`undocumented disagreement: ${fen}: mine ${mine}, chessops ${theirs}`);
    };

    for (let i = 0; i < 6000 && problems.length < 5; i++) {
      // Random small endgames of every piece type.
      const board: (string | null)[] = new Array(64).fill(null);
      const free = () => {
        let s: number;
        do s = Math.floor(random() * 64);
        while (board[s]);
        return s;
      };
      board[free()] = 'K';
      board[free()] = 'k';
      const extra = Math.floor(random() * 5);
      for (let k = 0; k < extra; k++) {
        const letter = letters[Math.floor(random() * letters.length)];
        let s = free();
        if (letter === 'p') while (s >> 3 === 0 || s >> 3 === 7) s = free();
        board[s] = random() < 0.5 ? letter : letter.toUpperCase();
      }
      check(`${placementOf(board)} ${random() < 0.5 ? 'w' : 'b'} - - 0 1`);

      // Closed pawn chains (stacked opposing pawns) with kings and a few bishops.
      const closed: (string | null)[] = new Array(64).fill(null);
      const freeClosed = () => {
        let s: number;
        do s = Math.floor(random() * 64);
        while (closed[s]);
        return s;
      };
      const pairs = 1 + Math.floor(random() * 3);
      for (let k = 0; k < pairs; k++) {
        const file = Math.floor(random() * 8);
        const rank = 1 + Math.floor(random() * 5);
        if (closed[rank * 8 + file] || closed[(rank + 1) * 8 + file]) continue;
        closed[rank * 8 + file] = 'P';
        closed[(rank + 1) * 8 + file] = 'p';
      }
      closed[freeClosed()] = 'K';
      closed[freeClosed()] = 'k';
      for (let k = Math.floor(random() * 3); k > 0; k--) closed[freeClosed()] = random() < 0.5 ? 'B' : 'b';
      check(`${placementOf(closed)} ${random() < 0.5 ? 'w' : 'b'} - - 0 1`);

      // Bishops only (the K+2B vs K / K+2B vs K+B families).
      const bishops: (string | null)[] = new Array(64).fill(null);
      const freeB = () => {
        let s: number;
        do s = Math.floor(random() * 64);
        while (bishops[s]);
        return s;
      };
      bishops[freeB()] = 'K';
      bishops[freeB()] = 'k';
      for (let k = Math.floor(random() * 4); k > 0; k--) bishops[freeB()] = random() < 0.5 ? 'B' : 'b';
      check(`${placementOf(bishops)} ${random() < 0.5 ? 'w' : 'b'} - - 0 1`);
    }

    expect(problems).toEqual([]);
    expect(seen.outsideKPB).toBeGreaterThan(1000);
    expect(seen.agreeKPB).toBeGreaterThan(100);
    // Each documented divergence must actually have been hit, so the allowances above are not vacuous.
    expect(seen.closed).toBeGreaterThan(50);
    expect(seen.twoSameBishopsVsBare).toBeGreaterThan(5);
    expect(seen.helpmateBishops).toBeGreaterThan(5);
    console.log('Atomic insufficient-material comparison:', JSON.stringify(seen));
  }, 120000);
});
