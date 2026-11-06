/**
 * The CRAZYHOUSE GOLDEN TRANSCRIPTS (BUGHOUSE_SPEC.md section 7, W0): the gate that says "the 2-player Crazyhouse rules did not move" while Bughouse adds exports to
 * `crazyhouse.ts`. Recorded on master BEFORE that file was touched, with the engine exactly as it shipped.
 *
 * `recordCrazyhouseGame(seed)` plays one seeded game and `recordCrazyhouseScene(name)` plays a hand-built position with a scripted list of turns; both return a text
 * transcript of everything observable: at every step the FEN, the reserves and the promoted squares, the full list of legal moves AND legal drops of the side to move,
 * the engine's status, the turn taken (with the SAN the engine wrote) and the state after it. `crazyhouseGolden.test.ts` hashes them against
 * `fixtures/crazyhouseGolden.json`. A hash that moves means a Crazyhouse rule moved - a bug unless it was deliberate (then regenerate the fixture in the same commit and
 * say so). The bot is deliberately NOT part of it (its choice depends on a clock-free but search-heavy evaluation that the bot tests and the benchmark already pin).
 *
 *   backend/node_modules/.bin/tsx src/logic/__tests__/crazyhouseGoldenKit.ts --record     (rewrites the fixture; only for a deliberate rule change)
 *
 * Deterministic by construction: seeded mulberry32 for every choice, no clock and no Date. The seeded games are biased towards the events the spec lists (captures, drops,
 * drops that give check, pawn promotions, castling, en passant, the double step of a dropped pawn; every fifth game starts from kings and pawn pockets) and
 * `recordAllCrazyhouseGames().coverage` counts what the games really reached, so the gate cannot quietly become vacuous.
 */
import { ChessEngine } from '../ChessEngine';
import { getCrazyhouseMoves, initialCrazyhouseState, type CrazyhouseState, type ReservePieceType } from '../crazyhouse';
import { START_FEN } from '../../types/chess';
import { mulberry32, sha256 } from './fourPlayerGoldenKit';

export { sha256 };

type Turn = { kind: 'move'; from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n'; capture: boolean } | { kind: 'drop'; piece: ReservePieceType; square: string };

const uci = (t: Turn) => (t.kind === 'move' ? `${t.from}${t.to}${t.promotion ?? ''}` : `${t.piece}@${t.square}`);

function newEngine(fen: string, state: CrazyhouseState): ChessEngine {
  return new ChessEngine(fen, { crazyhouse: true, crazyhouseState: state });
}

/** Every legal turn of the side to move, sorted (moves, then drops) so the order is the same on every run and every engine version that agrees on the rules. */
function legalTurns(engine: ChessEngine): Turn[] {
  const moves: Turn[] = getCrazyhouseMoves(engine).map((m) => ({ kind: 'move', from: m.from, to: m.to, promotion: m.promotion as 'q' | 'r' | 'b' | 'n' | undefined, capture: Boolean(m.captured) }));
  moves.sort((a, b) => (uci(a) < uci(b) ? -1 : uci(a) > uci(b) ? 1 : 0));
  const drops: Turn[] = engine.getLegalDrops().map((d) => ({ kind: 'drop', piece: d.piece, square: d.square }));
  drops.sort((a, b) => (uci(a) < uci(b) ? -1 : uci(a) > uci(b) ? 1 : 0));
  return [...moves, ...drops];
}

const stateText = (state: CrazyhouseState) => JSON.stringify({ w: state.reserve.w, b: state.reserve.b, promoted: state.promoted });

/** The text of one position: everything a rule change could show in. */
function positionText(engine: ChessEngine, turns: Turn[]): string {
  return [
    `fen ${engine.getFen()}`,
    `state ${stateText(engine.getCrazyhouseState())}`,
    `status ${engine.getStatus()} over ${engine.isGameOver()} count ${engine.getLegalMoveCount()}`,
    `moves ${turns.filter((t) => t.kind === 'move').map(uci).join(' ')}`,
    `drops ${turns.filter((t) => t.kind === 'drop').map(uci).join(' ')}`,
  ].join('\n');
}

/** Plays one turn through the public engine API; returns the SAN or null when the engine refuses it. */
function playTurn(engine: ChessEngine, turn: Turn): string | null {
  const result = turn.kind === 'drop' ? engine.drop(turn.piece, turn.square) : engine.move(turn.from, turn.to, turn.promotion);
  return result ? result.san : null;
}

export interface CrazyhouseCoverage {
  moves: number;
  captures: number;
  drops: number;
  dropChecks: number;
  dropMates: number;
  promotions: number;
  promotedCaptured: number;
  castles: number;
  enPassants: number;
  enPassantAfterDroppedPawn: number;
  games: number;
  mates: number;
}

export function emptyCoverage(): CrazyhouseCoverage {
  return { moves: 0, captures: 0, drops: 0, dropChecks: 0, dropMates: 0, promotions: 0, promotedCaptured: 0, castles: 0, enPassants: 0, enPassantAfterDroppedPawn: 0, games: 0, mates: 0 };
}

/** Where a seeded game starts: the standard position, or - for every fifth seed - kings and pawn-heavy pockets, where pawn drops, double steps and en passant happen fast. */
function startOf(seed: number): { fen: string; state: CrazyhouseState } {
  const state = initialCrazyhouseState();
  if (seed % 5 !== 0) return { fen: START_FEN, state };
  Object.assign(state.reserve.w, { p: 6, n: 1, b: 1 });
  Object.assign(state.reserve.b, { p: 6, n: 1, b: 1 });
  return { fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', state };
}

/** A weighted pick (floating weights, in list order): deterministic for a given rng. */
function weightedPick<T>(items: T[], weight: (item: T) => number, rng: () => number): T {
  let total = 0;
  for (const item of items) total += weight(item);
  let pick = rng() * total;
  for (const item of items) {
    pick -= weight(item);
    if (pick < 0) return item;
  }
  return items[items.length - 1];
}

/** Plays one seeded game (see the file header); optionally adds what it reached to `coverage`. */
export function recordCrazyhouseGame(seed: number, maxPlies = 170, coverage?: CrazyhouseCoverage): string {
  const rng = mulberry32(seed);
  const start = startOf(seed);
  const engine = newEngine(start.fen, start.state);
  const out: string[] = [`game ${seed}`];
  const droppedPawns = new Set<string>(); // squares of pawns that came onto the board by a DROP (to see an en passant capture of one that then double-stepped)
  for (let ply = 0; ply < maxPlies && !engine.isGameOver(); ply++) {
    const turns = legalTurns(engine);
    if (turns.length === 0) break;
    out.push(`ply ${ply} turn ${engine.getTurn()}`, positionText(engine, turns));
    // Stage one: a drop or a move. Drops are rare in a uniform choice (a position has a few dozen moves and, once a reserve is filled, a few hundred drops), so half of the
    // turns that have a drop take one. Stage two: inside the category the weights favour what the golden must reach - captures and promotions (5), castling and en passant
    // (40), the double step of a pawn that was DROPPED (20), development in the first 24 plies (3), and a king walk is discouraged (0.3, so castling stays possible); among
    // drops a pawn on its second rank weighs 6, and half of the drop choices try up to six random drops for one that gives check.
    const drops = turns.filter((t) => t.kind === 'drop');
    const moves = turns.filter((t) => t.kind === 'move');
    const epSquare = engine.getFen().split(' ')[3];
    const turn = engine.getTurn();
    const moveWeight = (t: Turn): number => {
      if (t.kind !== 'move') return 0;
      const piece = engine.getPieceAt(t.from);
      if (piece?.type === 'p' && t.to === epSquare && t.from[0] !== t.to[0]) return 40;
      if (piece?.type === 'k' && Math.abs(t.from.charCodeAt(0) - t.to.charCodeAt(0)) === 2) return 40;
      if (piece?.type === 'p' && Math.abs(Number(t.to[1]) - Number(t.from[1])) === 2) return droppedPawns.has(t.from) ? 20 : 2.5;
      if (t.capture || t.promotion) return 5;
      if (piece?.type === 'k') return 0.3;
      if (ply < 24 && piece && (piece.type === 'n' || piece.type === 'b' || piece.type === 'q')) return 3;
      return 1;
    };
    const dropWeight = (t: Turn): number => (t.kind === 'drop' && t.piece === 'p' && t.square[1] === (turn === 'w' ? '2' : '7') ? 6 : 1);
    let chosen: Turn;
    if (drops.length > 0 && (moves.length === 0 || rng() < 0.5)) {
      chosen = weightedPick(drops, dropWeight, rng);
      if (rng() < 0.5) {
        for (let attempt = 0; attempt < 6; attempt++) {
          const candidate = drops[Math.floor(rng() * drops.length)];
          const probe = newEngine(engine.getFen(), engine.getCrazyhouseState());
          probe.drop((candidate as { piece: ReservePieceType }).piece, (candidate as { square: string }).square);
          if (probe.getStatus() === 'check' || probe.getStatus() === 'checkmate') {
            chosen = candidate;
            break;
          }
        }
      }
    } else {
      chosen = weightedPick(moves, moveWeight, rng);
    }
    const before = engine.getCrazyhouseState();
    const mover = engine.getTurn();
    const movedPawn = chosen.kind === 'move' && engine.getPieceAt(chosen.from)?.type === 'p';
    const san = playTurn(engine, chosen);
    if (san === null) throw new Error(`the engine refused its own legal turn ${uci(chosen)} at ply ${ply} of game ${seed}`);
    out.push(`play ${uci(chosen)} san ${san}`, `after ${stateText(engine.getCrazyhouseState())} status ${engine.getStatus()}`);
    if (coverage) {
      coverage.moves++;
      if (chosen.kind === 'drop') {
        coverage.drops++;
        if (san.endsWith('+')) coverage.dropChecks++;
        if (san.endsWith('#')) coverage.dropMates++;
        if (chosen.piece === 'p') droppedPawns.add(chosen.square);
      } else {
        if (chosen.capture) coverage.captures++;
        if (chosen.promotion) coverage.promotions++;
        if (san.startsWith('O-O')) coverage.castles++;
        // a promoted piece captured: the capturer's reserve gained a pawn although the captured piece is not a pawn
        if (chosen.capture && before.promoted.includes(chosen.to) && engine.getCrazyhouseState().reserve[mover].p - before.reserve[mover].p === 1) coverage.promotedCaptured++;
        const enPassant = movedPawn && chosen.to === epSquare && chosen.from[0] !== chosen.to[0];
        const steppedPawn = `${chosen.to[0]}${chosen.from[1]}`; // where the pawn taken en passant stood
        if (enPassant) {
          coverage.enPassants++;
          if (droppedPawns.has(steppedPawn)) coverage.enPassantAfterDroppedPawn++;
          droppedPawns.delete(steppedPawn);
        }
        // a dropped pawn keeps its mark while it walks and loses it when it is captured or promotes
        droppedPawns.delete(chosen.to);
        if (droppedPawns.delete(chosen.from) && !chosen.promotion) droppedPawns.add(chosen.to);
      }
    }
  }
  out.push(`final ${engine.getFen()} ${stateText(engine.getCrazyhouseState())} status ${engine.getStatus()}`);
  if (coverage) {
    coverage.games++;
    if (engine.getStatus() === 'checkmate') coverage.mates++;
  }
  return out.join('\n') + '\n';
}

// --- hand-built scenes ---------------------------------------------------------------------------------------------------------------------

interface Scene {
  fen: string;
  white?: Partial<Record<ReservePieceType, number>>;
  black?: Partial<Record<ReservePieceType, number>>;
  /** Turns in order: "e2e4", "a7a8q" (promotion), "N@f3" (drop); a leading "!" means the engine must REFUSE it (and the position is unchanged). */
  script: string[];
}

const SCENES: Record<string, Scene> = {
  // a capture banks the piece for the capturer; both sides drop what they hold
  captureThenDrop: { fen: 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2', script: ['e4d5', 'd8d5', 'b1c3', 'd5a5', 'P@e5', 'P@e4', 'g1f3', 'b8c6'] },
  // a drop gives check, the king answers, a second drop gives check again
  dropCheck: { fen: 'k7/8/8/8/8/8/8/4K3 w - - 0 1', white: { n: 1, q: 1 }, script: ['N@b6', 'a8a7', 'Q@c7', 'a7a6'] },
  // in check by a sliding piece the only legal drops are the squares in between; a captured blocker feeds the capturer's reserve and the next block is a drop again
  dropBlocksCheck: { fen: '4k3/8/8/8/8/8/8/r3K3 w - - 0 1', white: { n: 1, r: 1, p: 1 }, script: ['!P@c1', '!N@a2', 'N@c1', 'a1c1', 'R@d1', 'c1d1', 'e1d1'] },
  // a drop delivers checkmate
  dropMate: { fen: '7k/6pp/8/8/8/8/8/4K3 w - - 0 1', white: { q: 1 }, script: ['Q@e8'] },
  // the same drop is answered by a drop: not mate; the capture of the blocker then is mate
  mateAnsweredByDrop: { fen: '7k/6pp/8/8/8/8/8/4K3 w - - 0 1', white: { q: 1 }, black: { b: 1 }, script: ['Q@e8', 'B@f8', 'e8f8'] },
  // a promoted queen captured returns as a PAWN; the pawn is dropped by the capturer
  promotionCapture: { fen: '7r/P3k3/8/8/8/8/8/4K3 w - - 0 1', script: ['a7a8q', 'h8a8', 'e1e2', 'P@a2', 'e2e3'] },
  // an ordinary queen captured returns as a queen
  queenCaptureKeepsType: { fen: 'q3k3/8/8/8/8/8/8/Q3K3 w - - 0 1', script: ['a1a8', 'e8e7', 'Q@e4'] },
  // castling both ways; a king-side right is gone for good once the rook has moved, a rook dropped back on h1 does not restore it
  castling: { fen: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1', script: ['e1g1', 'e8c8'] },
  castlingRightsNotRestored: { fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', script: ['h1h8', 'e8d7', 'R@h1', 'd7d6', '!e1g1', 'e1d2'] },
  // a pawn dropped on its second rank can double-step, and the opponent can take it en passant
  enPassantAfterDrop: { fen: '4k3/8/8/8/3p4/8/8/4K3 w - - 0 1', white: { p: 1 }, script: ['P@e2', 'e8d8', 'e2e4', 'd4e3'] },
  // a drop is a turn: it clears the en passant square, so the capture is no longer legal
  dropClearsEnPassant: { fen: '4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1', white: { p: 1 }, script: ['d7d5', 'P@a2', 'e8e7', '!e5d6', 'e5e6'] },
  // a pawn is never dropped on the first or eighth rank
  pawnDropRanks: { fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', white: { p: 1, n: 1 }, script: ['!P@a1', '!P@a8', 'N@a8', 'e8d7', 'P@h2'] },
  // a knight check cannot be blocked: no drop is legal, and neither is a drop elsewhere
  knightCheckNoDrop: { fen: '4k3/8/8/8/8/3n4/8/4K3 w - - 0 1', white: { q: 1, r: 1 }, script: ['!Q@e2', '!R@a4', 'e1d1'] },
  // a double check: no drop at all
  doubleCheckNoDrop: { fen: 'k3r3/8/8/8/8/3n4/8/4K3 w - - 0 1', white: { q: 1, r: 1, n: 1, b: 1, p: 1 }, script: ['!Q@e2', '!R@e5', '!N@e4', 'e1f1'] },
  // stalemate is not stalemate while a drop exists; the drop is played and the next move is mate
  stalemateButDrop: { fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', black: { p: 1 }, script: ['P@a5', 'f7f8'] },
  // king against king with a reserve is not a draw
  kingVsKingWithReserve: { fen: '8/8/8/4k3/8/8/8/4K3 w - - 0 1', white: { n: 1 }, script: ['e1e2', 'e5e4', 'N@f3'] },
};

export const CRAZYHOUSE_SCENE_NAMES: readonly string[] = Object.keys(SCENES);

/** Replays a scene; throws when a scripted turn is refused (or a "!" turn is accepted) so a broken scene can never be recorded. */
export function recordCrazyhouseScene(name: string): string {
  const scene = SCENES[name];
  if (!scene) throw new Error(`unknown scene ${name}`);
  const state = initialCrazyhouseState();
  Object.assign(state.reserve.w, scene.white ?? {});
  Object.assign(state.reserve.b, scene.black ?? {});
  const engine = newEngine(scene.fen, state);
  const out: string[] = [`scene ${name}`];
  for (const [i, item] of scene.script.entries()) {
    const expectRefusal = item.startsWith('!');
    const text = expectRefusal ? item.slice(1) : item;
    const turns = legalTurns(engine);
    out.push(`step ${i} turn ${engine.getTurn()}`, positionText(engine, turns));
    const turn: Turn = text.includes('@')
      ? { kind: 'drop', piece: text[0].toLowerCase() as ReservePieceType, square: text.slice(2) }
      : { kind: 'move', from: text.slice(0, 2), to: text.slice(2, 4), promotion: (text[4] as 'q' | 'r' | 'b' | 'n' | undefined) || undefined, capture: false };
    const san = playTurn(engine, turn);
    if (expectRefusal) {
      if (san !== null) throw new Error(`scene ${name}: ${text} was expected to be refused but was played (${san})`);
      out.push(`refused ${text}`);
    } else {
      if (san === null) throw new Error(`scene ${name}: ${text} was refused at step ${i}`);
      out.push(`play ${text} san ${san}`, `after ${stateText(engine.getCrazyhouseState())} status ${engine.getStatus()}`);
    }
  }
  out.push(`final ${engine.getFen()} ${stateText(engine.getCrazyhouseState())} status ${engine.getStatus()}`);
  return out.join('\n') + '\n';
}

/** The seeds replayed by the gate. */
export const CRAZYHOUSE_GOLDEN_SEEDS: readonly number[] = Array.from({ length: 40 }, (_, i) => 5000 + i * 41);

/** All the seeded games in ONE pass: each game's hash, and what the games reached in total (so the gate and its coverage cost one replay, not two). */
export function recordAllCrazyhouseGames(): { hashes: Record<string, string>; coverage: CrazyhouseCoverage } {
  const coverage = emptyCoverage();
  const hashes: Record<string, string> = {};
  for (const seed of CRAZYHOUSE_GOLDEN_SEEDS) hashes[`game:${seed}`] = sha256(recordCrazyhouseGame(seed, 170, coverage));
  return { hashes, coverage };
}

export function recordAllCrazyhouseHashes(): Record<string, string> {
  const result: Record<string, string> = { ...recordAllCrazyhouseGames().hashes };
  for (const name of CRAZYHOUSE_SCENE_NAMES) result[`scene:${name}`] = sha256(recordCrazyhouseScene(name));
  return result;
}

// `--record`: rewrite the fixture from the CURRENT engine.
if (process.argv.includes('--record') && process.argv[1]?.includes('crazyhouseGoldenKit')) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { writeFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs');
  mkdirSync(`${__dirname}/fixtures`, { recursive: true });
  writeFileSync(`${__dirname}/fixtures/crazyhouseGolden.json`, JSON.stringify(recordAllCrazyhouseHashes(), null, 1) + '\n');
  console.log(`recorded ${CRAZYHOUSE_GOLDEN_SEEDS.length} games + ${CRAZYHOUSE_SCENE_NAMES.length} scenes`);
}
