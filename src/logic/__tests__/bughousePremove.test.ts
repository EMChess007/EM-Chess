import { describe, expect, it } from 'vitest';
import { resolvePremove, settle } from '../bughouse';
import { play, scene, START } from './bughouseScenes';

/**
 * Premove resolution as a pure function (BUGHOUSE_SPEC.md HP3). A premove is client-only; when the snapshot that GIVES THE TURN arrives, `resolvePremove` validates the queued intent
 * against that match and returns either the ordinary action to send or the visible reason it is cancelled.
 */
describe('resolvePremove', () => {
  it('a move that is still legal becomes the ordinary action, carrying the seat\'s own board', () => {
    const m = scene({ a: START, b: START });
    expect(resolvePremove(m, 0, { kind: 'move', from: 'e2', to: 'e4' })).toEqual({ ok: true, action: { kind: 'move', board: 'A', from: 'e2', to: 'e4' } });
    expect(resolvePremove(m, 2, { kind: 'move', from: 'g1', to: 'f3' })).toEqual({ ok: true, action: { kind: 'move', board: 'B', from: 'g1', to: 'f3' } });
  });

  it('a premove the engine would accept is accepted by the engine: resolve, then settle', () => {
    const m = scene({ a: START, b: START });
    const resolved = resolvePremove(m, 0, { kind: 'move', from: 'g1', to: 'f3' });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(settle(m, { seat: 0, action: resolved.action }, 2000).kind).toBe('applied');
  });

  it('a promotion premove needs its piece: with it the action carries it, without it the move is no longer legal', () => {
    const m = scene({ a: '4k3/1P6/8/8/8/8/8/4K3 w - - 0 1', b: START });
    expect(resolvePremove(m, 0, { kind: 'move', from: 'b7', to: 'b8', promotion: 'q' })).toEqual({ ok: true, action: { kind: 'move', board: 'A', from: 'b7', to: 'b8', promotion: 'q' } });
    expect(resolvePremove(m, 0, { kind: 'move', from: 'b7', to: 'b8' })).toEqual({ ok: false, reason: 'noLongerLegal' });
    expect(resolvePremove(m, 0, { kind: 'move', from: 'b7', to: 'b8', promotion: 'k' as any })).toEqual({ ok: false, reason: 'noLongerLegal' });
  });

  it('the position changed under the premove: noLongerLegal', () => {
    const m = scene({ a: 'r3k3/8/8/8/8/8/4P3/4K3 w - - 0 1', b: START });
    expect(resolvePremove(m, 0, { kind: 'move', from: 'e2', to: 'e4' })).toMatchObject({ ok: true });
    const blocked = scene({ a: 'r3k3/8/8/8/4p3/8/4P3/4K3 w - - 0 1', b: START });
    expect(resolvePremove(blocked, 0, { kind: 'move', from: 'e2', to: 'e4' })).toEqual({ ok: false, reason: 'noLongerLegal' });
    expect(resolvePremove(blocked, 0, { kind: 'move', from: 'a1', to: 'a2' })).toEqual({ ok: false, reason: 'noLongerLegal' }); // no piece there
  });

  it('a drop: legal, then each way it can fail - the pocket first, then an occupied square, then check and ranks', () => {
    const m = scene({ a: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', b: START, pockets: { 0: { n: 1, p: 1 } } });
    expect(resolvePremove(m, 0, { kind: 'drop', piece: 'n', square: 'c3' })).toEqual({ ok: true, action: { kind: 'drop', board: 'A', piece: 'n', square: 'c3' } });
    expect(resolvePremove(m, 0, { kind: 'drop', piece: 'q', square: 'c3' })).toEqual({ ok: false, reason: 'notInPocket' });
    expect(resolvePremove(m, 0, { kind: 'drop', piece: 'n', square: 'e8' })).toEqual({ ok: false, reason: 'squareOccupied' });
    expect(resolvePremove(m, 0, { kind: 'drop', piece: 'p', square: 'a8' })).toEqual({ ok: false, reason: 'noLongerLegal' }); // a pawn on rank 8
    expect(resolvePremove(m, 0, { kind: 'drop', piece: 'q', square: 'e8' })).toEqual({ ok: false, reason: 'notInPocket' }); // the pocket is looked at before the square
  });

  it('a drop queued before a check: the drop no longer answers it (checkNotAnswered), but a drop that DOES answer it resolves', () => {
    const m = scene({ a: '4k3/8/8/8/8/8/8/r3K3 w - - 0 1', b: START, pockets: { 0: { n: 1 } } });
    expect(resolvePremove(m, 0, { kind: 'drop', piece: 'n', square: 'a2' })).toEqual({ ok: false, reason: 'checkNotAnswered' });
    expect(resolvePremove(m, 0, { kind: 'drop', piece: 'n', square: 'c1' })).toMatchObject({ ok: true });
  });

  it('not the seat\'s turn yet: notYourTurn (the premove waits); the match over: gameOver', () => {
    const m = scene({ a: START, b: START });
    expect(resolvePremove(m, 1, { kind: 'move', from: 'e7', to: 'e5' })).toEqual({ ok: false, reason: 'notYourTurn' });
    expect(resolvePremove(m, 3, { kind: 'move', from: 'e7', to: 'e5' })).toEqual({ ok: false, reason: 'notYourTurn' });
    const over = play(m, 1, { kind: 'resign' }, 2000);
    expect(resolvePremove(over, 0, { kind: 'move', from: 'e2', to: 'e4' })).toEqual({ ok: false, reason: 'gameOver' });
  });

  it('the pocket can only have GROWN while the player waited (the partner captured): a drop queued with a piece that is there resolves, whatever else arrived', () => {
    const before = scene({ a: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', b: START, pockets: { 0: { n: 1 } } });
    const grown = scene({ a: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', b: START, pockets: { 0: { n: 1, q: 2 } } });
    for (const m of [before, grown]) expect(resolvePremove(m, 0, { kind: 'drop', piece: 'n', square: 'f3' })).toMatchObject({ ok: true });
  });
});
