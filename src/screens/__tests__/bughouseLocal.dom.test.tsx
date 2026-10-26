import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppAlertHost from '../../components/AppAlert';
import { applyAction, legalDropsOn, legalMovesOn, type BughouseMatch, type BughouseSeat } from '../../logic/bughouse';
import type { BoardId } from '../../logic/bughouse/types';
import { BUGHOUSE_SIZE_GATE_MESSAGE, BUGHOUSE_COMING_NEXT_MESSAGE, presetSeatConfig } from '../../logic/bughouseLayout';
import { gameOverSummary, STUCK_CHECK_TEXT } from '../../logic/bughouseView';
import type { SeatConfig, SeatController } from '../../logic/fourPlayer/setup';
import { mulberry32 } from '../../logic/__tests__/bughouseTestKit';
import { scene, START } from '../../logic/__tests__/bughouseScenes';
import { setWindowSize, tapBoardSquare } from '../../test/domKit';
import BughouseGameScreen from '../BughouseGameScreen';
import BughouseSetupScreen from '../BughouseSetupScreen';
import PlayModeSelectScreen from '../PlayModeSelectScreen';

/**
 * BUGHOUSE W3a - the Local screens rendered for real (jsdom + react-native-web, the real boards, pockets, sheets and engine; see vitest.config.mts and src/test/domSetup.ts). A tap reaches
 * a board as the display cell a finger would have hit, filed under the board's name (`tapBoardSquare`). No wall clock: fake timers; the bots' randomness is seeded. What a screen shows
 * that comes from the engine (the squares a drop may go to, the verdict, the result) is compared with the engine, never recomputed here.
 */
const H: SeatController = { kind: 'human' };
const B: SeatController = { kind: 'bot', elo: 1200 };
const cfg = (a: string): SeatConfig => [a[0] === 'H' ? H : B, a[1] === 'H' ? H : B, a[2] === 'H' ? H : B, a[3] === 'H' ? H : B];
const TC3 = { initialMs: 180000, incrementMs: 0 };
const TC1 = { initialMs: 60000, incrementMs: 0 };
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
/** Scene helper on the screen's time base (it starts at 0). */
const sceneAt0 = (o: Parameters<typeof scene>[0]) => scene({ startMs: 0, ...o });
const testIdsIn = (board: BoardId): string[] => Array.from(screen.getByTestId(`board-${board}`).querySelectorAll('[data-testid]')).map((el) => el.getAttribute('data-testid') ?? '');
const labelOf = (board: BoardId, square: string): string => screen.getByTestId(`${board}-${square}`).getAttribute('aria-label') ?? '';
const offered = (board: BoardId): string[] => testIdsIn(board).filter((id) => /can (move|drop) here/.test(screen.getByTestId(id).getAttribute('aria-label') ?? '')).map((id) => id.slice(2)).sort();
const text = (id: string): string => screen.getByTestId(id).textContent ?? '';

describe('the Play menu', () => {
  const baseProps = (over: Record<string, unknown> = {}): ComponentProps<typeof PlayModeSelectScreen> =>
    ({ authUser: null, onAuthPress: vi.fn(), onBughouse: vi.fn(), ...over }) as unknown as ComponentProps<typeof PlayModeSelectScreen>;

  it('lists Bughouse as a card of its own next to the other variants, with Local and a "How to play" link', () => {
    render(
      <>
        <PlayModeSelectScreen {...baseProps()} />
        <AppAlertHost />
      </>
    );
    const card = screen.getByTestId('bughouse-card');
    expect(within(card).getByText('Bughouse')).toBeTruthy();
    expect(within(card).getByLabelText('Bughouse local')).toBeTruthy();
    expect(within(card).getByText(/How to play/)).toBeTruthy();
    expect(screen.getByText('Chaturaji')).toBeTruthy(); // the other cards are still there
    expect(screen.getByText('4 Player Giveaway')).toBeTruthy();
  });

  it('Local goes straight to the setup', () => {
    const onBughouse = vi.fn();
    render(<PlayModeSelectScreen {...baseProps({ onBughouse })} />);
    fireEvent.click(screen.getByLabelText('Bughouse local'));
    expect(onBughouse).toHaveBeenCalledTimes(1);
  });

  it('the rules sheet opens from the card and closes again; it is generated from the engine (the six controls, no draws)', () => {
    render(<PlayModeSelectScreen {...baseProps()} />);
    expect(screen.queryByTestId('bughouse-rules-sheet')).toBeNull();
    fireEvent.click(screen.getByTestId('bughouse-rules-link'));
    const sheet = screen.getByTestId('bughouse-rules-sheet');
    expect(within(sheet).getByText('How to play Bughouse')).toBeTruthy();
    expect(within(sheet).getByText(/Time controls: 1 min, 2 \| 1, 3 min, 3 \| 2, 5 min, 5 \| 2\./)).toBeTruthy();
    expect(within(sheet).getByText('There are no draws in Bughouse.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('bughouse-rules-close'));
    expect(screen.queryByTestId('bughouse-rules-sheet')).toBeNull();
  });
});

describe('the setup screen', () => {
  /** The screen holds its own seats, like App does. */
  function Harness({ initial = presetSeatConfig('solo'), onContinue = () => {} }: { initial?: SeatConfig; onContinue?: () => void }) {
    const [seats, setSeats] = useState(initial);
    return <BughouseSetupScreen seats={seats} onChange={setSeats} onPickBot={() => {}} onContinue={onContinue} onBack={() => {}} />;
  }
  const start = () => screen.getByTestId('bughouse-start');
  const disabled = () => start().getAttribute('aria-disabled') === 'true';

  it('has four rows labelled Board / colour / team, Human or Bot each, and four presets', () => {
    render(<Harness />);
    expect([0, 1, 2, 3].map((s) => within(screen.getByTestId(`seat-row-${s}`)).getByText(/^Board [AB] · /).textContent)).toEqual(['Board A · White · Team 1', 'Board A · Black · Team 2', 'Board B · White · Team 2', 'Board B · Black · Team 1']);
    expect(screen.getByLabelText('Board A · White · Team 1: human')).toBeTruthy();
    expect(screen.getByLabelText('Board B · Black · Team 1: bot')).toBeTruthy();
    expect(within(screen.getByTestId('presets')).getAllByRole('button').map((b) => b.textContent)).toEqual(['You + 3 bots', '2 opponents', '2 teammates', '4 players']);
    expect(screen.queryByTestId('setup-gate-message')).toBeNull();
    expect(disabled()).toBe(false);
  });

  it('a preset fills the four rows; a row can be switched by hand', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('preset-opponents'));
    expect(screen.queryByLabelText('Board A · Black · Team 2 bot: Amateur, change')).toBeNull(); // a human now
    expect(within(screen.getByTestId('seat-row-2')).getByText('Amateur')).toBeTruthy(); // a bot row shows its roster entry
    fireEvent.click(screen.getByLabelText('Board B · White · Team 2: human'));
    expect(within(screen.getByTestId('seat-row-2')).queryByText(/ELO/)).toBeNull();
  });

  it('Start is disabled with no human, and says why', () => {
    render(<Harness initial={cfg('BBBB')} />);
    expect(disabled()).toBe(true);
    expect(text('setup-gate-message')).toBe('At least one seat must be a human.');
  });

  it('humans on both boards: the spec\'s size message below the minimum, "coming next" above it, Start disabled both ways', () => {
    render(<Harness initial={presetSeatConfig('teammates')} />);
    setWindowSize(360, 640);
    expect(text('setup-gate-message')).toBe(BUGHOUSE_SIZE_GATE_MESSAGE);
    expect(BUGHOUSE_SIZE_GATE_MESSAGE).toBe('This seat setup needs a larger screen. Turn the device to landscape, or put every human on one board.');
    expect(disabled()).toBe(true);
    setWindowSize(412, 915); // rotating / resizing updates it at once
    expect(text('setup-gate-message')).toBe(BUGHOUSE_COMING_NEXT_MESSAGE);
    expect(disabled()).toBe(true);
  });

  it('...at the exact boundaries of the spec: 240 x 736 and 472 x 352 are big enough, one pixel less is not', () => {
    render(<Harness initial={presetSeatConfig('teammates')} />);
    const messageAt = (w: number, h: number) => {
      setWindowSize(w, h);
      return text('setup-gate-message');
    };
    expect(messageAt(240, 736)).toBe(BUGHOUSE_COMING_NEXT_MESSAGE);
    expect(messageAt(239, 736)).toBe(BUGHOUSE_SIZE_GATE_MESSAGE);
    expect(messageAt(240, 735)).toBe(BUGHOUSE_SIZE_GATE_MESSAGE);
    expect(messageAt(472, 352)).toBe(BUGHOUSE_COMING_NEXT_MESSAGE);
    expect(messageAt(471, 352)).toBe(BUGHOUSE_SIZE_GATE_MESSAGE);
    expect(messageAt(472, 351)).toBe(BUGHOUSE_SIZE_GATE_MESSAGE);
    expect(messageAt(360, 640)).toBe(BUGHOUSE_SIZE_GATE_MESSAGE);
    expect(messageAt(800, 360)).toBe(BUGHOUSE_COMING_NEXT_MESSAGE);
  });

  it('humans on one board, or one human, start in any window and go on', () => {
    const onContinue = vi.fn();
    render(<Harness initial={presetSeatConfig('opponents')} onContinue={onContinue} />);
    setWindowSize(360, 640);
    expect(screen.queryByTestId('setup-gate-message')).toBeNull();
    fireEvent.click(start());
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('"How to play" opens the same rules sheet', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('how-to-play'));
    expect(within(screen.getByTestId('bughouse-rules-sheet')).getByText('How to play Bughouse')).toBeTruthy();
  });
});

describe('the rules sheet from every entry point', () => {
  it('the game\'s Rules button opens the same sheet (the Play menu and the setup open it too, tested above)', () => {
    renderGame({ seats: cfg('HBBB') });
    expect(screen.queryByTestId('bughouse-rules-sheet')).toBeNull();
    fireEvent.click(screen.getByTestId('bughouse-rules'));
    const sheet = screen.getByTestId('bughouse-rules-sheet');
    expect(within(sheet).getByText('How to play Bughouse')).toBeTruthy();
    expect(within(sheet).getByText('There are no draws in Bughouse.')).toBeTruthy();
    fireEvent.click(screen.getByTestId('bughouse-rules-close'));
    expect(screen.queryByTestId('bughouse-rules-sheet')).toBeNull();
  });
});

describe('the layout follows from where the humans sit', () => {
  it('one human on a portrait phone: the large board, the partner\'s board as a thumbnail, four clocks, pockets for all four players', () => {
    renderGame({ seats: cfg('HBBB') });
    expect(screen.getByTestId('layout-thumbnail')).toBeTruthy();
    expect(screen.getByTestId('block-A')).toBeTruthy();
    expect(screen.getByTestId('thumb-B')).toBeTruthy();
    expect(screen.queryByTestId('block-B')).toBeNull();
    expect(screen.queryByTestId('bughouse-compact-bar')).toBeNull(); // the portrait layout keeps the regular header
    expect(screen.queryByTestId('turn-banner')).toBeNull();
    expect(['A-white', 'A-black'].map((k) => text(`clock-${k}`))).toEqual(['3:00', '3:00']);
    expect(['A-white', 'A-black'].every((k) => screen.getByTestId(`pocket-${k}`))).toBe(true);
    expect(screen.getByTestId('thumb-line-B-white').textContent).toContain('3:00');
    expect(screen.getByTestId('thumb-line-B-black').textContent).toContain('3:00');
  });

  it('humans on one board: pass and play on that board (a banner, the other board a thumbnail)', () => {
    renderGame({ seats: cfg('BBHH') });
    expect(text('turn-banner')).toBe('White to move');
    expect(screen.getByTestId('block-B')).toBeTruthy();
    expect(screen.getByTestId('thumb-A')).toBeTruthy();
  });

  it('landscape and tablets: two equal boards side by side, each with its two clocks and pockets', () => {
    setWindowSize(800, 360);
    renderGame({ seats: cfg('HBBB') });
    expect(screen.getByTestId('layout-side-by-side')).toBeTruthy();
    expect(screen.getByTestId('block-A')).toBeTruthy();
    expect(screen.getByTestId('block-B')).toBeTruthy();
    expect(screen.queryByTestId('thumb-B')).toBeNull();
    expect(screen.getByTestId('bughouse-compact-bar')).toBeTruthy(); // one slim bar: the two boards leave no height to spare
    for (const key of ['A-white', 'A-black', 'B-white', 'B-black']) expect(screen.getByTestId(`clock-${key}`)).toBeTruthy();
  });

  it('humans on both boards are not playable yet: the screen says so instead of a broken layout', () => {
    renderGame({ seats: cfg('HBBH') });
    expect(screen.getByText('This seat setup is not available yet.')).toBeTruthy();
    expect(screen.queryByTestId('block-A')).toBeNull();
  });
});

describe('orientation (S-U3) and the team badge', () => {
  const firstCell = (board: BoardId) => (testIdsIn(board).find((id) => /^[AB]-[a-h][1-8]$/.test(id)) ?? '').slice(2);

  it('one human playing White on board A: own board White at the bottom, the partner\'s board Black at the bottom (the partner\'s colour)', () => {
    renderGame({ seats: cfg('HBBB') });
    expect(firstCell('A')).toBe('a8'); // top-left cell of a White-at-the-bottom board
    fireEvent.click(screen.getByTestId('thumb-B'));
    expect(screen.getByTestId('block-B')).toBeTruthy();
    expect(firstCell('B')).toBe('h1'); // top-left of a Black-at-the-bottom board
    expect(screen.getByTestId('thumb-A')).toBeTruthy();
  });

  it('...and for a human playing Black on board B the own board is Black at the bottom and the partner\'s White', () => {
    renderGame({ seats: cfg('BBBH') });
    expect(screen.getByTestId('block-B')).toBeTruthy();
    expect(firstCell('B')).toBe('h1');
    fireEvent.click(screen.getByTestId('thumb-A'));
    expect(firstCell('A')).toBe('a8');
  });

  it('one human: the human\'s team is badged on both of its kings, "your team"; the opponents\' kings carry nothing', () => {
    renderGame({ seats: cfg('HBBB') });
    expect(labelOf('A', 'e1')).toMatch(/, your team$/);
    expect(screen.getByTestId('badge-A-e1')).toBeTruthy();
    expect(labelOf('A', 'e8')).not.toMatch(/team/);
    expect(screen.queryByTestId('badge-A-e8')).toBeNull();
    fireEvent.click(screen.getByTestId('thumb-B')); // the partner's board: its Black king is the partner
    expect(labelOf('B', 'e8')).toMatch(/, your team$/);
    expect(labelOf('B', 'e1')).not.toMatch(/team/);
  });

  it('several humans: both teams on all four kings, diamond for Team 1 and circle for Team 2 (shape-coded)', () => {
    setWindowSize(800, 360);
    renderGame({ seats: cfg('HHBB') });
    expect(labelOf('A', 'e1')).toMatch(/, Team 1$/);
    expect(labelOf('A', 'e8')).toMatch(/, Team 2$/);
    expect(labelOf('B', 'e1')).toMatch(/, Team 2$/);
    expect(labelOf('B', 'e8')).toMatch(/, Team 1$/);
    const rotation = (id: string) => (screen.getByTestId(id).style.transform || '').includes('rotate');
    const radius = (id: string) => screen.getByTestId(id).style.borderTopLeftRadius;
    expect(rotation('badge-A-e1')).toBe(true); // diamond
    expect(rotation('badge-B-e1')).toBe(false); // circle
    expect(['', '0px']).not.toContain(radius('badge-B-e1')); // a round badge
    expect(['', '0px']).toContain(radius('badge-A-e1')); // the diamond has square corners
  });
});

describe('pass and play', () => {
  it('the board turns to the side to move with a "<Colour> to move" banner, and only the side to move can touch', () => {
    renderGame({ seats: cfg('HHBB') });
    setWindowSize(412, 915);
    const first = () => (testIdsIn('A').find((id) => /^A-[a-h][1-8]$/.test(id)) ?? '').slice(2);
    expect(text('turn-banner')).toBe('White to move');
    expect(first()).toBe('a8');
    tapBoardSquare('A', 'e2', 'w');
    expect(offered('A')).toEqual(['e3', 'e4']);
    tapBoardSquare('A', 'e4', 'w');
    expect(text('turn-banner')).toBe('Black to move');
    expect(first()).toBe('h1'); // turned to Black
    expect(labelOf('A', 'e4')).toContain('White pawn');
    // the side that just moved cannot touch: White's pawn is not selectable on Black's turn
    tapBoardSquare('A', 'e4', 'b');
    expect(offered('A')).toEqual([]);
    // Black can
    tapBoardSquare('A', 'e7', 'b');
    expect(offered('A')).toEqual(['e5', 'e6']);
    tapBoardSquare('A', 'e5', 'b');
    expect(text('turn-banner')).toBe('White to move');
    expect(first()).toBe('a8');
  });

  it('the other board runs with bots and a human cannot touch it', () => {
    renderGame({ seats: cfg('HHBB') });
    // board B is shown as a thumbnail: no board B element takes taps while the bots hold it; even tapping through the seam changes nothing
    expect(screen.queryByTestId('block-B')).toBeNull();
    fireEvent.click(screen.getByTestId('thumb-B')); // swap: B becomes the large board
    tapBoardSquare('B', 'e2', 'b');
    expect(offered('B')).toEqual([]);
  });

  it('"Auto-turn: off" keeps White at the bottom', () => {
    renderGame({ seats: cfg('HHBB') });
    fireEvent.click(screen.getByTestId('bughouse-autoflip'));
    tapBoardSquare('A', 'e2', 'w');
    tapBoardSquare('A', 'e4', 'w');
    expect(text('turn-banner')).toBe('Black to move');
    expect((testIdsIn('A').find((id) => /^A-[a-h][1-8]$/.test(id)) ?? '').slice(2)).toBe('a8');
  });
});

describe('a selection survives the bots playing the OTHER board (found in the browser: a commit anywhere cleared it)', () => {
  it('a selected piece, and a picked pocket piece, stay while a bot moves on the other board; they go when their own board changes', () => {
    const m = sceneAt0({ a: 'k7/8/8/8/8/8/4P3/K7 w - - 0 1', b: START, pockets: { 0: { n: 1 } } });
    renderGame({ seats: cfg('HBBB'), startFrom: m });
    tapBoardSquare('A', 'e2', 'w');
    expect(offered('A')).toEqual(['e3', 'e4']);
    fireEvent.click(screen.getByTestId('pocket-A-white-n'));
    expect(offered('A').length).toBe(61); // the pick replaced the selection: the knight's squares
    tapBoardSquare('A', 'a1', 'w'); // (own king: cancels the pick and selects the king)
    expect(offered('A')).toEqual(['a2', 'b1', 'b2']);
    // the bot of board B thinks for 450 ms and moves: board B's position changed, board A's did not
    const boardB = () => testIdsIn('B').map((id) => screen.getByTestId(id).getAttribute('aria-label')).join('|');
    const before = boardB();
    advance(500);
    expect(boardB()).not.toBe(before); // the bot moved on board B
    expect(labelOf('A', 'e2')).toContain('White pawn');
    expect(offered('A')).toEqual(['a2', 'b1', 'b2']); // still selected after the bot's move on B
    tapBoardSquare('A', 'a2', 'w'); // the second tap of the pair completes
    expect(labelOf('A', 'a2')).toContain('White king');
  });
});

describe('drops: a tap on a pocket piece, then a highlighted square', () => {
  const start = (extra: Parameters<typeof scene>[0]) => sceneAt0({ a: 'k7/8/8/8/8/8/8/K7 w - - 0 1', b: START, ...extra });

  it('the legal squares are the engine\'s; a pawn is never offered on the 1st or 8th rank; the drop is played and spent', () => {
    const m = start({ pockets: { 0: { n: 1, p: 1 } } });
    renderGame({ seats: cfg('HHBB'), startFrom: m });
    // the pocket shows its pieces and counts
    expect(screen.getByTestId('pocket-A-white-n').textContent).toContain('1');
    fireEvent.click(screen.getByTestId('pocket-A-white-p'));
    const pawnSquares = offered('A');
    expect(pawnSquares).toEqual(legalDropsOn(m, 'A').filter((d) => d.piece === 'p').map((d) => d.square).sort());
    expect(pawnSquares.length).toBe(48);
    expect(pawnSquares.some((s) => s[1] === '1' || s[1] === '8')).toBe(false);
    // switching to the knight changes the highlight to the engine's knight squares
    fireEvent.click(screen.getByTestId('pocket-A-white-n'));
    expect(offered('A')).toEqual(legalDropsOn(m, 'A').filter((d) => d.piece === 'n').map((d) => d.square).sort());
    expect(offered('A').length).toBe(62);
    // an occupied square is not a target: tapping the enemy king's square cancels the drop and changes nothing
    tapBoardSquare('A', 'a8', 'w');
    expect(offered('A')).toEqual([]);
    expect(labelOf('A', 'a8')).toContain('Black king');
    expect(screen.getByTestId('pocket-A-white-n').textContent).toContain('1');
    // pick again and drop on e4
    fireEvent.click(screen.getByTestId('pocket-A-white-n'));
    tapBoardSquare('A', 'e4', 'w');
    expect(labelOf('A', 'e4')).toContain('White knight');
    expect(screen.queryByTestId('pocket-A-white-n')).toBeNull(); // spent
    expect(text('turn-banner')).toBe('Black to move');
  });

  it('with a check to answer, only the blocking squares are offered, and a pawn has none', () => {
    const m = sceneAt0({ a: '4k3/8/8/8/8/8/8/K6r w - - 0 1', b: START, pockets: { 0: { n: 1, p: 1 } } });
    renderGame({ seats: cfg('HHBB'), startFrom: m });
    fireEvent.click(screen.getByTestId('pocket-A-white-n'));
    expect(offered('A')).toEqual(['b1', 'c1', 'd1', 'e1', 'f1', 'g1']);
    // a pawn chip cannot even be picked: no legal square (it is greyed)
    expect(screen.getByTestId('pocket-A-white-p').getAttribute('aria-disabled')).toBe('true');
  });

  it('only the side to move can use its pocket; the other side\'s chips are inert', () => {
    const m = start({ pockets: { 0: { n: 1 }, 1: { n: 1 } } });
    renderGame({ seats: cfg('HHBB'), startFrom: m });
    expect(screen.getByTestId('pocket-A-black-n').getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByTestId('pocket-A-black-n'));
    expect(offered('A')).toEqual([]);
  });
});

describe('the capture -> partner pocket transfer is visible', () => {
  it('a capture puts the piece in the PARTNER\'s pocket on the other board and lights that pocket', () => {
    const m = sceneAt0({ a: 'k7/8/8/3p4/4P3/8/8/K7 w - - 0 1', b: START });
    setWindowSize(800, 360); // both boards, with their pockets, on screen
    renderGame({ seats: cfg('HHBB'), startFrom: m });
    expect(screen.queryByTestId('pocket-B-black-p')).toBeNull();
    tapBoardSquare('A', 'e4', 'w');
    tapBoardSquare('A', 'd5', 'w');
    // seat 0 (Board A White) captured: the pawn goes to seat 3 (Board B Black)
    expect(screen.getByTestId('pocket-B-black-p')).toBeTruthy();
    expect(screen.getByTestId('pocket-B-black').getAttribute('aria-label')).toBe('Board B black pocket, just received a piece');
    expect(screen.getByTestId('pocket-A-black').getAttribute('aria-label')).toBe('Board A black pocket');
    expect(screen.getByTestId('pocket-B-white').getAttribute('aria-label')).toBe('Board B white pocket');
  });
});

describe('check, stuck and the last move', () => {
  it('a stuck side is shown as WAITING for a piece from its partner, never as mate', () => {
    const m = sceneAt0({ a: 'R6k/6pp/8/8/8/8/8/K7 b - - 0 1', b: START });
    expect(m.verdicts.A.status).toBe('stuck'); // the engine's own verdict
    renderGame({ seats: cfg('HHBB'), startFrom: m });
    expect(text('status-A')).toBe(STUCK_CHECK_TEXT);
    expect(text('status-A')).toBe('In check - waiting for a piece from your partner to block it');
    expect(document.body.textContent).not.toMatch(/checkmate|mated/i);
    expect(screen.queryByTestId('game-over')).toBeNull();
    // the king in check is highlighted
    expect(screen.getByTestId('A-h8').style.backgroundColor).toBe('rgb(239, 83, 80)');
  });

  it('a stuck side with nothing to do and no check is waiting too', () => {
    const m = sceneAt0({ a: START, b: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' });
    renderGame({ seats: cfg('BBHH'), startFrom: m });
    expect(text('status-B')).toBe('Waiting for a piece from your partner');
  });

  it('the check highlight and the last move of each board', () => {
    const m = sceneAt0({ a: '4k3/8/8/8/8/8/8/K6r w - - 0 1', b: START });
    renderGame({ seats: cfg('HHBB'), startFrom: m });
    expect(screen.getByTestId('A-a1').style.backgroundColor).toBe('rgb(239, 83, 80)');
    expect(text('status-A')).toBe('Check - your king is attacked');
  });

  it('a move highlights its two squares on its own board only', () => {
    renderGame({ seats: cfg('HHBB') });
    tapBoardSquare('A', 'e2', 'w');
    tapBoardSquare('A', 'e4', 'w');
    const yellow = 'rgb(247, 236, 116)';
    expect(screen.getByTestId('A-e2').style.backgroundColor).toBe(yellow);
    expect(screen.getByTestId('A-e4').style.backgroundColor).toBe(yellow);
    expect(screen.getByTestId('A-d2').style.backgroundColor).not.toBe(yellow);
  });
});

describe('promotion', () => {
  it('a pawn reaching the last rank asks what to become and promotes to the chosen piece', () => {
    const m = sceneAt0({ a: '8/P6k/8/8/8/8/8/K7 w - - 0 1', b: START });
    renderGame({ seats: cfg('HHBB'), startFrom: m });
    tapBoardSquare('A', 'a7', 'w');
    tapBoardSquare('A', 'a8', 'w');
    fireEvent.click(screen.getByLabelText('Promote to Knight'));
    expect(labelOf('A', 'a8')).toContain('White knight');
  });
});

describe('a game with one human and three bots, played to its end', () => {
  it('the human opens, the bots play on their clocks, and the game ends with the deciding board highlighted and the engine\'s result shown', () => {
    renderGame({ seats: cfg('HBBB'), timeControl: TC1, rng: mulberry32(4242) });
    tapBoardSquare('A', 'e2', 'w');
    tapBoardSquare('A', 'e4', 'w');
    expect(labelOf('A', 'e4')).toContain('White pawn');
    // the human then lets the clock run: the bots keep playing board B and the black bot answers on board A
    for (let i = 0; i < 400 && !screen.queryByTestId('game-over'); i++) advance(250);
    expect(screen.getByTestId('game-over')).toBeTruthy();
    const detail = text('game-over-detail');
    const headline = text('game-over-headline');
    expect(headline).toMatch(/^Team [12] wins$/);
    const board = /^Board ([AB]) - (checkmate|flag fell|resigned)$/.exec(detail);
    expect(board, detail).not.toBeNull();
    const deciding = board![1] as BoardId;
    const other: BoardId = deciding === 'A' ? 'B' : 'A';
    // both final boards are visible (the large board and the thumbnail); the deciding one is outlined
    expect(screen.getByTestId('board-A')).toBeTruthy();
    expect(screen.getByTestId('board-B')).toBeTruthy();
    expect(screen.getByTestId(`board-${deciding}`).getAttribute('aria-label')).toBe(`Board ${deciding}, deciding board`);
    expect(screen.getByTestId(`board-${other}`).getAttribute('aria-label')).toBe(`Board ${other}`);
    // the buttons
    expect(screen.getByTestId('bughouse-rematch')).toBeTruthy();
    expect(screen.getByTestId('bughouse-menu')).toBeTruthy();
    // no clock is running any more
    const before = [text('clock-A-white'), text('clock-A-black')];
    advance(5000);
    expect([text('clock-A-white'), text('clock-A-black')]).toEqual(before);
  }, 120_000);

  it('Rematch starts a fresh match; Back to menu leaves', () => {
    const onExit = vi.fn();
    const m = sceneAt0({ a: START, b: START });
    renderGame({ seats: cfg('HHBB'), startFrom: m, onExit });
    // resign ends it at once (the side to move on the shared board resigns)
    fireEvent.click(screen.getByTestId('bughouse-resign'));
    expect(screen.getByTestId('game-over')).toBeTruthy();
    expect(text('game-over-headline')).toBe('Team 2 wins');
    expect(text('game-over-detail')).toBe('Board A - resigned');
    fireEvent.click(screen.getByTestId('bughouse-menu'));
    expect(onExit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('bughouse-rematch'));
    expect(screen.queryByTestId('game-over')).toBeNull();
    expect(text('clock-A-white')).toBe('3:00');
  });
});

describe('the deciding board and the result, compared with the engine', () => {
  const scholar: [BughouseSeat, string, string][] = [
    [0, 'e2', 'e4'],
    [1, 'e7', 'e5'],
    [0, 'f1', 'c4'],
    [1, 'b8', 'c6'],
    [0, 'd1', 'h5'],
    [1, 'g8', 'f6'],
    [0, 'h5', 'f7'],
  ];
  it('a checkmate on board A by two humans: the card says what the engine says, board A is outlined', () => {
    // the engine's answer for the same game
    let engine: BughouseMatch = sceneAt0({ a: START, b: START });
    for (const [seat, from, to] of scholar) {
      const out = applyAction(engine, seat, { kind: 'move', board: 'A', from, to }, engine.nowMs + 1);
      if (!out.ok) throw new Error(out.reason);
      engine = out.match;
    }
    const summary = gameOverSummary(engine)!;
    renderGame({ seats: cfg('HHBB') });
    for (const [seat, from, to] of scholar) tapMoveFor(seat, from, to);
    expect(text('game-over-headline')).toBe(summary.headline);
    expect(text('game-over-detail')).toBe(summary.detail);
    expect(text('status-A')).toBe('Checkmate');
    expect(screen.getByTestId('board-A').getAttribute('aria-label')).toBe('Board A, deciding board');
    expect(legalMovesOn(engine, 'A')).toEqual([]); // the engine agrees nothing is left to play
  });
  function tapMoveFor(seat: BughouseSeat, from: string, to: string) {
    const orientation = seat === 0 ? 'w' : 'b';
    // pass-and-play turns the board; the bot's own moves on board B happen between (fake time does not pass here)
    tapBoardSquare('A', from, orientation);
    tapBoardSquare('A', to, orientation);
  }
});
