import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import PieceIcon from '../../components/PieceIcon';
import { piecePathPaint, pieceInk, PIECE_SHAPE_TYPES, type PieceInk } from '../../components/pieceArt';

/**
 * THE VECTOR PIECE'S PAINT (command #27d). A phone drew black Classic pieces with a light fill on the dark squares only. Nothing in the code can do that (the icon has no square input),
 * and that is what this file pins: every paint property of every path is written out (fill, fill opacity, fill rule, stroke, stroke opacity, width, join, cap), they are the same literals for
 * every kind, they depend on the piece's COLOUR alone, and a piece drawn "on a light square" and "on a dark square" renders byte-identical markup. The test FAILS if a fill is ever derived from
 * a square: it renders each piece in front of both of the active board theme's colours and compares, and it scans the drawing modules for a board-colour import.
 * Every expectation is a LITERAL.
 */
const WHITE_PAINT = { fill: '#fafafa', fillOpacity: 1, fillRule: 'nonzero', stroke: '#1b1b1b', strokeLinecap: 'round', strokeLinejoin: 'round', strokeOpacity: 1, strokeWidth: 3 };
const BLACK_PAINT = { fill: '#1d1d1d', fillOpacity: 1, fillRule: 'nonzero', stroke: '#666666', strokeLinecap: 'round', strokeLinejoin: 'round', strokeOpacity: 1, strokeWidth: 3 };
const LIGHT_SQUARE = '#eeeed2';
const DARK_SQUARE = '#1e4d78';

const paints = (container: HTMLElement) => Array.from(container.querySelectorAll('[data-svg="Path"]')).map((node) => JSON.parse(node.getAttribute('data-props') ?? 'null') as Record<string, unknown>);
const svgProps = (container: HTMLElement) => JSON.parse(container.querySelector('[data-svg="Svg"]')?.getAttribute('data-props') ?? 'null') as Record<string, unknown>;

describe('piecePathPaint', () => {
  it('is the full, literal paint of each colour', () => {
    expect(piecePathPaint(pieceInk('w'))).toEqual(WHITE_PAINT);
    expect(piecePathPaint(pieceInk('b'))).toEqual(BLACK_PAINT);
  });

  it('is a function of the ink only: the same ink gives the same paint, and a different fill changes only the fill', () => {
    const ink: PieceInk = { fill: '#123456', outline: '#abcdef' };
    expect(piecePathPaint(ink)).toEqual(piecePathPaint({ ...ink }));
    expect(piecePathPaint(ink)).toEqual({ ...BLACK_PAINT, fill: '#123456', stroke: '#abcdef' });
  });
});

describe.each(['w', 'b'] as const)('a %s PieceIcon, every kind', (color) => {
  const expected = color === 'w' ? WHITE_PAINT : BLACK_PAINT;

  it('gives EVERY path all eight paint props, with the colour\'s literals', () => {
    for (const type of PIECE_SHAPE_TYPES) {
      const { container, unmount } = render(<PieceIcon type={type} ink={pieceInk(color)} size={40} />);
      const drawn = paints(container);
      expect(drawn.length, type).toBeGreaterThan(0);
      for (const paint of drawn) expect(paint, `${color}${type}`).toEqual(expected);
      unmount();
    }
  });

  it('writes the svg\'s own colour and opacity (nothing is inherited): color = the fill, opacity 1 unless a faded seat says otherwise', () => {
    const plain = render(<PieceIcon type="k" ink={pieceInk(color)} size={40} />);
    expect(svgProps(plain.container)).toMatchObject({ color: expected.fill, pointerEvents: 'none', viewBox: '0 0 100 100' });
    expect(plain.container.querySelector('[data-svg="Svg"]')?.getAttribute('data-opacity')).toBe('1');
    plain.unmount();
    const faded = render(<PieceIcon type="k" ink={pieceInk(color)} size={40} opacity={0.4} />);
    expect(faded.container.querySelector('[data-svg="Svg"]')?.getAttribute('data-opacity')).toBe('0.4');
  });

  it('renders the same markup whatever square it stands on: on the light and on the dark colour of a board, the piece is byte-identical (a fill derived from a square would differ)', () => {
    for (const type of PIECE_SHAPE_TYPES) {
      const markup = [LIGHT_SQUARE, DARK_SQUARE].map((square) => {
        const { container, unmount } = render(
          <div style={{ backgroundColor: square }}>
            <PieceIcon type={type} ink={pieceInk(color)} size={40} />
          </div>
        );
        const html = (container.firstChild as HTMLElement).innerHTML;
        unmount();
        return html;
      });
      expect(markup[0], `${color}${type}`).toBe(markup[1]);
      expect(markup[0], `${color}${type}`).toContain(`data-fill="${expected.fill}"`);
      expect(markup[1], `${color}${type}`).toContain(`data-stroke="${expected.stroke}"`);
    }
  });
});

describe('a black piece is never drawn with the white piece\'s paint, on any square', () => {
  it('every kind: the black fill and outline differ from the white ones in the markup itself', () => {
    for (const type of PIECE_SHAPE_TYPES) {
      const white = render(<PieceIcon type={type} ink={pieceInk('w')} size={40} />);
      const whiteHtml = white.container.innerHTML;
      white.unmount();
      const black = render(<PieceIcon type={type} ink={pieceInk('b')} size={40} />);
      const blackHtml = black.container.innerHTML;
      black.unmount();
      expect(whiteHtml, type).not.toBe(blackHtml);
      expect(blackHtml, type).not.toContain('#fafafa');
      expect(blackHtml, type).not.toContain('#1b1b1b');
      expect(whiteHtml, type).not.toContain('#1d1d1d');
      expect(whiteHtml, type).not.toContain('#666666');
      expect(blackHtml, type).not.toContain('#f1f1f1');
    }
  });
});

describe('the drawing modules know no square colour', () => {
  const root = process.cwd();
  const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

  it.each(['src/components/PieceIcon.tsx', 'src/components/pieceArt.ts'])('%s imports no board theme, square or colour-scheme module and names no square colour', (file) => {
    const source = read(file);
    expect(source).not.toMatch(/^import .*(boardThemes|themeHooks|themeSettings|colorSchemeHooks|Square)/m);
    expect(source).not.toMatch(/lightColor|darkColor|isLight|isDark|squareColor|squareColour/);
    expect(source).not.toMatch(/['"]currentColor['"]/);
  });

  it('PieceIcon\'s props are exactly type, ink, size and opacity: no square-shaped input exists', () => {
    const source = read('src/components/PieceIcon.tsx');
    const props = /interface PieceIconProps \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? '';
    expect(Array.from(props.matchAll(/^\s{2}(\w+)\??:/gm)).map((match) => match[1])).toEqual(['type', 'ink', 'size', 'opacity']);
  });
});
