import { useRef } from 'react';
import { ChessEngine } from './ChessEngine';
import { logDiagnostic } from './diagnosticLog';
import type { Move, PieceColor } from '../types/chess';
import type { GameHistoryEntry } from '../types/history';

/** Every square `color`'s own pieces currently occupy, or could move to / capture on — i.e. the
 * squares visible to that player right now. Pseudo-legal on purpose (see ChessEngine's own doc
 * comment): a player doesn't get to "see" a square just because the move there would be illegal
 * by king-safety standards — they genuinely don't know that without seeing the board fully. */
export function getVisibleSquares(engine: ChessEngine, color: PieceColor): Set<string> {
  const visible = new Set<string>();
  for (const row of engine.getBoard()) {
    for (const square of row) {
      if (square.piece?.color === color) visible.add(square.square);
    }
  }
  for (const move of engine.getPseudoLegalMoves(color)) {
    visible.add(move.to);
  }
  return visible;
}

/** Fog of War's only win condition — reaching and directly capturing the enemy king. `mover` is
 * whoever's turn it was when `move` was made (the caller already knows this; a Move itself
 * doesn't carry whose move it was). */
export function getFogOfWarWinner(move: Move | null, mover: PieceColor): PieceColor | null {
  return move?.captured === 'k' ? mover : null;
}

export type RedactedHistoryEntry = { revealed: true; san: string; from: string; to: string } | { revealed: false };

/**
 * Replays a Fog of War game from the start and decides, ply by ply, whether `viewerColor` would
 * actually have learned what happened on that move — revealed if it was their own move, or if
 * the destination square was within their own visibility either right before or right after
 * (the "right before" half is what makes losing your own piece show up correctly: the square was
 * visible because your piece stood there, even though the capturing piece arriving there can
 * immediately make that same square fog again). Used identically for Local/Bot (called directly,
 * client-side — there's no network boundary to protect there, just the same "don't show more
 * than this viewer could know" rule, enforced the same way) and mirrored server-side for Online
 * (see backend/src/game/fogOfWar.ts), where it's what actually gets sent over the wire.
 */
export function redactMoveHistory(initialFen: string, history: GameHistoryEntry[], viewerColor: PieceColor): RedactedHistoryEntry[] {
  const engine = new ChessEngine(initialFen);
  let visibleBefore = getVisibleSquares(engine, viewerColor);
  const result: RedactedHistoryEntry[] = [];

  for (const entry of history) {
    const mover: PieceColor = engine.getTurn();
    engine.movePseudoLegal(entry.move.from, entry.move.to, entry.move.promotion);
    const visibleAfter = getVisibleSquares(engine, viewerColor);

    const revealed = mover === viewerColor || visibleBefore.has(entry.move.to) || visibleAfter.has(entry.move.to);
    result.push(revealed ? { revealed: true, san: entry.move.san, from: entry.move.from, to: entry.move.to } : { revealed: false });
    visibleBefore = visibleAfter;
  }
  return result;
}

interface FogRedactionCache {
  initialFen: string;
  length: number;
  visibleAfter: Record<PieceColor, Set<string>>;
  redacted: Record<PieceColor, RedactedHistoryEntry[]>;
}

const EMPTY_REDACTION: Record<PieceColor, RedactedHistoryEntry[]> = { w: [], b: [] };

/**
 * Incremental alternative to calling redactMoveHistory fresh every render — that function
 * replays the WHOLE game from scratch (O(history length) chess.js move generation), which is
 * fine as a one-off call but, called again from scratch on every single move, turns into
 * O(history length) of *extra* synchronous work repaid on every move, growing with the game.
 * Measured directly (see this session's own profiling): ~25ms at move 5, ~230ms at move 40 — run
 * synchronously inside the render handleMove's own setHistory/setFen trigger, which is squarely
 * why a move late in a long game could stutter and its sound noticeably lag the board update.
 *
 * This instead tracks BOTH colors' own running visibility and redacted history across renders (a
 * ref, surviving re-renders) and advances it by exactly the newly appended ply when there is
 * exactly one — using `engine` as-is for "visibility right after this ply" rather than replaying
 * anything, since `engine` already reflects the position right after that exact ply by the time
 * React re-renders with the new `history` (fen and history are always updated in the same
 * handleMove batch). True O(1) per move (two getVisibleSquares calls, not a replay), regardless
 * of how long the game has gone on. Tracking both colors (not just the caller's own current
 * viewer) is what makes this work for Local's hotseat mode too, where the viewer alternates
 * every single ply — recomputing "what White could see" only when it's actually White's turn to
 * look would mean throwing the cache away every other move.
 *
 * Falls back to a full two-sided redactMoveHistory replay only when the incremental path doesn't
 * apply: no cache yet, `initialFen` changed (a new game), or `history` didn't grow by exactly one
 * ply (Undo, a reset, or anything else unexpected) — all rare, deliberate actions, never the hot
 * "every single move" path this exists to keep cheap.
 */
export function useIncrementalFogRedaction(
  fogOfWar: boolean,
  initialFen: string,
  history: GameHistoryEntry[],
  engine: ChessEngine
): Record<PieceColor, RedactedHistoryEntry[]> {
  const cacheRef = useRef<FogRedactionCache | null>(null);

  if (!fogOfWar) {
    cacheRef.current = null;
    return EMPTY_REDACTION;
  }

  const cache = cacheRef.current;
  if (cache && cache.initialFen === initialFen && history.length === cache.length + 1) {
    const entry = history[cache.length];
    const mover: PieceColor = cache.length % 2 === 0 ? 'w' : 'b';
    const visibleAfterW = getVisibleSquares(engine, 'w');
    const visibleAfterB = getVisibleSquares(engine, 'b');
    const revealedW = mover === 'w' || cache.visibleAfter.w.has(entry.move.to) || visibleAfterW.has(entry.move.to);
    const revealedB = mover === 'b' || cache.visibleAfter.b.has(entry.move.to) || visibleAfterB.has(entry.move.to);
    const makeEntry = (revealed: boolean): RedactedHistoryEntry =>
      revealed ? { revealed: true, san: entry.move.san, from: entry.move.from, to: entry.move.to } : { revealed: false };

    const next: FogRedactionCache = {
      initialFen,
      length: history.length,
      visibleAfter: { w: visibleAfterW, b: visibleAfterB },
      redacted: { w: [...cache.redacted.w, makeEntry(revealedW)], b: [...cache.redacted.b, makeEntry(revealedB)] },
    };
    cacheRef.current = next;
    return next.redacted;
  }

  const redacted: Record<PieceColor, RedactedHistoryEntry[]> = {
    w: redactMoveHistory(initialFen, history, 'w'),
    b: redactMoveHistory(initialFen, history, 'b'),
  };
  cacheRef.current = {
    initialFen,
    length: history.length,
    visibleAfter: { w: getVisibleSquares(engine, 'w'), b: getVisibleSquares(engine, 'b') },
    redacted,
  };
  return redacted;
}

/** Fog of War only — records a compact, append-only line to the app's existing diagnostic log
 * (see diagnosticLog.ts, reachable in-app via More > Diagnostics, including in signed preview/
 * production builds) for every move actually played: the real SAN and destination regardless of
 * who could see it, plus whether/why each requested perspective's own `revealed`/`visibleSquares`
 * state says it should (or shouldn't) have been visible to them right then. Never shown anywhere
 * in gameplay UI — purely so a player who spots a move that looks wrong can copy out the exact
 * sequence afterward instead of relying on memory of what they saw and when. Deliberately NOT a
 * single growing per-game blob (the diagnostic log is a shared, fixed-size ring buffer across the
 * whole app) — one short line per ply, reconstructible in full by reading them in order. */
export function logFogOfWarPly(params: {
  ply: number;
  mover: PieceColor;
  san: string;
  to: string;
  perspectives: { label: string; revealed: boolean; visible: Set<string> }[];
}): void {
  const { ply, mover, san, to, perspectives } = params;
  const perspectiveText = perspectives
    .map((p) => `${p.label}: revealed=${p.revealed} visible=[${[...p.visible].sort().join(',')}]`)
    .join(' | ');
  logDiagnostic(`[FogOfWar] ply ${ply} (${mover}) ${san} -> ${to} | ${perspectiveText}`);
}

/** Fog of War only — one line per game start, so a copied diagnostic log can be replayed from
 * scratch (same role as logFogOfWarPly's own doc comment). */
export function logFogOfWarGameStart(context: string, initialFen: string, chess960: boolean): void {
  logDiagnostic(`[FogOfWar] game start (${context}) | initialFen=${initialFen} | chess960=${chess960}`);
}
