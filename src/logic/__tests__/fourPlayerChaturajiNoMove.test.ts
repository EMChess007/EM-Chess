import { describe, expect, it } from 'vitest';
import { CHATURAJI_RULES, SQUARE8, advance, isInCheck, kingsAttackedBy, legalMoves, playMove, pseudoMoves, stateFromPieces, type FourPlayerState, type GameEvent, type Move, type Seat } from '../fourPlayer';

/**
 * CHATURAJI W2 - the open item of W1: "a seat with no legal move is eliminated as STALEMATED, even when its king is attacked - under Capture the King
 * nothing is ever 'checkmated'". The engine has a branch for it (`advance`: `inCheck ? 'checkmate' : 'stalemate'`, switched off by Capture the King), and
 * W1 ARGUED that under Capture the King a seat with no pseudo-legal move can never have its king attacked, so that branch is unreachable and the mutant
 * that removes the gate is equivalent. THAT ARGUMENT WAS WRONG. This file settles the question by exhaustive search instead of by argument, and the answer is:
 *
 *   A seat with no pseudo-legal move CAN have its king attacked - but ONLY by a KNIGHT. A slider that attacks a king has an empty square next to it on its
 *   line (the king may step there) or is adjacent (the king may take it); a pawn or a king attacks only adjacent squares (the king may take it); a knight
 *   attacks from outside the king's neighbourhood, so a king whose neighbours are all its own immobile pieces can be attacked and still have no move.
 *   The smallest example: Blue's king on h1 walled in by its own pawns on g1, g2 and h2 (they push towards the h-file and are blocked by each other and by
 *   the edge) and a Red knight on f2 or g3, which none of Blue's pieces can take.
 *
 * So the branch IS reachable and the engine's answer is the one the spec asks for - eliminated, reason `stalemate`, NO points, NO credit (it is not a checkmate:
 * there is none under Capture the King). The mutant "a no-move seat is 'checkmated' when its king is attacked" is therefore NOT equivalent: it would announce
 * `checkmate` and credit the knight's owner. A hand-built test below pins the behaviour, and the search pins the claim.
 *
 * THE SEARCH (complete, with the ENGINE as the oracle for every move list). Blue's army has at most one king, one bishop, one knight and five boats-or-pawns
 * (at most four of them pawns): 8 pieces in all, nothing can add a piece. Seeds: every Blue king square x every enemy piece (a Red pawn / knight / bishop /
 * boat / king, a Yellow pawn, a Green pawn) on every other square, kept only when that piece attacks the king IN ISOLATION (a position in which the king is
 * attacked has such a seed: removing other pieces can only unblock attacks). From a seed the position grows until Blue has no move: take the engine's
 * pseudo-legal moves of Blue; if one is a capture of an enemy piece the branch is dead (pieces are never removed); otherwise pick the move with the fewest ways
 * to be removed and branch over them - a Blue piece (any type the budget allows) on any square of the move's path (a slider's path or a single target), or, for
 * a pawn push only, an enemy plug on the target (a pawn cannot capture straight ahead). Every solution removes that move, so the search is complete. A branch
 * is dead when the seed no longer attacks the king (adding pieces can only block it; a later attacker would be its own seed). A leaf with no Blue move and an
 * attacked king is a position of the kind in question.
 */
const BLUE: Seat = 1;
const sq = (name: string) => SQUARE8.parseSquare(name);
const name = (s: number) => SQUARE8.squareName(s);

type Letter = 'P' | 'N' | 'B' | 'R';
const OWN_LETTERS: Letter[] = ['P', 'N', 'B', 'R'];
const ENEMY_TYPES = ['rP', 'rN', 'rB', 'rR', 'rK', 'yP', 'gP'];

interface Node {
  own: string[]; // 'bK@a8'
  enemy: string[];
}

const build = (node: Node): FourPlayerState => stateFromPieces([...node.own, ...node.enemy], { rules: CHATURAJI_RULES, turn: BLUE });

/** Squares a move is removed by occupying: a slider's whole path (target included), otherwise the target alone. */
function pathSquares(state: FourPlayerState, move: Move): number[] {
  const type = state.cells[move.from] & 15;
  const isSlider = type === 3 || type === 4 || type === 5 || type === 7 || type === 9 || type === 10;
  if (!isSlider) return [move.to];
  const df = Math.sign(SQUARE8.fileOf(move.to) - SQUARE8.fileOf(move.from));
  const dr = Math.sign(SQUARE8.rankOf(move.to) - SQUARE8.rankOf(move.from));
  const out: number[] = [];
  for (let f = SQUARE8.fileOf(move.from) + df, r = SQUARE8.rankOf(move.from) + dr; ; f += df, r += dr) {
    const s = SQUARE8.index(f, r);
    out.push(s);
    if (s === move.to) break;
  }
  return out;
}

function budgetOk(own: string[], letter: Letter): boolean {
  const count = (l: string) => own.filter((p) => p[1] === l).length;
  if (own.length + 1 > 8) return false;
  if (letter === 'B' && count('B') >= 1) return false;
  if (letter === 'N' && count('N') >= 1) return false;
  if (letter === 'P' && count('P') >= 4) return false;
  if ((letter === 'P' || letter === 'R') && count('P') + count('R') >= 5) return false;
  return true;
}

interface Leaf {
  key: string;
  attacker: string; // the seed's piece type, e.g. 'rN'
}
interface Stats {
  nodes: number;
  leaves: number;
  attackedLeaves: Leaf[];
}

function search(node: Node, xSquare: number | null, attacker: string, stats: Stats, seen: Set<string>): void {
  const key = [...node.own].sort().join(',') + '|' + [...node.enemy].sort().join(',');
  if (seen.has(key)) return;
  seen.add(key);
  stats.nodes++;
  const state = build(node);
  if (xSquare !== null && kingsAttackedBy(state, xSquare) < 1) return; // the seed no longer attacks the king: blocked for good
  const moves = pseudoMoves(state, BLUE);
  if (moves.length === 0) {
    stats.leaves++;
    if (isInCheck(state, BLUE)) stats.attackedLeaves.push({ key, attacker });
    return;
  }
  if (moves.some((m) => m.captured !== 0)) return; // a capture of an enemy piece can never be removed
  let best: { squares: number[]; plug: boolean; options: number } | null = null;
  for (const move of moves) {
    const plug = (state.cells[move.from] & 15) === 1; // a pawn push can also be removed by an enemy piece in front of it
    const squares = pathSquares(state, move).filter((s) => state.cells[s] === 0);
    const options = squares.length * (OWN_LETTERS.length + (plug ? ENEMY_TYPES.length : 0));
    if (!best || options < best.options) best = { squares, plug, options };
  }
  for (const s of best!.squares) {
    for (const letter of OWN_LETTERS) {
      if (budgetOk(node.own, letter)) search({ own: [...node.own, `b${letter}@${name(s)}`], enemy: node.enemy }, xSquare, attacker, stats, seen);
    }
    if (best!.plug && node.enemy.length < 5) {
      for (const type of ENEMY_TYPES) {
        if (type === 'rK' && node.enemy.some((e) => e.startsWith('rK'))) continue;
        search({ own: node.own, enemy: [...node.enemy, `${type}@${name(s)}`] }, xSquare, attacker, stats, seen);
      }
    }
  }
}

/** The elimination the engine produces when the turn reaches Blue, with Red (seat 0) having just moved. */
function eliminationOf(state: FourPlayerState): GameEvent[] {
  const events: GameEvent[] = [];
  advance({ ...state, turn: 0 }, events);
  return events;
}

describe('Capture the King: a seat with no move can have its king attacked - but only by a knight (exhaustive search)', () => {
  const stats: Stats = { nodes: 0, leaves: 0, attackedLeaves: [] };
  let seeds = 0;

  it('over every Blue king square and every attacker, the positions with no Blue move and an attacked king exist, and their attacker is ALWAYS a knight', { timeout: 600_000 }, () => {
    for (let k = 0; k < 64; k++) {
      for (const type of ENEMY_TYPES) {
        for (let x = 0; x < 64; x++) {
          if (x === k) continue;
          if (type === 'rP' && SQUARE8.rankOf(x) === 7) continue; // an enemy pawn on its far edge cannot exist (it promotes)
          if (type === 'yP' && SQUARE8.rankOf(x) === 0) continue;
          if (type === 'gP' && SQUARE8.fileOf(x) === 0) continue;
          const seed: Node = { own: [`bK@${name(k)}`], enemy: [`${type}@${name(x)}`] };
          if (kingsAttackedBy(build(seed), x) < 1) continue; // it must attack the king on its own
          seeds++;
          search(seed, x, type, stats, new Set());
        }
      }
    }
    // eslint-disable-next-line no-console
    console.info('no-move + attacked-king search:', { seeds, nodes: stats.nodes, noMoveLeaves: stats.leaves, withAnAttackedKing: stats.attackedLeaves.length, attackers: [...new Set(stats.attackedLeaves.map((l) => l.attacker))] });
    expect(seeds).toBeGreaterThan(1000);
    expect(stats.attackedLeaves.length).toBeGreaterThan(100); // so the case is REAL: the "unreachable" argument of W1 was wrong
    expect([...new Set(stats.attackedLeaves.map((l) => l.attacker))]).toEqual(['rN']); // and a slider, pawn or king attacker never leaves Blue without a move
  });

  it('the smallest positions found are the walled-in corner king with a knight outside (and nothing smaller exists: 3 pawns is the minimum)', () => {
    const smallest = stats.attackedLeaves.map((l) => l.key).sort((a, b) => a.length - b.length);
    expect(smallest.slice(0, 4)).toEqual(expect.arrayContaining(['bK@h1,bP@g1,bP@g2,bP@h2|rN@f2', 'bK@h1,bP@g1,bP@g2,bP@h2|rN@g3']));
    for (const key of smallest.slice(0, 4)) expect(key.split('|')[0].split(',').length).toBe(4); // a king and three pawns
  });

  it('every one of them (a sample of 400 across the whole set) is eliminated by the ENGINE as `stalemate`: no credit, no points - there is no checkmate under Capture the King', () => {
    const keys = stats.attackedLeaves.map((l) => l.key);
    const sample = keys.filter((_, i) => i % Math.max(1, Math.floor(keys.length / 400)) === 0);
    expect(sample.length).toBeGreaterThanOrEqual(200);
    for (const key of sample) {
      const [own, enemy] = key.split('|');
      const state = stateFromPieces([...own.split(','), ...enemy.split(',')], { rules: CHATURAJI_RULES, turn: 0 });
      expect(pseudoMoves(state, BLUE), key).toEqual([]);
      expect(isInCheck(state, BLUE), key).toBe(true);
      // (the hand-built positions have no Yellow / Green army, so those seats are stalemated too: look at Blue's elimination)
      const blue = eliminationOf(state).filter((e) => e.kind === 'eliminated' && e.seat === BLUE);
      expect(blue, key).toEqual([{ kind: 'eliminated', seat: BLUE, reason: 'stalemate', credit: null, points: [0, 0, 0, 0] }]);
    }
  });
});

describe('the smallest example, by hand (this is what kills the mutant "a no-move seat is checkmated when its king is attacked")', () => {
  const position = () => stateFromPieces(['bK@h1', 'bP@g1', 'bP@g2', 'bP@h2', 'rK@a1', 'rN@f2', 'yK@h8', 'gK@a8'], { rules: CHATURAJI_RULES, turn: 0 });

  it('Blue has no move although its king is attacked by the knight on f2', () => {
    const state = position();
    expect(isInCheck(state, BLUE)).toBe(true);
    expect(kingsAttackedBy(state, sq('f2'))).toBe(1);
    expect(legalMoves(state, BLUE)).toEqual([]);
    expect(pseudoMoves(state, BLUE)).toEqual([]);
  });

  it('when the turn reaches Blue it is eliminated as STALEMATED: no credit for the knight, no points, no checkmate event', () => {
    const state = position();
    const out = playMove(state, legalMoves(state, 0).find((m) => m.from === sq('a1'))!, () => 0);
    expect(out.events.map((e) => e.kind)).toEqual(['move', 'eliminated']);
    expect(out.events[1]).toEqual({ kind: 'eliminated', seat: BLUE, reason: 'stalemate', credit: null, points: [0, 0, 0, 0] });
    expect(out.state.score).toEqual([0, 0, 0, 0]);
    expect(out.state.status[BLUE]).toBe('dead-king'); // the (walled-in) king stays on h1; its army is inactive
  });

  it('a slider that attacks the king always leaves it a move: the same king with h2 empty and a Red boat on h5 can step to h2', () => {
    const state = stateFromPieces(['bK@h1', 'bP@g1', 'bP@g2', 'rK@a1', 'rR@h5', 'yK@h8', 'gK@a8'], { rules: CHATURAJI_RULES, turn: 1 });
    expect(isInCheck(state, BLUE)).toBe(true);
    expect(pseudoMoves(state, BLUE).some((m) => m.from === sq('h1') && m.to === sq('h2'))).toBe(true);
  });
});
