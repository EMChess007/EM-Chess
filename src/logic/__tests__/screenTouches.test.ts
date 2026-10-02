import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { isTouchInside, notifyScreenTouch, subscribeToScreenTouches } from '../screenTouches';

describe('isTouchInside', () => {
  const board = { x: 20, y: 100, width: 320, height: 320 };

  it('is true for touches strictly inside and on the edges of the rectangle', () => {
    expect(isTouchInside(180, 260, board)).toBe(true);
    expect(isTouchInside(20, 100, board)).toBe(true);
    expect(isTouchInside(340, 420, board)).toBe(true);
  });

  it('is false for touches outside on every side', () => {
    expect(isTouchInside(19, 260, board)).toBe(false); // left
    expect(isTouchInside(341, 260, board)).toBe(false); // right
    expect(isTouchInside(180, 99, board)).toBe(false); // above
    expect(isTouchInside(180, 421, board)).toBe(false); // below
  });
});

describe('screen touch signal', () => {
  it('delivers every touch to every subscriber, and stops after unsubscribe', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeToScreenTouches(a);
    const unsubB = subscribeToScreenTouches(b);

    notifyScreenTouch(10, 20);
    expect(a).toHaveBeenCalledWith(10, 20);
    expect(b).toHaveBeenCalledWith(10, 20);

    unsubA();
    notifyScreenTouch(30, 40);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    unsubB();
  });

  it('with no subscribers, a touch is a harmless no-op', () => {
    expect(() => notifyScreenTouch(1, 2)).not.toThrow();
  });
});

// No RN renderer in this project, so the wiring itself is guarded at source level: the app root must
// observe touches WITHOUT claiming them (returning true would swallow taps on Resign/Hint/Undo and
// everything else), and ChessBoard must actually use the signal to deselect.
describe('wiring (no RN renderer available)', () => {
  const app = readFileSync(join(__dirname, '../../../App.tsx'), 'utf8');
  const board = readFileSync(join(__dirname, '../../components/ChessBoard.tsx'), 'utf8');

  it('App root observes touch starts in the capture phase and never claims them', () => {
    const match = app.match(/onStartShouldSetResponderCapture=\{[\s\S]*?return (true|false);/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('false');
    expect(app).toContain('notifyScreenTouch');
  });

  it('ChessBoard deselects on a touch outside its measured bounds', () => {
    expect(board).toContain('subscribeToScreenTouches');
    expect(board).toContain('isTouchInside');
  });
});
