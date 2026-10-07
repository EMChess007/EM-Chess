import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyRejoinAck } from '../onlineRejoin';
import type { GameOverReason, RejoinAck, RejoinStatePayload } from '../../types/multiplayer';

/**
 * Rejoin after the game ended. The server now keeps a finished game's RESULT for a few minutes and hands it to a player who reconnects;
 * before, that player was told "game not found" and the screen sat on "Reconnecting…" for ever. The decision about what an answer means
 * is a pure function (tested here); the screen wiring is pinned at source level (there is no React Native renderer in this project).
 * The server half is tested in the backend repo: scripts/test-rejoin-finished.mjs and the real-socket section of test-multiplayer.mjs.
 */

const liveState = { fen: 'x', turn: 'w', color: 'w', whiteMs: 1, blackMs: 2, moves: [], opponentConnected: true } as unknown as RejoinStatePayload;

describe('classifyRejoinAck', () => {
  it('a live game resumes from its state (the long-standing path)', () => {
    const outcome = classifyRejoinAck({ ok: true, state: liveState });
    expect(outcome).toEqual({ kind: 'state', state: liveState });
  });

  it('a game that ended while we were offline hands back the result, for every way a game can end', () => {
    const reasons: GameOverReason[] = ['checkmate', 'stalemate', 'draw', 'timeout', 'abandonment', 'resignation'];
    for (const reason of reasons) {
      const gameOver = { reason, winner: reason === 'draw' || reason === 'stalemate' ? null : ('b' as const) };
      expect(classifyRejoinAck({ ok: false, error: 'The game has already ended.', finished: true, gameOver }), reason).toEqual({ kind: 'finished', gameOver });
    }
  });

  it('a draw keeps its null winner (nobody wins), it is not mistaken for "unavailable"', () => {
    const outcome = classifyRejoinAck({ ok: false, error: 'The game has already ended.', finished: true, gameOver: { reason: 'draw', winner: null } });
    expect(outcome).toEqual({ kind: 'finished', gameOver: { reason: 'draw', winner: null } });
  });

  it('a refusal (unknown game, expired result, bad token, restarted server) is "unavailable" and keeps the server\'s message', () => {
    expect(classifyRejoinAck({ ok: false, error: 'The game was not found or has already ended.' })).toEqual({
      kind: 'unavailable',
      error: 'The game was not found or has already ended.',
    });
    expect(classifyRejoinAck({ ok: false, error: 'Invalid playerToken.' }).kind).toBe('unavailable');
  });

  it('a malformed success (neither state nor result) is "unavailable", never a crash or a half-resume', () => {
    const odd = { ok: true } as unknown as RejoinAck;
    expect(classifyRejoinAck(odd).kind).toBe('unavailable');
    const notFinished = { ok: true, finished: false } as unknown as RejoinAck;
    expect(classifyRejoinAck(notFinished).kind).toBe('unavailable');
    const refusedNotFinished = { ok: false, error: 'x', finished: false } as unknown as RejoinAck;
    expect(classifyRejoinAck(refusedNotFinished).kind).toBe('unavailable');
  });

  it('the finished answer is a REFUSAL (ok: false) on the wire, so older app builds that only read ok/state never see a success without a state', () => {
    const finished: RejoinAck = { ok: false, error: 'The game has already ended.', finished: true, gameOver: { reason: 'resignation', winner: 'w' } };
    expect(finished.ok).toBe(false);
    // What the pre-change screen did with an ack: it only branched on ok, and read ack.state on success.
    const legacy = (ack: RejoinAck) => (ack.ok ? `resumed ${ack.state.fen}` : `refused: ${ack.error}`);
    expect(legacy(finished)).toBe('refused: The game has already ended.');
    expect(legacy({ ok: true, state: liveState })).toBe('resumed x');
  });

  it('a result is preferred to a state if a (future) server sent both: the game is over', () => {
    const both = { ok: true, finished: true, gameOver: { reason: 'timeout', winner: 'w' }, state: liveState } as unknown as RejoinAck; // not a shape this server sends
    expect(classifyRejoinAck(both).kind).toBe('finished');
  });
});

describe('OnlineGameScreen wiring (no React Native renderer available)', () => {
  const screen = readFileSync(join(__dirname, '../../screens/OnlineGameScreen.tsx'), 'utf8').replace(/\r\n/g, '\n');

  it('every rejoin answer goes through the classifier', () => {
    expect(screen).toContain("import { classifyRejoinAck } from '../logic/onlineRejoin';");
    expect(screen).toContain('(ack: RejoinAck) => {');
    expect(screen).toContain('const outcome = classifyRejoinAck(ack);');
  });

  it('a finished game is shown through the SAME handler as a live game_over, and the connection is no longer "reconnecting"', () => {
    expect(screen).toMatch(/if \(outcome\.kind === 'finished'\) \{\s*setConnectionState\('connected'\);\s*setViewIndex\(null\);\s*handleGameOver\(outcome\.gameOver\);\s*return;\s*\}/);
    expect(screen).toContain("socket.on('game_over', handleGameOver);"); // the live path is untouched
  });

  it('a game the server no longer has ends the "Reconnecting…" limbo with an honest message', () => {
    expect(screen).toMatch(/if \(outcome\.kind === 'unavailable'\) \{\s*setConnectionState\('unavailable'\);\s*return;\s*\}/);
    expect(screen).toContain("useState<'connected' | 'reconnecting' | 'unavailable'>('connected')");
    expect(screen).toContain("if (connectionState === 'unavailable') statusText = 'Game unavailable';");
    expect(screen).toContain("connectionState === 'unavailable' && (");
    expect(screen).toContain('This game is no longer available');
  });

  it('the game-over side effects (rating, achievements) run once, however the result arrives', () => {
    expect(screen).toContain('const gameOverHandledRef = useRef(false);');
    expect(screen).toMatch(/const handleGameOver = \(payload: GameOverPayload\) => \{\s*if \(gameOverHandledRef\.current\) return;\s*gameOverHandledRef\.current = true;/);
  });

  it('a live rejoin still rebuilds the position, clocks and move list from the server state', () => {
    expect(screen).toContain("if (outcome.kind === 'state') {");
    expect(screen).toContain('setFen(outcome.state.fen);');
    expect(screen).toContain('outcome.state.moves.forEach((m, i) => {');
  });

  it('nothing can be played while the game is unavailable or reconnecting', () => {
    expect(screen).toContain("if (gameOver || turn !== myColor || connectionState !== 'connected' || viewIndex !== null) return;");
    expect(screen).toContain("if (gameOver || connectionState !== 'connected' || isUnlimitedClock(match.timeControl.initialSeconds)) return;"); // clock ticker stops too
  });
});
