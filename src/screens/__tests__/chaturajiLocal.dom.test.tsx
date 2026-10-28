import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppAlertHost from '../../components/AppAlert';
import { CHATURAJI_RULES, chooseBotMoveFor, defaultSeatConfig, initialState, playMove, resign, type FourPlayerState, type Seat, type SeatConfig } from '../../logic/fourPlayer';
import { cp, findMove } from '../../logic/__tests__/chaturajiKit';
import { cellOf, maybeCellOf, offeredSquares, seatCard, tapMove, tapSquare } from '../../test/domKit';
import type { TimeControl } from '../../types/timeControl';
import FourPlayerGameScreen from '../FourPlayerGameScreen';
import FourPlayerSetupScreen from '../FourPlayerSetupScreen';
import PlayModeSelectScreen from '../PlayModeSelectScreen';

/**
 * CHATURAJI W3 - the local screens, rendered for real (jsdom + react-native-web, the real board, seat strip, sheets and engine; see vitest.config.mts and src/test/domSetup.ts).
 * A tap is delivered to the board as the display cell a finger would have hit (`tapSquare`): the pixel -> cell step is shared by every board and is tested elsewhere.
 * No wall clock anywhere: the screens run on fake timers and every game position comes from the engine.
 */
const RED = 0 as Seat;
const NO_CLOCK: TimeControl = { id: 'none', label: 'No time limit', initialSeconds: 0, incrementSeconds: 0, category: 'unlimited' };
const HUMANS: SeatConfig = [{ kind: 'human' }, { kind: 'human' }, { kind: 'human' }, { kind: 'human' }];
const KINGS = ['rK@a1', 'bK@a8', 'yK@h8', 'gK@h1'];

/** A seeded replacement for Math.random (the bots draw from it): the same seed gives the same stream, so a rendered game is the same on every run. */
const seededRandom = (start: number) => {
  let seed = start;
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x80000000;
  };
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.restoreAllMocks();
});


const renderGame = (props: { seats?: SeatConfig; startFrom?: FourPlayerState; onExit?: () => void } = {}) =>
  render(
    <>
      <FourPlayerGameScreen variant="chaturaji" seats={props.seats ?? HUMANS} timeControl={NO_CLOCK} startFrom={props.startFrom} onExit={props.onExit ?? (() => {})} />
      <AppAlertHost />
    </>
  );

describe('the Play menu', () => {
  // only the callbacks a test presses are given: every other prop is read when its button is pressed, which these tests never do
  const baseProps = (over: Record<string, unknown> = {}): ComponentProps<typeof PlayModeSelectScreen> =>
    ({ authUser: null, onAuthPress: vi.fn(), onChaturaji: vi.fn(), onChaturajiOnline: vi.fn(), ...over }) as unknown as ComponentProps<typeof PlayModeSelectScreen>;

  it('lists Chaturaji as a card of its own with Local, Online and a "How to play" link', () => {
    render(
      <>
        <PlayModeSelectScreen {...baseProps()} />
        <AppAlertHost />
      </>
    );
    const card = screen.getByTestId('chaturaji-card');
    expect(within(card).getByText('Chaturaji')).toBeTruthy();
    expect(within(card).getByLabelText('Chaturaji local')).toBeTruthy();
    expect(within(card).getByLabelText('Chaturaji online')).toBeTruthy();
    expect(within(card).getByText(/How to play/)).toBeTruthy();
    expect(screen.getByText('4 Player Chess')).toBeTruthy(); // the other cards are still there
    expect(screen.getByText('4 Player Giveaway')).toBeTruthy();
  });

  it('Local goes straight on; Online asks a logged-out player to log in first, and goes on once logged in', () => {
    const onChaturaji = vi.fn();
    const onChaturajiOnline = vi.fn();
    const onAuthPress = vi.fn();
    const { rerender } = render(
      <>
        <PlayModeSelectScreen {...baseProps({ onChaturaji, onChaturajiOnline, onAuthPress })} />
        <AppAlertHost />
      </>
    );
    fireEvent.click(screen.getByLabelText('Chaturaji local'));
    expect(onChaturaji).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Chaturaji online'));
    expect(onChaturajiOnline).not.toHaveBeenCalled();
    expect(screen.getByText('Login required')).toBeTruthy();
    fireEvent.click(screen.getByText('Log in / Sign up'));
    expect(onAuthPress).toHaveBeenCalledTimes(1);
    rerender(
      <>
        <PlayModeSelectScreen {...baseProps({ onChaturaji, onChaturajiOnline, onAuthPress, authUser: { id: 'u', email: 'e', username: 'u', createdAt: '' } })} />
        <AppAlertHost />
      </>
    );
    fireEvent.click(screen.getByLabelText('Chaturaji online'));
    expect(onChaturajiOnline).toHaveBeenCalledTimes(1);
  });

  it('the rules sheet opens from the menu card and closes again', () => {
    render(<PlayModeSelectScreen {...baseProps()} />);
    expect(screen.queryByText('How to play Chaturaji')).toBeNull();
    fireEvent.click(screen.getByLabelText('Chaturaji rules'));
    expect(screen.getByText('How to play Chaturaji')).toBeTruthy();
    for (const title of ['The set-up', 'The pieces', 'Capture the King', 'Points', 'Leaving the game', 'The end']) expect(screen.getByText(title), title).toBeTruthy();
    expect(screen.getByText(/Pawn 1 · Knight 3 · King 3 · Bishop 5 · Boat 5/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('rules-close'));
    expect(screen.queryByText('How to play Chaturaji')).toBeNull();
  });

  it('"Return to your game" sits under the card of the game that was left, and under no other', () => {
    const resume = vi.fn();
    const { unmount } = render(<PlayModeSelectScreen {...baseProps({ onFourPlayerResume: resume, fourPlayerResumeVariant: 'chaturaji' })} />);
    expect(within(screen.getByTestId('chaturaji-card')).getByText(/Return to your game/)).toBeTruthy();
    expect(screen.getAllByText(/Return to your game/)).toHaveLength(1);
    fireEvent.click(screen.getByText(/Return to your game/));
    expect(resume).toHaveBeenCalledTimes(1);
    unmount();
    render(<PlayModeSelectScreen {...baseProps({ onFourPlayerResume: resume })} />); // no variant named: 4 Player Chess, as before Chaturaji
    expect(screen.getAllByText(/Return to your game/)).toHaveLength(1);
    expect(within(screen.getByTestId('chaturaji-card')).queryByText(/Return to your game/)).toBeNull();
  });
});

describe('the setup screen', () => {
  it('explains the game, offers the rules, and keeps the seat choices (at least one human)', () => {
    const onChange = vi.fn();
    render(<FourPlayerSetupScreen variant="chaturaji" seats={defaultSeatConfig()} onChange={onChange} onPickBot={() => {}} onContinue={() => {}} onBack={() => {}} />);
    expect(screen.getAllByText('Chaturaji').length).toBeGreaterThan(0);
    expect(screen.getByText(/A king must be captured; a check need not be answered/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('how-to-play'));
    expect(screen.getByText('How to play Chaturaji')).toBeTruthy();
    fireEvent.click(screen.getByTestId('rules-close'));
    expect(screen.queryByText('How to play Chaturaji')).toBeNull();
  });

  it('the other games\' setup screens have no rules link', () => {
    render(<FourPlayerSetupScreen variant="ffa" seats={defaultSeatConfig()} onChange={() => {}} onPickBot={() => {}} onContinue={() => {}} onBack={() => {}} />);
    expect(screen.queryByTestId('how-to-play')).toBeNull();
  });
});

describe('the local game', () => {
  it('starts on the 8 x 8 board with the spec\'s set-up: Red at the bottom, every army in its corner, 32 pieces', () => {
    renderGame();
    expect(screen.getByLabelText('Chaturaji board')).toBeTruthy();
    const expected: Record<string, string> = {
      a1: 'Red boat', b1: 'Red knight', c1: 'Red bishop', d1: 'Red king', a2: 'Red pawn', d2: 'Red pawn',
      a8: 'Blue boat', a7: 'Blue knight', a6: 'Blue bishop', a5: 'Blue king', b8: 'Blue pawn', b5: 'Blue pawn',
      h8: 'Yellow boat', g8: 'Yellow knight', f8: 'Yellow bishop', e8: 'Yellow king', h7: 'Yellow pawn', e7: 'Yellow pawn',
      h1: 'Green boat', h2: 'Green knight', h3: 'Green bishop', h4: 'Green king', g1: 'Green pawn', g4: 'Green pawn',
    };
    for (const [square, piece] of Object.entries(expected)) expect(cellOf(square).getAttribute('aria-label'), square).toContain(piece);
    for (const empty of ['e1', 'f4', 'd5', 'e5', 'c8']) expect(cellOf(empty).getAttribute('aria-label'), empty).toBe(empty);
    expect(screen.getAllByTestId('boat')).toHaveLength(4); // the rooks are drawn as boats
    expect(screen.getByText('Red to move')).toBeTruthy();
  });

  it('a tap on a piece offers exactly its legal moves (the engine\'s), a tap on a target plays it, and the move list names the squares on this board', () => {
    renderGame();
    tapSquare('d2');
    expect(offeredSquares()).toEqual(['d3']); // one step, no double step
    tapSquare('b1');
    expect(offeredSquares()).toEqual(['a3', 'c3']);
    tapSquare('c3');
    expect(screen.getByText(/b1-c3/)).toBeTruthy();
    expect(screen.getByText('Blue to move')).toBeTruthy();
    expect(cellOf('c3').getAttribute('aria-label')).toContain('Red knight');
    expect(cellOf('b1').getAttribute('aria-label')).toBe('b1');
  });

  it('a capture shows its points at the seat that scored - the engine\'s figure, +1 for a pawn - and the card\'s score goes up by it; the +N goes away by itself', () => {
    renderGame();
    for (const [from, to] of [['d2', 'd3'], ['b5', 'c5'], ['e7', 'e6'], ['g4', 'f4'], ['d3', 'd4']]) tapMove(from, to, 0);
    expect(screen.queryByTestId('gain-1')).toBeNull(); // nothing has been captured yet
    tapMove('c5', 'd4'); // Blue's pawn takes Red's
    let reference = initialState(CHATURAJI_RULES); // the reference: the same six moves on the bare engine
    for (const text of ['d2-d3', 'b5-c5', 'e7-e6', 'g4-f4', 'd3-d4', 'c5xd4']) reference = playMove(reference, findMove(reference, text), () => 0).state;
    expect(reference.score).toEqual([0, 1, 0, 0]);
    expect(screen.getByTestId('gain-1').textContent).toBe(`+${reference.score[1]}`);
    expect(seatCard(1).textContent).toContain('1'); // Blue's card: score 1
    expect(screen.queryByTestId('gain-0')).toBeNull();
    expect(cellOf('d4').getAttribute('aria-label')).toContain('Blue pawn');
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.queryByTestId('gain-1')).toBeNull();
    expect(seatCard(1).textContent).toContain('1'); // the score stays, the indicator leaves
  });

  it('a king capture shows +3 and the army goes grey at once: its pieces say "eliminated", its card says "out"', () => {
    const start = cp(['rK@a1', 'rR@d4', 'bK@d8', 'bP@b5', 'yK@h8', 'gK@h1'], { turn: RED });
    renderGame({ startFrom: start });
    tapMove('d4', 'd8');
    expect(screen.getByTestId('gain-0').textContent).toBe('+3');
    expect(cellOf('b5').getAttribute('aria-label')).toContain('eliminated Blue pawn');
    expect(seatCard(1).textContent).toContain('out');
    expect(screen.getByText(/Blue's king was captured by Red/)).toBeTruthy();
  });

  it('a check fork shows its points too (+1 for two kings), at the seat of the moved piece', () => {
    const start = cp(['rK@a1', 'rN@c5', 'bK@d6', 'yK@f6', 'gK@h1'], { turn: RED });
    renderGame({ startFrom: start });
    tapMove('c5', 'e4');
    expect(screen.getByTestId('gain-0').textContent).toBe('+1');
    expect(screen.getByText(/attacks 2 kings at once \(\+1\)/)).toBeTruthy();
  });

  it('a pawn that reaches the far rank becomes a boat by itself - nobody is asked - with a visible marker on the square', () => {
    const start = cp([...KINGS, 'rP@c7'], { turn: RED });
    renderGame({ startFrom: start });
    tapSquare('c7');
    expect(offeredSquares()).toEqual(['c8']);
    tapSquare('c8');
    expect(screen.queryByText('Queen')).toBeNull(); // no picker
    expect(screen.queryByLabelText('Rook')).toBeNull();
    expect(screen.getByText(/c7-c8=R/)).toBeTruthy();
    const label = cellOf('c8').getAttribute('aria-label') ?? '';
    expect(label).toContain('Red boat');
    expect(label).toContain('just promoted');
    expect(screen.getByTestId('promotion-burst')).toBeTruthy();
    tapMove('a8', 'a7'); // Blue plays on: the marker does not come back for an ordinary move
    expect(screen.queryByTestId('promotion-burst')).toBeNull();
  });

  it('an eliminated army and a walking king are told apart: grey pieces for both, "out" or "king walking" on the card, and the walking king is still a king on the board', () => {
    const start = cp([...KINGS, 'rP@a2', 'bP@b5', 'yP@e7'], { turn: RED, status: ['active', 'dead-king', 'frozen', 'active'] });
    renderGame({ startFrom: start });
    expect(seatCard(1).textContent).toContain('king walking');
    expect(seatCard(2).textContent).toContain('out');
    expect(seatCard(0).textContent).not.toMatch(/out|walking/);
    expect(cellOf('b5').getAttribute('aria-label')).toContain('eliminated Blue pawn');
    expect(cellOf('a8').getAttribute('aria-label')).toContain('eliminated Blue king'); // the walking king is grey as well
    expect(cellOf('e7').getAttribute('aria-label')).toContain('eliminated Yellow pawn');
    expect(cellOf('a2').getAttribute('aria-label')).not.toContain('eliminated');
  });

  it('an attacked king is announced, never forced: the pill and the amber ring show, the other moves stay on offer, and a move that ignores it is played', () => {
    const start = cp(['rK@d1', 'rP@a2', 'rR@a4', 'bR@d8', 'bK@b7', 'yK@h8', 'gK@h1'], { turn: RED }); // only Red's king is attacked (Blue's is off Red's lines)
    renderGame({ startFrom: start });
    expect(screen.getByTestId('king-attacked-pill').textContent).toMatch(/Red: your king is attacked — it can be captured/);
    expect(within(cellOf('d1')).getByTestId('king-attacked')).toBeTruthy(); // the amber ring on d1 (Yellow's king on h8 is attacked by Blue's boat as well, so it has one too)
    expect(within(cellOf('h8')).getByTestId('king-attacked')).toBeTruthy();
    expect(cellOf('d1').getAttribute('aria-label')).toContain('king attacked');
    expect(seatCard(0).textContent).toContain('king attacked');
    tapSquare('a2');
    expect(offeredSquares()).toEqual(['a3']); // not restricted to moves that save the king
    tapSquare('a3');
    expect(screen.getByText(/a2-a3/)).toBeTruthy(); // played; nothing said "you must" or "illegal"
    expect(screen.queryByText(/must|illegal|get out of check/i)).toBeNull();
    expect(screen.queryByTestId('king-attacked-pill')).toBeNull(); // Blue is to move and its king is not attacked
  });

  it('the game-over table is the engine\'s final score, with the +3 per surviving king explained, and Rematch / Back to menu', () => {
    const start = cp(['rK@a1', 'rR@d4', 'bK@a8', 'yK@h8', 'gK@d8'], { turn: RED, status: ['active', 'dead-king', 'dead-king', 'active'], score: [2, 0, 0, 1] });
    const onExit = vi.fn();
    renderGame({ startFrom: start, onExit });
    const expected = playMove(start, findMove(start, 'd4xd8'), () => 0).state;
    expect(expected.score).toEqual([11, 0, 0, 1]);
    tapMove('d4', 'd8');
    expect(screen.getByText('Game over — Red wins')).toBeTruthy();
    expect(screen.getByTestId('result-card')).toBeTruthy();
    expect(screen.getByTestId('result-score-0').textContent).toBe(String(expected.score[0]));
    expect(screen.getByTestId('result-score-3').textContent).toBe(String(expected.score[3]));
    expect(screen.getByTestId('result-detail-0').textContent).toBe('11 points — 5 from play + 6 for 2 kings left');
    expect(screen.queryByTestId('result-detail-3')).toBeNull(); // only the seat that was paid the bonus has a breakdown
    expect(screen.getByText(/Three players eliminated/)).toBeTruthy();
    expect(within(screen.getByTestId('new-game')).getByText('Rematch')).toBeTruthy();
    fireEvent.click(screen.getByTestId('back-to-menu'));
    expect(onExit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('new-game')); // a rematch starts from the real start position
    expect(screen.queryByTestId('result-card')).toBeNull();
    expect(cellOf('a1').getAttribute('aria-label')).toContain('Red boat');
    expect(screen.getByText('Red to move')).toBeTruthy();
  });

  it('the last seat standing can lose: the table puts the highest score first, not the survivor', () => {
    const start = cp(['rK@a1', 'rR@d4', 'gK@d8'], { turn: RED, status: ['active', 'frozen', 'frozen', 'active'], score: [0, 0, 0, 20] });
    renderGame({ startFrom: start });
    tapMove('d4', 'd8');
    expect(screen.getByText('Game over — Green wins')).toBeTruthy();
    const rows = screen.getByTestId('result-card').textContent ?? '';
    expect(rows.indexOf('Green')).toBeLessThan(rows.indexOf('Red'));
  });

  // The bots below are 400-ELO ones, which pick RANDOM moves from Math.random (the app's own default stream, `rng = Math.random`): the stream is seeded here, so the bots' moves - and
  // therefore the page this test leaves behind - are the same on every run (before this the page differed between two identical runs, although the test always passed).
  const premoveGame = () => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(11));
    const start = cp([...KINGS, 'rP@c7', 'bP@b5'], { turn: 1 });
    renderGame({ startFrom: start, seats: [{ kind: 'human' }, { kind: 'bot', elo: 400 }, { kind: 'bot', elo: 400 }, { kind: 'bot', elo: 400 }] });
    tapMove('c7', 'c8'); // not Red's turn: a premove, with no piece chosen
    expect(screen.getByText(/Premove queued: c7-c8=R/)).toBeTruthy();
    for (let i = 0; i < 8 && !(maybeCellOf('c8')?.getAttribute('aria-label') ?? '').includes('Red boat'); i++) {
      act(() => {
        vi.advanceTimersByTime(600);
      });
    }
    expect(cellOf('c8').getAttribute('aria-label')).toContain('Red boat');
    expect(screen.queryByText(/Premove queued/)).toBeNull();
  };

  it('a premove queued while the bots move is played when the turn comes back, and its pawn promotes to a boat without asking', () => {
    premoveGame();
  });

  it('the screen adds no randomness of its own to what the bots decide: one seed leaves one page behind, and the page does depend on the seed', () => {
    const start = cp([...KINGS, 'rP@c7', 'bP@b5'], { turn: 1 });
    const seats: SeatConfig = [{ kind: 'human' }, { kind: 'bot', elo: 400 }, { kind: 'bot', elo: 400 }, { kind: 'bot', elo: 400 }];
    const pageAfterBots = (seed: number) => {
      vi.spyOn(Math, 'random').mockImplementation(seededRandom(seed));
      const view = renderGame({ startFrom: start, seats });
      act(() => {
        vi.advanceTimersByTime(1800); // three bot turns
      });
      const page = `${view.container.innerHTML}\n${view.container.textContent}`;
      view.unmount();
      vi.restoreAllMocks();
      return page;
    };
    const first = pageAfterBots(11);
    expect(pageAfterBots(11)).toBe(first);
    expect(pageAfterBots(12)).not.toBe(first); // a check that cannot fail proves nothing
  });

  it('a mixed human / bot table plays to the end with a seeded rng: the human resigns, three bots finish, and the table is the engine\'s own result of the same game', () => {
    const seats: SeatConfig = [{ kind: 'human' }, { kind: 'bot', elo: 1500 }, { kind: 'bot', elo: 1200 }, { kind: 'bot', elo: 1500 }];
    // a sparse middle game (so it ends in a few dozen plies): every rival's king is within reach of somebody's piece
    const start = cp(['rK@a1', 'rP@a2', 'bK@a8', 'bR@d4', 'yK@h8', 'yN@e5', 'gK@h1', 'gB@c6'], { turn: RED });
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(7));
    renderGame({ seats, startFrom: start });
    fireEvent.click(screen.getByText('Resign'));
    fireEvent.click(screen.getAllByText('Resign').at(-1)!); // the dialog's button (the control bar's is the first)
    for (let i = 0; i < 4000 && !screen.queryByTestId('result-card'); i++) {
      act(() => {
        vi.advanceTimersByTime(500);
      });
    }
    expect(screen.getByTestId('result-card')).toBeTruthy();
    expect(screen.getByText(/Game over —/)).toBeTruthy();
    // the reference: the same game on the bare engine with the same random stream, in the same order the screen draws from it
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(7));
    let ref = resign(start, RED).state;
    while (!ref.result) {
      const seat = ref.turn;
      const controller = seats[seat];
      const move = chooseBotMoveFor(ref, controller.kind === 'bot' ? controller.elo : 1200);
      if (!move) throw new Error('a bot had no move mid-game');
      ref = playMove(ref, move).state;
    }
    for (const seat of [0, 1, 2, 3]) {
      expect(screen.getByTestId(`result-score-${seat}`).textContent, `seat ${seat}`).toBe(String(ref.score[seat]));
      expect(seatCard(seat).textContent, `seat ${seat}`).toContain(String(ref.score[seat]));
    }
    expect(screen.getByText(ref.result!.winners.length > 1 ? /tie/ : new RegExp(`Game over — ${['Red', 'Blue', 'Yellow', 'Green'][ref.result!.winners[0]]} wins`))).toBeTruthy();
    expect(maybeCellOf('a1')).not.toBeNull();
  });

  it('the Rules button opens the sheet over the game, and the game is where it was when it closes', () => {
    renderGame();
    tapMove('d2', 'd3');
    fireEvent.click(screen.getByText('Rules'));
    expect(screen.getByText('How to play Chaturaji')).toBeTruthy();
    fireEvent.click(screen.getByTestId('rules-close'));
    expect(screen.queryByText('How to play Chaturaji')).toBeNull();
    expect(cellOf('d3').getAttribute('aria-label')).toContain('Red pawn');
  });

  it('4 Player Chess and Giveaway screens are unchanged: no Rules button, no boats, the cross board', () => {
    render(<FourPlayerGameScreen variant="ffa" seats={HUMANS} timeControl={NO_CLOCK} onExit={() => {}} />);
    expect(screen.queryByText('Rules')).toBeNull();
    expect(screen.queryAllByTestId('boat')).toHaveLength(0);
    expect(screen.getByLabelText('4 Player Chess board')).toBeTruthy();
    expect(CHATURAJI_RULES.options?.board).toBe('square8');
  });
});
