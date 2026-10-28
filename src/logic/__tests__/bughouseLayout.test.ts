import { describe, expect, it } from 'vitest';
import {
  BUGHOUSE_SETUP_PRESETS,
  BUGHOUSE_TIME_CONTROL_IDS,
  bughouseSetupGate,
  bughouseTimeControlOf,
  deriveBughouseLayout,
  getBughouseDualCellSize,
  getBughouseMainCellSize,
  getBughouseSideCellSize,
  humanBughouseSeats,
  presetOfConfig,
  presetSeatConfig,
  seatRowLabel,
  standardArrangement,
} from '../bughouseLayout';
import { bughouseControlLabel, bughouseRulesSheet } from '../bughouseRulesSheet';
import { BUGHOUSE_TIME_CONTROLS } from '../bughouse';
import type { SeatConfig, SeatController } from '../fourPlayer/setup';
import type { BughouseSeat } from '../bughouse/types';

/**
 * BUGHOUSE W3a - the pure layout logic: seat rows and presets, the layout that follows from where the humans sit (a table over ALL 16 human / bot patterns), the cell sizes and the
 * size gate at the exact boundaries of BUGHOUSE_SPEC.md 5.6. Every number is a LITERAL (a test that reads the constant from the module under mutation cannot kill a mutant of it).
 */
const H: SeatController = { kind: 'human' };
const B: SeatController = { kind: 'bot', elo: 1200 };
const cfg = (a: string): SeatConfig => [a[0] === 'H' ? H : B, a[1] === 'H' ? H : B, a[2] === 'H' ? H : B, a[3] === 'H' ? H : B];

describe('the setup rows and presets', () => {
  it('the four rows are labelled Board / colour / team in seat order, with the team shape', () => {
    expect([0, 1, 2, 3].map((s) => seatRowLabel(s as BughouseSeat).text)).toEqual(['Board A · White · Team 1', 'Board A · Black · Team 2', 'Board B · White · Team 2', 'Board B · Black · Team 1']);
    expect([0, 1, 2, 3].map((s) => seatRowLabel(s as BughouseSeat).shape)).toEqual(['◆', '●', '●', '◆']);
    expect(seatRowLabel(2)).toEqual({ seat: 2, board: 'B', color: 'White', team: 2, text: 'Board B · White · Team 2', shape: '●' });
  });

  it('the four presets: You + 3 bots, 2 opponents, 2 teammates, 4 players', () => {
    expect(BUGHOUSE_SETUP_PRESETS.map((p) => [p.id, p.label, [...p.humans]])).toEqual([
      ['solo', 'You + 3 bots', [0]],
      ['opponents', '2 opponents', [0, 1]],
      ['teammates', '2 teammates', [0, 3]],
      ['four', '4 players', [0, 1, 2, 3]],
    ]);
    expect(presetSeatConfig('solo', 800)).toEqual([H, { kind: 'bot', elo: 800 }, { kind: 'bot', elo: 800 }, { kind: 'bot', elo: 800 }]);
    expect(presetSeatConfig('opponents')).toEqual([H, H, B, B]);
    expect(presetSeatConfig('teammates')).toEqual([H, B, B, H]);
    expect(presetSeatConfig('four')).toEqual([H, H, H, H]);
    expect(() => presetSeatConfig('nope' as never)).toThrow(RangeError); // not the TypeError that reading a missing preset would give
    expect(() => presetSeatConfig('nope' as never)).toThrow('unknown preset nope');
  });

  it('a config is recognised as its preset whatever the bots\' ELO, and a custom mix is no preset', () => {
    expect(presetOfConfig([H, { kind: 'bot', elo: 2500 }, { kind: 'bot', elo: 400 }, { kind: 'bot', elo: 1700 }])).toBe('solo');
    expect(presetOfConfig(cfg('HHBB'))).toBe('opponents');
    expect(presetOfConfig(cfg('HBBH'))).toBe('teammates');
    expect(presetOfConfig(cfg('HHHH'))).toBe('four');
    expect(presetOfConfig(cfg('BHBB'))).toBeNull();
    expect(presetOfConfig(cfg('BBBB'))).toBeNull();
    expect(humanBughouseSeats(cfg('HBHB'))).toEqual([0, 2]);
  });
});

describe('the layout follows from where the humans sit (all 16 patterns)', () => {
  // seat order: A White, A Black, B White, B Black.   N = none, S<seat> = standard, P<board> = pass-and-play, D = dual
  const TABLE: Record<string, string> = {
    BBBB: 'N',
    HBBB: 'S0',
    BHBB: 'S1',
    BBHB: 'S2',
    BBBH: 'S3',
    HHBB: 'PA',
    BBHH: 'PB',
    HBHB: 'D',
    HBBH: 'D',
    BHHB: 'D',
    BHBH: 'D',
    HHHB: 'D',
    HHBH: 'D',
    HBHH: 'D',
    BHHH: 'D',
    HHHH: 'D',
  };
  const code = (a: string): string => {
    const layout = deriveBughouseLayout(cfg(a));
    if (layout.kind === 'none') return 'N';
    if (layout.kind === 'standard') return `S${layout.seat}`;
    if (layout.kind === 'passAndPlay') return `P${layout.board}`;
    return 'D';
  };
  it('matches the table for every pattern', () => {
    expect(Object.keys(TABLE).length).toBe(16);
    for (const [pattern, expected] of Object.entries(TABLE)) expect(code(pattern), pattern).toBe(expected);
  });
});

describe('the dual-board cell size (BUGHOUSE_SPEC.md 5.6 table)', () => {
  const rows: [number, number, number, number, 'stacked' | 'sideBySide', boolean][] = [
    // w, h, stacked, side by side, winner, fits (>= 28)
    [360, 640, 22, 21, 'stacked', false],
    [375, 667, 23, 21, 'stacked', false],
    [360, 740, 28, 21, 'stacked', true],
    [360, 800, 32, 21, 'stacked', true],
    [390, 844, 34, 22, 'stacked', true],
    [412, 915, 39, 24, 'stacked', true],
    [800, 360, 4, 29, 'sideBySide', true],
    [568, 320, 2, 24, 'sideBySide', false],
    [768, 1024, 46, 46, 'sideBySide', true], // a tie: side by side from 700 px wide
    [1024, 768, 30, 62, 'sideBySide', true],
    [700, 2000, 85, 42, 'stacked', true], // wide AND tall: stacked is still the larger cell
  ];
  it.each(rows)('%i x %i: stacked %i, side by side %i -> %s (fits: %s)', (w, h, stacked, side, winner, fits) => {
    const fit = getBughouseDualCellSize(w, h);
    expect(fit.stacked).toBe(stacked);
    expect(fit.sideBySide).toBe(side);
    expect(fit.arrangement).toBe(winner);
    expect(fit.cell).toBe(winner === 'stacked' ? stacked : side);
    expect(fit.fits).toBe(fits);
  });

  it('a tie goes to stacked below 700 px wide and to side by side from 700 px', () => {
    // constructed ties: 664 x 928 is 40 | 40, 700 x 960 and 699 x 960 are 42 | 42
    expect(getBughouseDualCellSize(664, 928)).toMatchObject({ stacked: 40, sideBySide: 40, arrangement: 'stacked' });
    expect(getBughouseDualCellSize(700, 960)).toMatchObject({ stacked: 42, sideBySide: 42, arrangement: 'sideBySide' });
    expect(getBughouseDualCellSize(699, 960)).toMatchObject({ stacked: 42, sideBySide: 42, arrangement: 'stacked' });
  });

  it('the minimum is exactly 28 px: 240 x 736 portrait and 472 x 352 landscape fit, one pixel less does not', () => {
    expect(getBughouseDualCellSize(240, 736)).toMatchObject({ cell: 28, arrangement: 'stacked', fits: true });
    expect(getBughouseDualCellSize(240, 735)).toMatchObject({ cell: 27, fits: false });
    expect(getBughouseDualCellSize(239, 736)).toMatchObject({ cell: 27, fits: false });
    expect(getBughouseDualCellSize(472, 352)).toMatchObject({ cell: 28, arrangement: 'sideBySide', fits: true });
    expect(getBughouseDualCellSize(472, 351)).toMatchObject({ cell: 27, fits: false });
    expect(getBughouseDualCellSize(471, 352)).toMatchObject({ cell: 27, fits: false });
  });
});

describe('the setup gate', () => {
  const SIZE_MESSAGE = 'This seat setup needs a larger screen. Turn the device to landscape, or put every human on one board.';
  it('no human cannot start', () => {
    expect(bughouseSetupGate(cfg('BBBB'), 412, 915)).toEqual({ startable: false, reason: 'noHuman', message: 'At least one seat must be a human.' });
  });

  it('one human and humans on ONE board start in any window, even a tiny one', () => {
    for (const [w, h] of [[360, 640], [100, 100], [412, 915]]) {
      for (const pattern of ['HBBB', 'BBBH', 'HHBB', 'BBHH']) expect(bughouseSetupGate(cfg(pattern), w, h), `${pattern} ${w}x${h}`).toEqual({ startable: true });
    }
  });

  it('humans on both boards are refused with the spec\'s sentence below the minimum, evaluated against the window', () => {
    for (const pattern of ['HBBH', 'HBHB', 'HHHH', 'BHHB']) {
      const gate = bughouseSetupGate(cfg(pattern), 360, 640);
      expect(gate, pattern).toEqual({ startable: false, reason: 'tooSmall', message: SIZE_MESSAGE });
    }
    // rotating the phone changes the answer at once: a small phone in landscape (568 x 320) is refused too, a larger one (800 x 360) fits
    expect(bughouseSetupGate(cfg('HBBH'), 568, 320)).toMatchObject({ reason: 'tooSmall' });
    expect(bughouseSetupGate(cfg('HBBH'), 800, 360)).toEqual({ startable: true }); // W3b: humans on both boards play when two boards of 28 px fit
  });

  it('...and at the exact boundaries: 240 x 736 and 472 x 352 are big enough (the setup starts), one pixel less is "too small"', () => {
    expect(bughouseSetupGate(cfg('HBBH'), 240, 736)).toEqual({ startable: true });
    expect(bughouseSetupGate(cfg('HBBH'), 240, 735)).toMatchObject({ reason: 'tooSmall' });
    expect(bughouseSetupGate(cfg('HBBH'), 239, 736)).toMatchObject({ reason: 'tooSmall' });
    expect(bughouseSetupGate(cfg('HBBH'), 472, 352)).toEqual({ startable: true });
    expect(bughouseSetupGate(cfg('HBBH'), 472, 351)).toMatchObject({ reason: 'tooSmall' });
    expect(bughouseSetupGate(cfg('HBBH'), 471, 352)).toMatchObject({ reason: 'tooSmall' });
  });
});

describe('the cell sizes of the standard layouts', () => {
  it('the large board: 36 px at 360 x 640, 49 px at 412 x 915, clamped to 28..52', () => {
    expect(getBughouseMainCellSize(360, 640)).toBe(36);
    expect(getBughouseMainCellSize(360, 639)).toBe(35); // one pixel less height: the chrome is exactly 352
    expect(getBughouseMainCellSize(360, 648)).toBe(37);
    expect(getBughouseMainCellSize(360, 647)).toBe(36);
    expect(getBughouseMainCellSize(412, 915)).toBe(49);
    expect(getBughouseMainCellSize(390, 844)).toBe(46); // width-bound: floor(374 / 8) = 46 against floor(492 / 8) = 61
    expect(getBughouseMainCellSize(1000, 2000)).toBe(52);
    expect(getBughouseMainCellSize(200, 300)).toBe(28);
    expect(getBughouseMainCellSize(360, 700)).toBe(43); // height 348 / 8 = 43.5 -> 43, width 43
    expect(getBughouseMainCellSize(360, 760)).toBe(43); // width-bound: (360 - 16) / 8 = 43
  });

  it('portrait phones get the thumbnail layout, landscape and tablets two equal boards', () => {
    expect(standardArrangement(360, 640)).toBe('thumbnail');
    expect(standardArrangement(412, 915)).toBe('thumbnail');
    expect(standardArrangement(800, 360)).toBe('sideBySide');
    expect(standardArrangement(768, 1024)).toBe('sideBySide');
    expect(standardArrangement(699, 1000)).toBe('thumbnail');
    expect(standardArrangement(700, 1000)).toBe('sideBySide');
    expect(standardArrangement(500, 499)).toBe('sideBySide');
    expect(standardArrangement(500, 500)).toBe('thumbnail');
  });

  it('two equal boards side by side: 29 px at 800 x 360, up to 62, never below 20', () => {
    expect(getBughouseSideCellSize(800, 360)).toBe(29);
    expect(getBughouseSideCellSize(1024, 768)).toBe(62);
    expect(getBughouseSideCellSize(3000, 3000)).toBe(62);
    expect(getBughouseSideCellSize(300, 200)).toBe(20);
  });
});

describe('time controls and the rules sheet', () => {
  it('the six controls, and the presets that stand for them', () => {
    expect([...BUGHOUSE_TIME_CONTROL_IDS]).toEqual(['bullet-1', 'bullet-2-1', 'blitz-3', 'blitz-3-2', 'blitz-5', 'blitz-5-2']);
    expect(bughouseTimeControlOf({ initialSeconds: 120, incrementSeconds: 1 })).toEqual({ initialMs: 120000, incrementMs: 1000 });
    expect(BUGHOUSE_TIME_CONTROLS.map(bughouseControlLabel)).toEqual(['1 min', '2 | 1', '3 min', '3 | 2', '5 min', '5 | 2']);
  });

  it('the sheet says what the engine does: the six controls, no draws, no pawn drop on the 1st or 8th rank, the five pocket pieces', () => {
    const text = bughouseRulesSheet()
      .map((s) => `${s.title}\n${s.lines.join('\n')}`)
      .join('\n');
    expect(bughouseRulesSheet().map((s) => s.title)).toEqual(['The idea', 'Captures feed your partner', 'Drops', 'Waiting', 'Clocks and the end']);
    expect(text).toContain('Time controls: 1 min, 2 | 1, 3 min, 3 | 2, 5 min, 5 | 2.');
    expect(text).toContain('There are no draws in Bughouse.');
    expect(text).toContain('never be dropped on the 1st or 8th rank');
    expect(text).toContain('pawn, knight, bishop, rook, queen');
    expect(text).toContain('Team 1 is Board A White and Board B Black');
  });
});
