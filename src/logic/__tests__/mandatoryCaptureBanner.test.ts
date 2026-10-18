import { describe, expect, it, vi } from 'vitest';

/**
 * MandatoryCaptureBanner rendered as a plain function (no renderer): the element tree it returns is inspected. react-native is stubbed to
 * string tags and the colour hook to a switchable mode.
 */

const theme = vi.hoisted(() => ({ mode: 'light' as 'light' | 'dark' }));

vi.mock('react-native', () => ({ StyleSheet: { create: <T>(s: T) => s }, Text: 'Text', View: 'View' }));
vi.mock('../colorSchemeHooks', () => ({ useAppColors: () => ({ mode: theme.mode }) }));

import MandatoryCaptureBanner from '../../components/MandatoryCaptureBanner';
import { CAPTURE_BLOCKED_TEXT } from '../giveawayHints';

type El = { props: Record<string, unknown> & { children?: El | string } };
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...(Array.isArray(style) ? style : [style]).filter(Boolean));
const render = (lead: string, nudged: boolean, mode: 'light' | 'dark' = 'light') => {
  theme.mode = mode;
  const pill = MandatoryCaptureBanner({ lead, nudged }) as unknown as El;
  const text = pill.props.children as El;
  return { pill, text, pillStyle: flat(pill.props.style), textStyle: flat(text.props.style), words: text.props.children as string };
};

describe('MandatoryCaptureBanner', () => {
  it('says whose turn it is and that a capture is mandatory; screen readers get it as an alert with the same words', () => {
    const { pill, words } = render('Red to move', false);
    expect(words).toBe('Red to move — Capture is mandatory');
    expect(pill.props.accessibilityRole).toBe('alert');
    expect(pill.props.accessibilityLabel).toBe(words);
    expect(pill.props.accessible).toBe(true);
  });

  it('after a blocked tap it spells out the longer message instead (and the lead is not repeated)', () => {
    const { words, pill } = render('Your turn', true);
    expect(words).toBe(CAPTURE_BLOCKED_TEXT);
    expect(pill.props.accessibilityLabel).toBe(CAPTURE_BLOCKED_TEXT);
  });

  it('amber on light, dark amber on dark - never the other way round', () => {
    expect(render('x', false, 'light').pillStyle).toMatchObject({ backgroundColor: '#fff0c2', borderColor: '#e69500' });
    expect(render('x', false, 'light').textStyle.color).toBe('#5c3b00');
    expect(render('x', false, 'dark').pillStyle).toMatchObject({ backgroundColor: '#4a3a12', borderColor: '#ffb300' });
    expect(render('x', false, 'dark').textStyle.color).toBe('#ffe082');
  });

  it('the pill is as tall in both states (same line height) and only the message gets the smaller text that fits one line on 360 px', () => {
    const quiet = render('x', false);
    const nudged = render('x', true);
    expect(quiet.textStyle.lineHeight).toBe(nudged.textStyle.lineHeight);
    expect(quiet.textStyle.fontSize).toBe(14);
    expect(nudged.textStyle.fontSize).toBe(11);
    expect(quiet.pillStyle.borderWidth).toBe(nudged.pillStyle.borderWidth);
  });
});
