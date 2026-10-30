import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PIECE_PATHS } from '../../components/pieceArt';
import { legalDropsOn, legalMovesOn, type BughouseMatch } from '../../logic/bughouse';
import type { BoardId } from '../../logic/bughouse/types';
import { BUGHOUSE_ROTATE_OVERLAY_DETAIL, BUGHOUSE_ROTATE_OVERLAY_TITLE, deriveBughouseLayout, getBughouseDualCellSize } from '../../logic/bughouseLayout';
import type { SeatConfig, SeatController } from '../../logic/fourPlayer/setup';
import { mulberry32 } from '../../logic/__tests__/bughouseTestKit';
import { scene, START } from '../../logic/__tests__/bughouseScenes';
import { fireMouse, fireTouch, placeElement, setWindowSize, type FakeTouch } from '../../test/domKit';
import BughouseGameScreen from '../BughouseGameScreen';

/**
 * BUGHOUSE W3b - humans on BOTH boards, rendered for real (jsdom + react-native-web, the real boards, pockets, per-board reducers and engine). A finger is a DOM touch event carrying an identifier
 * and page coordinates (`fireTouch`), delivered to the board the finger began on, exactly as a browser or a phone delivers it; jsdom has no layout, so each board's grid is given a rectangle
 * (`placeElement`). No wall clock: fake timers; the bots' randomness is seeded. What the screen shows that comes from the engine (the squares a piece may go to) is compared with the engine.
 */
const H: SeatController = { kind: 'human' };
const B: SeatController = { kind: 'bot', elo: 1200 };
const cfg = (a: string): SeatConfig => [a[0] === 'H' ? H : B, a[1] === 'H' ? H : B, a[2] === 'H' ? H : B, a[3] === 'H' ? H : B];
const TC3 = { initialMs: 180000, incrementMs: 0 };
const CLOCK = () => Date.now();

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 }); // the window is the default phone (412 x 915, domSetup.ts); a test that needs another calls setWindowSize
});
afterEach(() => {
  vi.restoreAllMocks();
});

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const renderGame = (props: Partial<ComponentProps<typeof BughouseGameScreen>> & { seats: SeatConfig }) =>
  render(<BughouseGameScreen timeControl={TC3} onExit={() => {}} rng={mulberry32(11)} clock={CLOCK} {...props} />);
const text = (id: string): string => screen.getByTestId(id).textContent ?? '';

// --- fingers --------------------------------------------------------------------------------------------------------------------------------

/** Where each grid sits on the page in these tests (stacked: A above B; any spot works, the boards just must not overlap). */
const AT: Record<BoardId, { left: number; top: number }> = { A: { left: 40, top: 100 }, B: { left: 40, top: 520 } };
const cellPx = (): number => getBughouseDualCellSize(window.innerWidth, window.innerHeight).cell;
const grid = (board: BoardId): HTMLElement => {
  const element = screen.getByTestId(`board-${board}`);
  placeElement(element, AT[board].left, AT[board].top, cellPx() * 8);
  return element;
};
/** The colour at the bottom of `board` as drawn: the first cell in the DOM is the top-left one (a8 for White at the bottom, h1 for Black). */
const bottom = (board: BoardId): 'w' | 'b' => {
  const first = screen.getByTestId(`board-${board}`).querySelector('[data-testid]')?.getAttribute('data-testid');
  return first === `${board}-a8` ? 'w' : 'b';
};
/** The centre of `square` of `board` as drawn now. */
const spot = (board: BoardId, square: string): { x: number; y: number } => {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const white = bottom(board) === 'w';
  const col = white ? file : 7 - file;
  const row = white ? 8 - rank : rank - 1;
  const cell = cellPx();
  return { x: AT[board].left + (col + 0.5) * cell, y: AT[board].top + (row + 0.5) * cell };
};
const finger = (id: number, board: BoardId, square: string): FakeTouch => ({ id, ...spot(board, square) });
const down = (f: FakeTouch, board: BoardId) => fireTouch('touchstart', grid(board), [f]);
const up = (f: FakeTouch, board: BoardId) => fireTouch('touchend', grid(board), [f]);
const tap = (board: BoardId, square: string, id = 1) => {
  const f = finger(id, board, square);
  down(f, board);
  up(f, board);
};
/** Two fingers that overlap in time: A goes down, B goes down, A comes up, B comes up. */
const twoFingers = (a: [BoardId, string], b: [BoardId, string]) => {
  const fa = finger(1, a[0], a[1]);
  const fb = finger(2, b[0], b[1]);
  down(fa, a[0]);
  down(fb, b[0]);
  up(fa, a[0]);
  up(fb, b[0]);
};
const offered = (board: BoardId): string[] =>
  Array.from(screen.getByTestId(`board-${board}`).querySelectorAll('[data-testid]'))
    .filter((el) => /can (move|drop) here/.test(el.getAttribute('aria-label') ?? ''))
    .map((el) => (el.getAttribute('data-testid') ?? '').slice(2))
    .sort();
const labelOf = (board: BoardId, square: string): string => screen.getByTestId(`${board}-${square}`).getAttribute('aria-label') ?? '';
const targetsOf = (match: BughouseMatch, board: BoardId, from: string): string[] => Array.from(new Set(legalMovesOn(match, board).filter((m) => m.from === from).map((m) => m.to))).sort();
const START_MATCH = scene({ startMs: 0 });

const ALL_PATTERNS = Array.from({ length: 16 }, (_, n) => [3, 2, 1, 0].map((bit) => ((n >> bit) & 1 ? 'H' : 'B')).join(''));
const DUAL_PATTERNS = ALL_PATTERNS.filter((p) => deriveBughouseLayout(cfg(p)).kind === 'dual');

describe('the layout of every seat setup with humans on both boards', () => {
  it('the table has the nine setups the spec describes (a human on each board)', () => {
    expect([...DUAL_PATTERNS].sort()).toEqual(['BHBH', 'BHHB', 'BHHH', 'HBBH', 'HBHB', 'HBHH', 'HHBH', 'HHHB', 'HHHH']);
  });

  it.each(DUAL_PATTERNS)('%s: both boards playable at once, one block each, no thumbnail, four clocks, a pocket per player', (pattern) => {
    renderGame({ seats: cfg(pattern) });
    expect(screen.getByTestId('layout-dual-stacked')).toBeTruthy();
    for (const board of ['A', 'B'] as const) expect(screen.getByTestId(`block-${board}`)).toBeTruthy();
    expect(screen.queryByTestId('thumb-A')).toBeNull();
    expect(screen.queryByTestId('thumb-B')).toBeNull();
    expect(screen.queryByTestId('rotate-overlay')).toBeNull();
    for (const key of ['A-white', 'A-black', 'B-white', 'B-black']) {
      expect(text(`clock-${key}`)).toBe('3:00');
      expect(screen.getByTestId(`pocket-${key}`)).toBeTruthy();
    }
    // a board whose two colours are both human is pass-and-play: it has its banner
    expect(screen.queryByTestId('turn-banner-A') !== null).toBe(pattern[0] === 'H' && pattern[1] === 'H');
    expect(screen.queryByTestId('turn-banner-B') !== null).toBe(pattern[2] === 'H' && pattern[3] === 'H');
  });

  it('both team badges are on all four kings (there is no single "me" with several humans)', () => {
    renderGame({ seats: cfg('HBBH') });
    const badges = ['A-e1', 'A-e8', 'B-e1', 'B-e8'].map((id) => labelOf(id[0] as BoardId, id.slice(2)));
    expect(badges.map((label) => /Team [12]$/.test(label))).toEqual([true, true, true, true]);
    expect(new Set(badges.map((label) => label.slice(-6))).size).toBe(2);
  });

  it('the screen keeps no premove: a queued move is not a thing here (premoves are off whenever 2+ humans share the device)', () => {
    renderGame({ seats: cfg('HBBH') });
    // Board B: White (a bot) is to move, the human is Black. Black's touches are ignored: no selection, no premove marker, nothing offered.
    tap('B', 'e7');
    expect(offered('B')).toEqual([]);
    expect(screen.queryByText(/premove/i)).toBeNull();
  });
});

describe('stacked in portrait, side by side in landscape and on tablets, the same size for both boards', () => {
  const cellsOf = (board: BoardId): number => {
    const element = screen.getByTestId(`board-${board}`);
    return Number.parseFloat(getComputedStyle(element).width || element.style.width) / 8;
  };

  it.each([
    [412, 915, 'layout-dual-stacked'],
    [360, 740, 'layout-dual-stacked'],
    [360, 800, 'layout-dual-stacked'],
    [800, 360, 'layout-dual-side-by-side'],
    [768, 1024, 'layout-dual-side-by-side'], // a tie: side by side from 700 px wide (S-U3)
    [1024, 768, 'layout-dual-side-by-side'],
  ] as const)('%d x %d: %s, both boards drawn at the cell size of getBughouseDualCellSize', (width, height, layoutId) => {
    setWindowSize(width, height);
    renderGame({ seats: cfg('HBBH') });
    expect(screen.getByTestId(layoutId)).toBeTruthy();
    const fit = getBughouseDualCellSize(width, height);
    expect(fit.fits).toBe(true);
    expect(cellsOf('A')).toBe(fit.cell);
    expect(cellsOf('B')).toBe(fit.cell);
    // both arrangements are tight: one slim bar (the other layouts keep the regular header in portrait)
    expect(screen.queryByTestId('bughouse-compact-bar')).not.toBeNull();
  });
});

describe('each board is oriented to the colour of the human who plays it', () => {
  it.each([
    ['HBBH', 'w', 'b'],
    ['BHHB', 'b', 'w'],
    ['HBHB', 'w', 'w'],
    ['BHBH', 'b', 'b'],
    ['HBHH', 'w', 'w'], // B is shared: it starts with White (the side to move) at the bottom
    ['BHHH', 'b', 'w'],
  ] as const)('%s: board A shows %s at the bottom, board B shows %s', (pattern, a, b) => {
    renderGame({ seats: cfg(pattern) });
    expect([bottom('A'), bottom('B')]).toEqual([a, b]);
  });

  it('a board with both colours human turns to the side to move (the other board does not move), and "Auto-turn: off" keeps White at the bottom', () => {
    renderGame({ seats: cfg('HHBH') }); // A shared; B: Black is the human
    expect([bottom('A'), bottom('B')]).toEqual(['w', 'b']);
    tap('A', 'e2');
    tap('A', 'e4');
    expect(text('turn-banner-A')).toContain('Black to move');
    expect(bottom('A')).toBe('b'); // turned to Black
    expect(bottom('B')).toBe('b'); // untouched
    fireEvent.click(screen.getByTestId('bughouse-autoflip'));
    expect(bottom('A')).toBe('w');
    fireEvent.click(screen.getByTestId('bughouse-autoflip'));
    expect(bottom('A')).toBe('b');
  });
});

describe('two fingers: every board has a selection of its own', () => {
  it('two overlapping touches, one per board, select a piece on each board, and each board offers what the ENGINE says its piece may do', () => {
    renderGame({ seats: cfg('HBHB') }); // White is the human on both boards: both boards are on move at the same time
    twoFingers(['A', 'e2'], ['B', 'g1']);
    expect(offered('A')).toEqual(targetsOf(START_MATCH, 'A', 'e2'));
    expect(offered('B')).toEqual(targetsOf(START_MATCH, 'B', 'g1'));
    expect(offered('A')).toEqual(['e3', 'e4']);
    expect(offered('B')).toEqual(['f3', 'h3']);
  });

  it('a tap on board B never clears or changes the selection on board A, and a tap on A never clears B\'s', () => {
    renderGame({ seats: cfg('HBHB') });
    tap('A', 'e2');
    tap('B', 'd2');
    expect(offered('A')).toEqual(['e3', 'e4']);
    expect(offered('B')).toEqual(['d3', 'd4']);
    tap('B', 'a5'); // an empty square on B: B's own selection goes, A's stays
    expect(offered('B')).toEqual([]);
    expect(offered('A')).toEqual(['e3', 'e4']);
    tap('B', 'd2');
    tap('A', 'h5'); // an empty square on A: A's goes, B's stays
    expect(offered('A')).toEqual([]);
    expect(offered('B')).toEqual(['d3', 'd4']);
  });

  it('a move committed on A leaves the selection on B where it is (a commit anywhere is not a reason to forget the half-made action of the other board)', () => {
    renderGame({ seats: cfg('HBHB') });
    tap('B', 'g1');
    tap('A', 'e2');
    tap('A', 'e4'); // the move on A
    expect(labelOf('A', 'e4')).toContain('White pawn');
    expect(offered('B')).toEqual(['f3', 'h3']); // B's knight is still picked up
    tap('B', 'f3');
    expect(labelOf('B', 'f3')).toContain('White knight');
  });

  it('two moves at the same moment, one on each board, both commit (a finger each, overlapping)', () => {
    renderGame({ seats: cfg('HBHB') });
    twoFingers(['A', 'd2'], ['B', 'd2']);
    twoFingers(['A', 'd4'], ['B', 'd4']);
    expect(labelOf('A', 'd4')).toContain('White pawn');
    expect(labelOf('B', 'd4')).toContain('White pawn');
    expect(labelOf('A', 'd2')).not.toContain('pawn');
    expect(labelOf('B', 'd2')).not.toContain('pawn');
  });

  it('a bot moving on the other board between the two taps does not erase the first tap (the selection belongs to its own board)', () => {
    renderGame({ seats: cfg('HBBH') }); // Board B: White is a bot, it moves after the 450 ms think delay of a 3-minute game
    const boardB = () => Array.from(screen.getByTestId('board-B').querySelectorAll('[data-testid]')).map((el) => el.getAttribute('aria-label')).join('|');
    const before = boardB();
    tap('A', 'e2');
    expect(offered('A')).toEqual(['e3', 'e4']);
    advance(1000); // the bot plays on B (the bot of A has not been given a move yet)
    expect(boardB()).not.toBe(before); // sanity: B moved, so the match did commit while the human was half-way
    expect(offered('A')).toEqual(['e3', 'e4']);
    tap('A', 'e4');
    expect(labelOf('A', 'e4')).toContain('White pawn');
  });
});

describe('property: interleaved touches on two boards', () => {
  const snapshot = (board: BoardId): string => Array.from(screen.getByTestId(`board-${board}`).querySelectorAll('[data-testid]')).map((el) => el.getAttribute('aria-label')).join('|');

  it('over 6 seeded interleavings of 14 touches, with fingers that overlap or not, each board ends exactly where the same touches on that board ALONE would have left it', () => {
    const squares = ['a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2', 'b1', 'g1', 'a3', 'c3', 'e4', 'h5', 'd4', 'f3', 'h3', 'e3', 'a6', 'e7'];
    for (let round = 0; round < 6; round++) {
      const rng = mulberry32(900 + round);
      const events = Array.from({ length: 14 }, () => ({ board: (rng() < 0.5 ? 'A' : 'B') as BoardId, square: squares[Math.floor(rng() * squares.length)], overlap: rng() < 0.5 }));
      const together = renderGame({ seats: cfg('HBHB') });
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        const next = events[i + 1];
        if (e.overlap && next && next.board !== e.board) {
          twoFingers([e.board, e.square], [next.board, next.square]);
          i++;
        } else {
          tap(e.board, e.square);
        }
      }
      const final = { A: snapshot('A'), B: snapshot('B') };
      together.unmount();
      for (const board of ['A', 'B'] as const) {
        const alone = renderGame({ seats: cfg('HBHB') });
        for (const e of events.filter((x) => x.board === board)) tap(board, e.square);
        expect(snapshot(board), `round ${round}, board ${board}`).toBe(final[board]);
        alone.unmount();
      }
    }
  }, 120_000);
});

describe('what a board shows of its own half-made action', () => {
  const bg = (board: BoardId, square: string): string => (screen.getByTestId(`${board}-${square}`) as HTMLElement).style.backgroundColor;
  const GREEN = 'rgb(162, 209, 73)';

  it('the picked-up piece is highlighted on ITS board only, and the highlight goes when the piece is put down', () => {
    renderGame({ seats: cfg('HBHB') });
    twoFingers(['A', 'e2'], ['B', 'd2']);
    expect(bg('A', 'e2')).toBe(GREEN);
    expect(bg('B', 'd2')).toBe(GREEN);
    expect(bg('B', 'e2')).not.toBe(GREEN); // not the same square of the other board
    expect(bg('A', 'd2')).not.toBe(GREEN);
    tap('A', 'h5');
    expect(bg('A', 'e2')).not.toBe(GREEN);
    expect(bg('B', 'd2')).toBe(GREEN);
  });

  it('a half-made action that is no longer valid is not drawn: when the match ends the highlight, the dots and the picked chip go with it', () => {
    const pocketed = scene({ startMs: 0, pockets: { 0: { n: 1 }, 2: { n: 1 } } });
    renderGame({ seats: cfg('HBHB'), startFrom: pocketed });
    tap('A', 'e2');
    const chip = screen.getByTestId('pocket-B-white-n');
    fireTouch('touchstart', chip, [{ id: 2, x: 30, y: 30 }]);
    fireTouch('touchend', chip, [{ id: 2, x: 30, y: 30 }]);
    expect(offered('A')).toEqual(['e3', 'e4']);
    expect(offered('B').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('bughouse-resign-team-1'));
    expect(offered('A')).toEqual([]);
    expect(offered('B')).toEqual([]);
    expect(bg('A', 'e2')).not.toBe(GREEN);
    expect(screen.getByTestId('pocket-B-white-n').getAttribute('aria-label')).not.toContain('picked up');
  });

  it('the picked-up pocket piece is marked on its chip (for the eye and for a screen reader), and only that chip', () => {
    const pocketed = scene({ startMs: 0, pockets: { 0: { n: 1, p: 2 }, 2: { n: 1 } } });
    renderGame({ seats: cfg('HBHB'), startFrom: pocketed });
    const label = (id: string) => screen.getByTestId(id).getAttribute('aria-label') ?? '';
    const lift = (id: string) => {
      const chip = screen.getByTestId(id);
      fireTouch('touchstart', chip, [{ id: 2, x: 30, y: 30 }]);
      fireTouch('touchend', chip, [{ id: 2, x: 30, y: 30 }]);
    };
    expect(label('pocket-A-white-n')).not.toContain('picked up');
    lift('pocket-A-white-n');
    expect(label('pocket-A-white-n')).toContain('picked up');
    expect(label('pocket-A-white-p')).not.toContain('picked up');
    expect(label('pocket-B-white-n')).not.toContain('picked up'); // the other board's chip of the same piece
    lift('pocket-A-white-n'); // a second tap puts it back
    expect(label('pocket-A-white-n')).not.toContain('picked up');
  });
});

describe('the other layouts keep the responder-based input', () => {
  it.each([
    ['HBBB', 'A'],
    ['HHBB', 'A'],
    ['BBHH', 'B'],
  ] as const)('%s: a raw touch on the board a human plays (%s) is not a tap there - only the PanResponder path of W3a takes input; the dual layout\'s raw touches are not wired', (pattern, board) => {
    renderGame({ seats: cfg(pattern) });
    const element = screen.getByTestId(`board-${board}`);
    const cell = Number.parseFloat(getComputedStyle(element).width) / 8; // this layout's own cell, not the dual one
    placeElement(element, AT[board].left, AT[board].top, cell * 8);
    const white = bottom(board) === 'w';
    const f: FakeTouch = { id: 1, x: AT[board].left + ((white ? 4 : 3) + 0.5) * cell, y: AT[board].top + ((white ? 6 : 1) + 0.5) * cell }; // e2 as drawn
    fireTouch('touchstart', element, [f]);
    fireTouch('touchend', element, [f]);
    expect(offered(board)).toEqual([]);
  });
});

describe('the turn locks', () => {
  it('only the side to move can touch a board whose two colours are both human; the other board is independent', () => {
    renderGame({ seats: cfg('HHHH') });
    tap('A', 'e7'); // Black's pawn while White is to move on A
    expect(offered('A')).toEqual([]);
    tap('B', 'e7'); // and on B
    expect(offered('B')).toEqual([]);
    tap('A', 'e2');
    tap('B', 'd2'); // both White pieces, one per board, at once
    expect(offered('A')).toEqual(['e3', 'e4']);
    expect(offered('B')).toEqual(['d3', 'd4']);
    tap('A', 'e4'); // White moves on A: now only Black may touch A, while B is still White's
    tap('A', 'd2');
    expect(offered('A')).toEqual([]); // White's pawn on A is no longer the touch of the day
    tap('A', 'e7');
    expect(offered('A')).toEqual(['e5', 'e6']);
    expect(offered('B')).toEqual(['d3', 'd4']); // B still holds its White pawn
  });

  it('a bot\'s turn locks the board against the human\'s other colour; a human\'s colour is never touched by the bot', () => {
    renderGame({ seats: cfg('HBBH') });
    tap('A', 'e7'); // Black on A is a bot
    expect(offered('A')).toEqual([]);
    tap('B', 'e2'); // White on B is a bot
    expect(offered('B')).toEqual([]);
  });

  it('after the end of the match nothing can be touched', () => {
    renderGame({ seats: cfg('HBHB') });
    fireEvent.click(screen.getByTestId('bughouse-resign-team-1'));
    expect(screen.getByTestId('game-over')).toBeTruthy();
    tap('A', 'e2');
    tap('B', 'e2');
    expect(offered('A')).toEqual([]);
    expect(offered('B')).toEqual([]);
  });
});

describe('a touch belongs to the board it began on', () => {
  it('a touch that starts on A and ends on B counts for nothing, on either board', () => {
    renderGame({ seats: cfg('HBHB') });
    const start = finger(1, 'A', 'e2');
    const end = finger(1, 'B', 'e2');
    fireTouch('touchstart', grid('A'), [start]);
    fireTouch('touchmove', grid('A'), [end]); // the finger slides across to the other board ...
    fireTouch('touchend', grid('A'), [end]); // ... and lifts there (the browser still delivers it to the board where it began)
    expect(offered('A')).toEqual([]);
    expect(offered('B')).toEqual([]);
  });

  it('a touch that ends in the gutter or beside the grid is the dead zone: nothing is selected, nothing is cleared', () => {
    renderGame({ seats: cfg('HBHB') });
    tap('A', 'e2');
    const inGutter = { id: 5, x: AT.A.left + 30, y: AT.A.top + cellPx() * 8 + 5 }; // just under board A, between the boards
    fireTouch('touchstart', grid('A'), [inGutter]);
    fireTouch('touchend', grid('A'), [inGutter]);
    expect(offered('A')).toEqual(['e3', 'e4']); // the tap in the dead zone did not clear the selection
    const beside = { id: 6, x: AT.A.left - 6, y: AT.A.top + 10 };
    fireTouch('touchstart', grid('A'), [beside]);
    fireTouch('touchend', grid('A'), [beside]);
    expect(offered('A')).toEqual(['e3', 'e4']);
  });

  it('a touch that wanders off and comes back, or is cancelled, is not a tap', () => {
    renderGame({ seats: cfg('HBHB') });
    const f = finger(1, 'A', 'e2');
    fireTouch('touchstart', grid('A'), [f]);
    fireTouch('touchmove', grid('A'), [{ ...f, x: f.x + 30 }]);
    fireTouch('touchend', grid('A'), [f]);
    expect(offered('A')).toEqual([]);
    fireTouch('touchstart', grid('A'), [f]);
    fireTouch('touchcancel', grid('A'), [f]);
    fireTouch('touchend', grid('A'), [f]); // a lift that follows a cancel finds nothing to complete
    expect(offered('A')).toEqual([]);
  });

  it('the identifier is what tells the fingers apart: the same two fingers lifted in the other order give the same result', () => {
    renderGame({ seats: cfg('HBHB') });
    const fa = finger(7, 'A', 'e2');
    const fb = finger(3, 'B', 'g1');
    down(fa, 'A');
    down(fb, 'B');
    up(fb, 'B'); // B's finger first this time
    up(fa, 'A');
    expect(offered('A')).toEqual(['e3', 'e4']);
    expect(offered('B')).toEqual(['f3', 'h3']);
  });

  it('a mouse (web on a desktop) plays too: a press and a release on a cell is a tap, a finger\'s pointer events are not counted twice', () => {
    renderGame({ seats: cfg('HBHB') });
    const at = spot('A', 'e2');
    fireMouse('pointerdown', grid('A'), at);
    fireMouse('pointerup', grid('A'), at);
    expect(offered('A')).toEqual(['e3', 'e4']);
    const elsewhere = spot('A', 'd2');
    fireMouse('pointerdown', grid('A'), elsewhere, 2); // a right button is not a tap: d2 is not picked up
    fireMouse('pointerup', grid('A'), elsewhere, 2);
    expect(offered('A')).toEqual(['e3', 'e4']);
    fireMouse('pointerdown', grid('A'), elsewhere, 1); // nor is the middle one
    fireMouse('pointerup', grid('A'), elsewhere, 1);
    expect(offered('A')).toEqual(['e3', 'e4']);
  });

  it('a mouse press is completed by a mouse release only: the release of a finger\'s pointer does not end it', () => {
    renderGame({ seats: cfg('HBHB') });
    const at = spot('A', 'e2');
    fireMouse('pointerdown', grid('A'), at);
    fireMouse('pointerup', grid('A'), at, 0, 'touch');
    expect(offered('A')).toEqual([]);
    fireMouse('pointerup', grid('A'), at); // the real release
    expect(offered('A')).toEqual(['e3', 'e4']);
  });

  it('a chip tap never needs the grid\'s position: it works where the grid cannot be read at all', () => {
    const pocketed = scene({ startMs: 0, pockets: { 0: { n: 1 } } });
    renderGame({ seats: cfg('HBHB'), startFrom: pocketed });
    Object.defineProperty(screen.getByTestId('board-A'), 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        throw new Error('the grid was read for a chip tap');
      },
    });
    const chip = screen.getByTestId('pocket-A-white-n');
    fireTouch('touchstart', chip, [{ id: 9, x: 30, y: 30 }]);
    fireTouch('touchend', chip, [{ id: 9, x: 30, y: 30 }]);
    expect(offered('A').length).toBeGreaterThan(0);
  });

  it('the pointer events of a finger (type "touch") or a pen are not mouse taps: the touch events already counted that finger', () => {
    renderGame({ seats: cfg('HBHB') });
    const at = spot('A', 'e2');
    fireMouse('pointerdown', grid('A'), at, 0, 'touch');
    fireMouse('pointerup', grid('A'), at, 0, 'touch');
    expect(offered('A')).toEqual([]);
    fireMouse('pointerdown', grid('A'), at, 0, 'pen');
    fireMouse('pointerup', grid('A'), at, 0, 'pen');
    expect(offered('A')).toEqual([]);
  });

  it('a mouse and a finger are two different touches: a click in the middle of a finger\'s touch does not end the finger\'s', () => {
    renderGame({ seats: cfg('HBHB') });
    const finger1 = finger(1, 'A', 'e2');
    down(finger1, 'A');
    const other = spot('A', 'h5');
    fireMouse('pointerdown', grid('A'), other); // an empty square: the mouse tap clears nothing, and must not take the finger's identifier
    fireMouse('pointerup', grid('A'), other);
    up(finger1, 'A');
    expect(offered('A')).toEqual(['e3', 'e4']);
  });

  it('a mouse that is cancelled (it leaves the window) taps nothing', () => {
    renderGame({ seats: cfg('HBHB') });
    const at = spot('A', 'e2');
    fireMouse('pointerdown', grid('A'), at);
    fireMouse('pointercancel', grid('A'), at);
    fireMouse('pointerup', grid('A'), at);
    expect(offered('A')).toEqual([]);
  });

  it('two fingers that land in the SAME event are both counted: the last one down is the one the board ends with', () => {
    renderGame({ seats: cfg('HBHB') });
    const f1 = finger(1, 'A', 'e2');
    const f2 = finger(2, 'A', 'd2');
    fireTouch('touchstart', grid('A'), [f1, f2]);
    fireTouch('touchend', grid('A'), [f1, f2]);
    expect(offered('A')).toEqual(['d3', 'd4']); // e2 was picked up, then d2 replaced it: both taps were processed, in order
  });

  it('where the platform has no synchronous rectangle (a phone), the grid is measured when the touch lifts and the tap resolves once that measurement has landed', async () => {
    renderGame({ seats: cfg('HBHB') });
    const element = screen.getByTestId('board-A');
    const left = AT.A.left;
    const top = AT.A.top;
    let measured = 0;
    Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: undefined }); // no rectangle to read at once
    Object.defineProperty(element, 'measure', {
      configurable: true,
      value: (callback: (x: number, y: number, w: number, h: number, pageX: number, pageY: number) => void) => {
        measured++;
        setTimeout(() => callback(0, 0, cellPx() * 8, cellPx() * 8, left, top), 50); // the bridge answers later
      },
    });
    const f = finger(1, 'A', 'e2');
    fireTouch('touchstart', element, [f]);
    fireTouch('touchend', element, [f]); // the answer has not come yet: nothing can have been resolved
    expect(offered('A')).toEqual([]);
    await act(async () => {
      vi.advanceTimersByTime(50); // the bridge answers ...
      await Promise.resolve(); // ... and the tap that was waiting for it resolves
      await Promise.resolve();
    });
    expect(measured).toBeGreaterThanOrEqual(1);
    expect(offered('A')).toEqual(['e3', 'e4']); // resolved against the measured position, by the same touch
  });

  it('the page may be scrolled: the grid\'s origin is its rectangle plus the scroll offset, because a touch reports PAGE coordinates', () => {
    renderGame({ seats: cfg('HBHB') });
    Object.defineProperty(window, 'pageXOffset', { configurable: true, value: 30 });
    Object.defineProperty(window, 'pageYOffset', { configurable: true, value: 50 });
    try {
      const f = finger(1, 'A', 'e2');
      const shifted = { ...f, x: f.x + 30, y: f.y + 50 }; // the same finger in page coordinates of a page scrolled by (30, 50)
      fireTouch('touchstart', grid('A'), [shifted]);
      fireTouch('touchend', grid('A'), [shifted]);
      expect(offered('A')).toEqual(['e3', 'e4']);
    } finally {
      Object.defineProperty(window, 'pageXOffset', { configurable: true, value: 0 });
      Object.defineProperty(window, 'pageYOffset', { configurable: true, value: 0 });
    }
  });

  it('the grid\'s position is read again when the finger lifts: a board that shifts under a held finger resolves the tap where the board is now', () => {
    renderGame({ seats: cfg('HBHB') });
    const f = finger(1, 'A', 'e2');
    down(f, 'A');
    placeElement(screen.getByTestId('board-A'), AT.A.left, AT.A.top + cellPx(), cellPx() * 8); // the board slides one cell down while the finger is held
    fireTouch('touchend', screen.getByTestId('board-A'), [f]);
    expect(offered('A')).toEqual([]); // the finger is now over e3, an empty square (a stale position would have picked up e2)
  });

  it('twenty taps in quick alternation between the boards all land, each on its own board', () => {
    renderGame({ seats: cfg('HBHB') });
    // 8 rounds of two overlapping touches (16 taps): each round picks up the pawn of the next file on both boards, and each board offers ITS pawn's two squares ...
    for (const file of 'abcdefgh') {
      twoFingers(['A', `${file}2`], ['B', `${file}2`]);
      expect(offered('A')).toEqual([`${file}3`, `${file}4`]);
      expect(offered('B')).toEqual([`${file}3`, `${file}4`]);
    }
    twoFingers(['A', 'h5'], ['B', 'h5']); // ... then an empty square on each board clears both (18)
    expect(offered('A')).toEqual([]);
    expect(offered('B')).toEqual([]);
    tap('A', 'a2'); // and two more, one on each board (20)
    tap('B', 'b2');
    expect(offered('A')).toEqual(['a3', 'a4']);
    expect(offered('B')).toEqual(['b3', 'b4']);
  });
});

describe('drops and promotions, one board at a time', () => {
  it('a pocket chip is tapped with its own touch, lifts, shows the squares the ENGINE allows, and a tap on one drops it; the other board\'s selection survives', () => {
    const pocketed = scene({ startMs: 0, pockets: { 0: { n: 1 }, 2: { n: 1 } } });
    renderGame({ seats: cfg('HBHB'), startFrom: pocketed });
    tap('B', 'g1'); // a half-made move on B
    const chip = screen.getByTestId('pocket-A-white-n');
    const at = { id: 9, x: 30, y: 30 };
    fireTouch('touchstart', chip, [at]);
    fireTouch('touchend', chip, [at]);
    const legal = Array.from(new Set(legalDropsOn(pocketed, 'A').filter((d) => d.piece === 'n').map((d) => d.square))).sort();
    expect(offered('A')).toEqual(legal);
    expect(offered('B')).toEqual(['f3', 'h3']); // B's selection is not touched by a chip on A
    const target = legal[0];
    tap('A', target);
    expect(labelOf('A', target)).toContain('White knight');
    expect(offered('B')).toEqual(['f3', 'h3']);
  });

  it('the chip of board B is tapped on board B: a drop on B, and board A has nothing picked up', () => {
    const pocketed = scene({ startMs: 0, pockets: { 2: { n: 1 } } });
    renderGame({ seats: cfg('HBHB'), startFrom: pocketed });
    const chip = screen.getByTestId('pocket-B-white-n');
    fireTouch('touchstart', chip, [{ id: 9, x: 30, y: 30 }]);
    fireTouch('touchend', chip, [{ id: 9, x: 30, y: 30 }]);
    const legal = Array.from(new Set(legalDropsOn(pocketed, 'B').filter((d) => d.piece === 'n').map((d) => d.square))).sort();
    expect(offered('B')).toEqual(legal);
    expect(offered('A')).toEqual([]);
    tap('B', legal[0]);
    expect(labelOf('B', legal[0])).toContain('White knight');
  });

  it('with auto-turn off the side to move may sit at the TOP of its board: its chip, in the top bar, still listens', () => {
    const blackToMove = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const pocketed = scene({ startMs: 0, a: blackToMove, pockets: { 1: { n: 1 } } });
    renderGame({ seats: cfg('HHHB'), startFrom: pocketed });
    fireEvent.click(screen.getByTestId('bughouse-autoflip')); // fixed: White stays at the bottom, so Black's pocket is in the top bar
    expect(bottom('A')).toBe('w');
    const chip = screen.getByTestId('pocket-A-black-n');
    fireTouch('touchstart', chip, [{ id: 3, x: 30, y: 30 }]);
    fireTouch('touchend', chip, [{ id: 3, x: 30, y: 30 }]);
    const legal = Array.from(new Set(legalDropsOn(pocketed, 'A').filter((d) => d.piece === 'n').map((d) => d.square))).sort();
    expect(legal.length).toBeGreaterThan(0);
    expect(offered('A')).toEqual(legal);
  });

  it('a chip that is not on move, or a chip dragged away from, does nothing', () => {
    const pocketed = scene({ startMs: 0, pockets: { 0: { n: 1 }, 1: { n: 1 } } }); // Black (a bot) holds a knight too
    renderGame({ seats: cfg('HBHB'), startFrom: pocketed });
    const blackChip = screen.getByTestId('pocket-A-black-n');
    fireTouch('touchstart', blackChip, [{ id: 8, x: 30, y: 30 }]);
    fireTouch('touchend', blackChip, [{ id: 8, x: 30, y: 30 }]);
    expect(offered('A')).toEqual([]); // a bot's pocket on a bot's turn is nobody's to lift
    const whiteChip = screen.getByTestId('pocket-A-white-n');
    fireTouch('touchstart', whiteChip, [{ id: 7, x: 30, y: 30 }]);
    fireTouch('touchmove', whiteChip, [{ id: 7, x: 60, y: 30 }]);
    fireTouch('touchend', whiteChip, [{ id: 7, x: 30, y: 30 }]);
    expect(offered('A')).toEqual([]);
  });

  it('a promotion waits for its choice on ITS board; the other board stays playable, and can have its own promotion waiting at the same time', () => {
    const near = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    renderGame({ seats: cfg('HBHB'), startFrom: scene({ startMs: 0, a: near, b: near }) });
    tap('A', 'a7');
    tap('A', 'a8');
    expect(screen.getByTestId('promotion-A')).toBeTruthy();
    expect(screen.queryByTestId('promotion-B')).toBeNull();
    tap('B', 'a7');
    tap('B', 'a8');
    expect(screen.getByTestId('promotion-A')).toBeTruthy(); // A's choice is still waiting
    expect(screen.getByTestId('promotion-B')).toBeTruthy();
    const queen = screen.getByTestId('promote-B-q');
    fireTouch('touchstart', queen, [{ id: 4, x: 20, y: 20 }]);
    fireTouch('touchend', queen, [{ id: 4, x: 20, y: 20 }]);
    expect(labelOf('B', 'a8')).toContain('White queen');
    expect(screen.queryByTestId('promotion-B')).toBeNull();
    expect(screen.getByTestId('promotion-A')).toBeTruthy(); // choosing on B did not close A's
    const cancel = screen.getByTestId('promote-A-cancel');
    fireTouch('touchstart', cancel, [{ id: 5, x: 20, y: 20 }]);
    fireTouch('touchend', cancel, [{ id: 5, x: 20, y: 20 }]);
    expect(screen.queryByTestId('promotion-A')).toBeNull();
    expect(labelOf('A', 'a8')).not.toContain('queen');
  });
});

describe('the promotion choice is drawn in the colour of the side that promotes (command #27b)', () => {
  const paths = (id: string) => Array.from(screen.getByTestId(id).querySelectorAll('[data-svg="Path"]')) as HTMLElement[];

  it('Black promoting on A sees black pieces, White promoting on B sees white ones - all four choices, each its own silhouette', () => {
    const blackNear = '4k3/8/8/8/8/8/p7/4K3 b - - 0 1';
    const whiteNear = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    renderGame({ seats: cfg('HHHH'), startFrom: scene({ startMs: 0, a: blackNear, b: whiteNear }) });
    tap('A', 'a2');
    tap('A', 'a1');
    tap('B', 'a7');
    tap('B', 'a8');
    for (const piece of ['q', 'r', 'b', 'n'] as const) {
      const blackFills = paths(`promote-A-${piece}`).map((path) => path.getAttribute('data-fill'));
      const whiteFills = paths(`promote-B-${piece}`).map((path) => path.getAttribute('data-fill'));
      expect(blackFills.length, `A ${piece}`).toBeGreaterThan(0);
      expect(blackFills.every((fill) => fill === '#1d1d1d'), `A ${piece}`).toBe(true);
      expect(whiteFills.length, `B ${piece}`).toBeGreaterThan(0);
      expect(whiteFills.every((fill) => fill === '#fafafa'), `B ${piece}`).toBe(true);
      expect(paths(`promote-A-${piece}`).map((path) => path.getAttribute('data-d'))).toEqual([...PIECE_PATHS[piece]]);
    }
  });
});

describe('the size gate during a game: the rotate overlay', () => {
  it('rotating below the minimum covers the boards with the spec\'s message while the clocks keep running; rotating back removes it', () => {
    renderGame({ seats: cfg('HBHB') });
    expect(screen.queryByTestId('rotate-overlay')).toBeNull();
    setWindowSize(360, 640); // 22 px cells: below the 28 px minimum
    const overlay = screen.getByTestId('rotate-overlay');
    expect(overlay.textContent).toContain(BUGHOUSE_ROTATE_OVERLAY_TITLE);
    expect(overlay.textContent).toContain(BUGHOUSE_ROTATE_OVERLAY_DETAIL);
    expect(BUGHOUSE_ROTATE_OVERLAY_TITLE).toBe('Rotate the device to keep playing');
    const before = text('clock-A-white');
    advance(5000);
    expect(text('clock-A-white')).not.toBe(before); // Local has no pause
    setWindowSize(412, 915);
    expect(screen.queryByTestId('rotate-overlay')).toBeNull();
    expect(screen.getByTestId('layout-dual-stacked')).toBeTruthy();
  });

  it('the boundary: 240 x 736 (28 px) has no overlay, one pixel less has; 472 x 352 likewise in landscape', () => {
    renderGame({ seats: cfg('HBHB') });
    for (const [w, h, shown] of [
      [240, 736, false],
      [239, 736, true],
      [240, 735, true],
      [472, 352, false],
      [471, 352, true],
      [472, 351, true],
      [800, 360, false],
      [568, 320, true],
    ] as const) {
      setWindowSize(w, h);
      expect(screen.queryByTestId('rotate-overlay') !== null, `${w} x ${h}`).toBe(shown);
    }
  });

  it('the other layouts have no overlay at 360 x 640 (they have no minimum of two boards)', () => {
    setWindowSize(360, 640);
    renderGame({ seats: cfg('HBBB') });
    expect(screen.queryByTestId('rotate-overlay')).toBeNull();
  });

  it('the overlay is not shown over a finished match (the result card is)', () => {
    renderGame({ seats: cfg('HBHB') });
    fireEvent.click(screen.getByTestId('bughouse-resign-team-2'));
    setWindowSize(360, 640);
    expect(screen.queryByTestId('rotate-overlay')).toBeNull();
    expect(screen.getByTestId('game-over')).toBeTruthy();
  });
});

describe('the controls', () => {
  it('Resign is per team in the dual layout: one button per team that has a human, and it ends the match against that team', () => {
    renderGame({ seats: cfg('HBBH') }); // seats 0 (Team 1) and 3 (Team 1): only Team 1 is at the device
    expect(screen.queryByTestId('bughouse-resign-team-2')).toBeNull();
    fireEvent.click(screen.getByTestId('bughouse-resign-team-1'));
    expect(text('game-over-headline')).toBe('Team 2 wins');
  });

  it('with humans of both teams, both teams get a Resign button', () => {
    renderGame({ seats: cfg('HHHH') });
    expect(screen.getByTestId('bughouse-resign-team-1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('bughouse-resign-team-2'));
    expect(text('game-over-headline')).toBe('Team 1 wins');
    expect(screen.queryByTestId('turn-banner-A')).toBeNull(); // a finished match has no "who is to move" banner
    expect(screen.queryByTestId('turn-banner-B')).toBeNull();
  });

  it('with a shared board the turn control is there, and says what it does; without one it is not', () => {
    renderGame({ seats: cfg('HHBH') });
    expect(text('bughouse-autoflip')).toBe('Turn: auto');
    fireEvent.click(screen.getByTestId('bughouse-autoflip'));
    expect(text('bughouse-autoflip')).toBe('Turn: fixed');
  });

  it('humans with one human per board: no turn control (nothing turns)', () => {
    renderGame({ seats: cfg('HBBH') });
    expect(screen.queryByTestId('bughouse-autoflip')).toBeNull();
  });
});
