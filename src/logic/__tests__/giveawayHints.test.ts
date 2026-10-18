import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { START_FEN } from '../../types/chess';
import { ChessEngine } from '../ChessEngine';
import { AVAILABLE_BOARD_THEMES } from '../boardThemes';
import {
  CAPTURER_OUTLINE_COLOR,
  CAPTURER_RING_COLOR,
  CAPTURE_BLOCKED_TEXT,
  CAPTURE_MANDATORY_TEXT,
  CAPTURE_NUDGE_MS,
  fourPlayerCapturingSquareNames,
  getGiveawayCapturingSquares,
} from '../giveawayHints';
import { FFA_RULES, GIVEAWAY_RULES, initialState, legalMoves, squareName, stateFromPieces, type PositionOptions, type Seat } from '../fourPlayer';

// Giveaway (2-player and 4 Player): when a capture is mandatory only the capturing pieces can move, which with no explanation looked like a frozen
// game. Three hints now exist on every Giveaway screen: a persistent "Capture is mandatory" status (MandatoryCaptureBanner), a ring on every piece
// that can capture, and a message when the player taps a piece that cannot move. This file pins the pure helper behind the ring and the wiring of
// all three; no rule, bot or server behaviour is touched.

const giveaway = (fen: string) => new ChessEngine(fen, { skipValidation: true, giveaway: true });

describe('2-player: which pieces can capture', () => {
  it('none when no capture exists (nothing is forced): the start position and a quiet position', () => {
    expect(getGiveawayCapturingSquares(giveaway(START_FEN))).toEqual([]);
    expect(getGiveawayCapturingSquares(giveaway('k7/8/8/8/8/8/8/K6R w - - 0 1'))).toEqual([]);
  });

  it('exactly the capturing pieces once a capture exists - after 1.e4 d5 only the e4 pawn (a pawn push is no capture)', () => {
    expect(getGiveawayCapturingSquares(giveaway('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'))).toEqual(['e4']);
  });

  it('several capturers, each piece once even when it can capture twice', () => {
    // Qd1 takes d5, the e4 pawn takes d5 or f5 (two captures, one square)
    expect([...getGiveawayCapturingSquares(giveaway('k7/8/8/3p1p2/4P3/8/8/K2Q4 w - - 0 1'))].sort()).toEqual(['d1', 'e4']);
  });

  it('works for Black to move too, and counts en passant as a capture', () => {
    expect(getGiveawayCapturingSquares(giveaway('k7/8/8/8/3pP3/8/8/K7 b - e3 0 1'))).toEqual(['d4']);
    expect(getGiveawayCapturingSquares(giveaway('rnbqkbnr/pppp1ppp/8/4P3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2'))).toEqual([]);
  });

  it('a king is an ordinary capturer in Giveaway', () => {
    expect(getGiveawayCapturingSquares(giveaway('8/8/8/8/8/8/1p6/K7 w - - 0 1'))).toEqual(['a1']);
  });
});

describe('4 Player Giveaway: which pieces can capture (incl. after an elimination)', () => {
  const KINGS = ['yK@g14', 'gK@n7'];
  const gp = (pieces: string[], options: PositionOptions = {}) => stateFromPieces(pieces, { rules: GIVEAWAY_RULES, ...options });
  const RED: Seat = 0;

  it('only the piece that can capture is reported - a quiet pawn and the parked kings are not', () => {
    const state = gp(['rR@e1', 'rP@d3', 'bN@e5', 'rK@h1', ...KINGS], { turn: RED });
    expect(fourPlayerCapturingSquareNames(state, RED)).toEqual(['e1']);
    expect(legalMoves(state, RED).every((m) => m.captured !== 0)).toBe(true); // consistent with the rule: every legal move is a capture
  });

  it('every capturer once, in a position with several', () => {
    const state = gp(['rR@e1', 'rB@g3', 'bN@e5', 'bP@e7', 'rK@h1', ...KINGS], { turn: RED });
    expect(fourPlayerCapturingSquareNames(state, RED).sort()).toEqual(['e1', 'g3']);
  });

  it('after an elimination the walls are not capturable, so they force nothing: no capturers; with the seat still active there is one', () => {
    const live = gp(['rR@e1', 'bN@e5', 'rK@h1', ...KINGS], { turn: RED });
    expect(fourPlayerCapturingSquareNames(live, RED)).toEqual(['e1']);
    const walled = gp(['rR@e1', 'bN@e5', 'rK@h1', ...KINGS], { turn: RED, status: ['active', 'frozen', 'active', 'active'] });
    expect(fourPlayerCapturingSquareNames(walled, RED)).toEqual([]);
  });

  it('a piece that can capture twice is listed once', () => {
    const state = gp(['rR@e1', 'bN@e5', 'bP@j1', 'rK@h2', ...KINGS], { turn: RED });
    expect(legalMoves(state, RED).filter((m) => squareName(m.from) === 'e1').length).toBe(2); // the rook takes e5 or j1
    expect(fourPlayerCapturingSquareNames(state, RED)).toEqual(['e1']);
  });

  it('none at the start, none for a seat with no capture, and never in 4 Player Chess', () => {
    expect(fourPlayerCapturingSquareNames(initialState(GIVEAWAY_RULES), RED)).toEqual([]);
    const state = gp(['rR@e1', 'bN@e5', 'rK@h1', ...KINGS], { turn: RED });
    expect(fourPlayerCapturingSquareNames(state, 1)).toEqual([]); // Blue's own pieces: nothing to capture
    const chess = stateFromPieces(['rR@e1', 'bN@e5', 'rK@h1', 'bK@a8', ...KINGS], { rules: FFA_RULES, turn: RED });
    expect(fourPlayerCapturingSquareNames(chess, RED)).toEqual([]);
  });
});

describe('the wording and the colours', () => {
  it('the two messages, and a nudge long enough to read but short enough not to linger', () => {
    expect(CAPTURE_MANDATORY_TEXT).toBe('Capture is mandatory');
    expect(CAPTURE_BLOCKED_TEXT).toBe('A capture is mandatory — highlighted pieces can capture');
    expect(CAPTURE_NUDGE_MS).toBeGreaterThanOrEqual(2000);
    expect(CAPTURE_NUDGE_MS).toBeLessThanOrEqual(5000);
  });

  const lum = (hex: string): number => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const mix = (over: string, alpha: number, under: string) => {
    const o = parseInt(over.slice(1), 16);
    const u = parseInt(under.slice(1), 16);
    const ch = (s: number) => Math.round(((o >> s) & 255) * alpha + ((u >> s) & 255) * (1 - alpha));
    return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
  };

  it('the banner reads on its own background in both themes (WCAG AA, 4.5:1)', () => {
    expect(contrast('#5c3b00', '#fff0c2')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffe082', '#4a3a12')).toBeGreaterThanOrEqual(4.5);
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'MandatoryCaptureBanner.tsx'), 'utf8').split('\r\n').join('\n');
    expect(src).toContain("{ backgroundColor: '#4a3a12', borderColor: '#ffb300' } : { backgroundColor: '#fff0c2', borderColor: '#e69500' }");
    expect(src).toContain("color: dark ? '#ffe082' : '#5c3b00'");
  });

  it('the long tap message stays one line on a 360 px phone and the pill keeps its height when it swaps (the 4 Player screen has no spare height)', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'components', 'MandatoryCaptureBanner.tsx'), 'utf8').split('\r\n').join('\n');
    expect(src).toContain("nudgedText: {\n    fontSize: 11,\n  },");
    expect(src).toContain('lineHeight: 18,'); // explicit, in the base text style shared by both states
    expect(src).toContain('nudged && styles.nudgedText');
    // ~55 chars of bold text at 11 px (about 5.6 px each) plus the pill's 12 px padding and borders fits 360 - 2 * 6 margin
    expect(CAPTURE_BLOCKED_TEXT.length * 5.6 + 12 + 3).toBeLessThanOrEqual(360 - 12);
  });

  it('the ring is visible on EVERY board theme: its dark outline has >= 3:1 against both squares of every theme', () => {
    expect(CAPTURER_RING_COLOR).toBe('#ff9800');
    const alpha = Number(/rgba\(0,0,0,([0-9.]+)\)/.exec(CAPTURER_OUTLINE_COLOR)![1]);
    expect(AVAILABLE_BOARD_THEMES.length).toBeGreaterThanOrEqual(5);
    for (const theme of AVAILABLE_BOARD_THEMES) {
      for (const square of [theme.lightColor, theme.darkColor]) {
        expect(contrast(mix('#000000', alpha, square), square)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('wired on every Giveaway screen', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8').split('\r\n').join('\n');

  it.each([
    ['LocalGameScreen', 'mustCapture && !isReviewing', 'lead={`${turnLabel} to move`}'],
    ['BotGameScreen', 'mustCapture && turn === userColor && !isReviewing', 'lead="Your turn"'],
    ['OnlineGameScreen', "mustCapture && connectionState === 'connected' && !isReviewing", 'lead="Your turn"'],
    ['FourPlayerGameScreen', '!game.result && humanToMove && fourPlayerCapturingSquares(game, game.turn).length > 0', 'lead={`${mover} to move`}'],
    ['FourPlayerOnlineGameScreen', 'canMove(view, connected) && !view.gameOver && fourPlayerCapturingSquares(shown, shown.turn).length > 0 ?', 'lead="Your move"'],
  ])('%s: the bold status replaces the plain one while a capture is forced, and a blocked tap triggers the message', (screen, condition, lead) => {
    const src = read('screens', `${screen}.tsx`);
    expect(src).toContain("import MandatoryCaptureBanner from '../components/MandatoryCaptureBanner';");
    expect(src).toContain(condition);
    expect(src).toContain(`<MandatoryCaptureBanner ${lead} nudged={captureNudged} />`);
    expect(src).toContain('const { nudged: captureNudged, nudge: nudgeCapture } = useCaptureNudge();');
    expect(src).toContain('onMandatoryCaptureBlocked={nudgeCapture}');
  });

  it('4 Player Local: the banner is chosen by that very condition (mustCapture), only for a human seat', () => {
    const src = read('screens', 'FourPlayerGameScreen.tsx');
    expect(src).toContain('{mustCapture ? (\n          <MandatoryCaptureBanner');
  });

  it('the 2-player board rings the capturers and answers a tap on a piece that cannot capture', () => {
    const board = read('components', 'ChessBoard.tsx');
    expect(board).toContain('getGiveawayCapturingSquares(engine)');
    expect(board).toContain('giveaway && !disabled && !gameOver && !isPremoveMode && !pendingDuck');
    expect(board).toContain('isCapturer={captureSquares.includes(square.square)}');
    expect(board).toContain('if (captureSquares.length > 0 && !captureSquares.includes(square)) {\n        setSelectedSquare(null);\n        onMandatoryCaptureBlocked?.();');
    const square = read('components', 'Square.tsx');
    expect(square).toContain('{isCapturer && <View pointerEvents="none" style={[styles.capturerOutline');
    expect(square).toContain('{isCapturer && <View pointerEvents="none" style={[styles.capturerRing');
  });

  it('the 4 Player board rings the capturers (only on the human\'s own turn) and answers a tap on an own piece that cannot capture', () => {
    const board = read('components', 'FourPlayerBoard.tsx');
    expect(board).toContain('interactive ? new Set(fourPlayerCapturingSquares(state, state.turn)) : new Set<number>()');
    expect(board).toContain('capturer={captureSquares.has(square)}');
    expect(board).toContain('if (captureSquares.size > 0 && !captureSquares.has(square) && state.cells[square] > 0 && seatOf(state.cells[square]) === state.turn) {\n      setSelected(null);\n      onMandatoryCaptureBlocked?.();');
    expect(board).toContain("can capture (a capture is mandatory)"); // screen readers too
  });

  it('the spectator boards are non-interactive, so they show no ring and no message (nothing for a spectator to do)', () => {
    expect(read('screens', 'FourPlayerSpectatorScreen.tsx')).toContain('interactive={false}');
  });

  it('no rule, bot or server file is touched by the hints', () => {
    for (const file of [['logic', 'giveaway.ts'], ['logic', 'bots.ts'], ['logic', 'fourPlayer', 'moves.ts'], ['logic', 'fourPlayer', 'giveaway.ts']]) {
      expect(read(...file)).not.toContain('giveawayHints');
    }
  });
});
