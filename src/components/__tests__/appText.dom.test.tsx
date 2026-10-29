import { render, screen } from '@testing-library/react';
import { StyleSheet, View } from 'react-native';
import { afterEach, describe, expect, it } from 'vitest';
import { setBundledFontsUsable } from '../../logic/typography';
import { declaredStyle } from '../../test/domKit';
import { Pressable } from '../AppPressable';
import { DenseText, Text } from '../AppText';

/**
 * AppText / AppPressable rendered (jsdom + react-native-web): what every screen's text and button now go through. What the browser matrix proves at 720 combinations, these
 * pin one by one: the family per weight, the line height, the emulated font scale and its cap, nesting, and the 44 dp floor.
 */
const style = (el: HTMLElement) => {
  const d = declaredStyle(el);
  return { fontFamily: d['font-family'] ?? '', fontWeight: d['font-weight'] ?? '', fontSize: d['font-size'] ?? '', lineHeight: d['line-height'] ?? '', overflowWrap: d['overflow-wrap'] ?? '', minHeight: d['min-height'] ?? '', minWidth: d['min-width'] ?? '' };
};
const g = globalThis as unknown as { __DEV__?: boolean; __EM_TEXT_SCALE__?: number };

afterEach(() => {
  setBundledFontsUsable(false);
  delete g.__DEV__;
  delete g.__EM_TEXT_SCALE__;
});

describe('AppText', () => {
  it('draws with the family of its weight when the bundled fonts are loaded, and resets the weight', () => {
    setBundledFontsUsable(true);
    render(<Text style={{ fontSize: 16, fontWeight: '700' }}>Bold words</Text>);
    expect(style(screen.getByText('Bold words')).fontFamily).toContain('Inter-Bold');
    expect(style(screen.getByText('Bold words')).fontWeight).toBe('normal');
  });

  it('keeps the system font when they are not', () => {
    render(<Text style={{ fontSize: 16, fontWeight: '700' }}>Plain words</Text>);
    expect(style(screen.getByText('Plain words')).fontFamily).not.toContain('Inter');
  });

  it('never has a line shorter than 1.25 x its size, and gives 1.3 x when none is named', () => {
    render(
      <>
        <Text style={{ fontSize: 20 }}>none</Text>
        <Text style={{ fontSize: 16, lineHeight: 16 }}>tight</Text>
        <Text style={{ fontSize: 16, lineHeight: 30 }}>roomy</Text>
      </>,
    );
    expect(style(screen.getByText('none')).lineHeight).toBe('26px');
    expect(style(screen.getByText('tight')).lineHeight).toBe('20px');
    expect(style(screen.getByText('roomy')).lineHeight).toBe('30px');
  });

  it('text nested in another Text inherits its line height and size', () => {
    render(
      <Text style={{ fontSize: 20 }}>
        outer <Text testID="inner">inner</Text>
      </Text>,
    );
    expect(style(screen.getByTestId('inner')).lineHeight).not.toBe('26px');
  });

  it('follows the emulated font scale in a development build, up to the cap (body 1.5, dense 1.2)', () => {
    g.__DEV__ = true;
    g.__EM_TEXT_SCALE__ = 2;
    render(
      <>
        <Text style={{ fontSize: 10 }}>body</Text>
        <DenseText style={{ fontSize: 10 }}>dense</DenseText>
        <Text style={{ fontSize: 10 }} maxFontSizeMultiplier={1}>
          fixed
        </Text>
      </>,
    );
    expect(style(screen.getByText('body')).fontSize).toBe('15px');
    expect(style(screen.getByText('dense')).fontSize).toBe('12px');
    expect(style(screen.getByText('fixed')).fontSize).toBe('10px');
    g.__EM_TEXT_SCALE__ = 1.3;
    render(<Text style={{ fontSize: 10 }}>mid</Text>);
    expect(style(screen.getByText('mid')).fontSize).toBe('13px');
  });

  it('ignores the emulated scale outside a development build (a release build cannot be resized from the page)', () => {
    g.__DEV__ = false;
    g.__EM_TEXT_SCALE__ = 2;
    render(<Text style={{ fontSize: 10 }}>release</Text>);
    expect(style(screen.getByText('release')).fontSize).toBe('10px');
  });

  it('breaks a word wider than its box inside the word (web)', () => {
    render(<Text>wordwordword</Text>);
    expect(style(screen.getByText('wordwordword')).overflowWrap).toBe('anywhere');
  });
});

describe('AppPressable', () => {
  const sheet = StyleSheet.create({ small: { width: 20, height: 20 }, own: { minHeight: 60 } });

  it('is at least 44 x 44 dp however small its style is', () => {
    render(
      <Pressable testID="p" style={sheet.small}>
        <View />
      </Pressable>,
    );
    expect(style(screen.getByTestId('p')).minHeight).toBe('44px');
    expect(style(screen.getByTestId('p')).minWidth).toBe('44px');
  });

  it('lets a style that sets its own minimum win, and supports the function form', () => {
    render(
      <>
        <Pressable testID="own" style={sheet.own}>
          <View />
        </Pressable>
        <Pressable testID="fn" style={() => sheet.small}>
          <View />
        </Pressable>
      </>,
    );
    expect(style(screen.getByTestId('own')).minHeight).toBe('60px');
    expect(style(screen.getByTestId('fn')).minHeight).toBe('44px');
  });

  it('`compact` opts out, visibly (data-matrix-exempt)', () => {
    render(
      <>
        <Pressable testID="c" compact style={sheet.small}>
          <View />
        </Pressable>
        <Pressable testID="n" style={sheet.small}>
          <View />
        </Pressable>
      </>,
    );
    expect(screen.getByTestId('c').getAttribute('data-matrix-exempt')).toBe('1');
    expect(screen.getByTestId('n').getAttribute('data-matrix-exempt')).toBeNull();
    expect(style(screen.getByTestId('c')).minHeight).not.toBe('44px');
  });
});
