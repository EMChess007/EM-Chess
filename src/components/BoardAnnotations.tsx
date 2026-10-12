import Svg, { Line, Polygon, Rect } from 'react-native-svg';

export interface GridPoint {
  row: number;
  col: number;
}

export interface BoardArrow {
  from: GridPoint;
  to: GridPoint;
}

interface BoardAnnotationsProps {
  squareSize: number;
  /** Grid size in squares. Default 8 x 8 (classic chess); the 4 Player board is 14 x 14. */
  rows?: number;
  cols?: number;
  /** Multiplies the arrow's line width, arrowhead and clearance, for boards whose squares are much smaller than classic's. Default 1. */
  scale?: number;
  arrows: BoardArrow[];
  highlights: GridPoint[];
  /** The in-progress arrow while the user is still dragging (not yet released) — drawn to the
   * raw finger position (in board pixels), not snapped to a square center, for responsive
   * visual feedback. Omit/null while no drag is in progress. */
  liveArrow?: { from: GridPoint; toX: number; toY: number } | null;
}

const ARROW_COLOR = 'rgba(21, 120, 27, 0.8)';
const HIGHLIGHT_COLOR = 'rgba(235, 97, 80, 0.55)';
const ARROWHEAD_LENGTH = 11;
const ARROWHEAD_WIDTH = 9;
// Pulls the line's start/end back from the exact square centers so it doesn't visually start/end
// underneath the piece glyph/image sitting there — purely cosmetic clearance.
const END_INSET_RATIO = 0.32;

function center(point: GridPoint, squareSize: number): { x: number; y: number } {
  return { x: point.col * squareSize + squareSize / 2, y: point.row * squareSize + squareSize / 2 };
}

/** One arrow's line + arrowhead triangle, from `from` to a raw pixel endpoint `to` (already
 * inset/positioned by the caller) — shared by both a finished arrow (square-to-square) and the
 * live in-progress preview (square-to-raw-finger-position). */
function ArrowShape({ from, to, insetStart, scale }: { from: { x: number; y: number }; to: { x: number; y: number }; insetStart: number; scale: number }) {
  const headLength = ARROWHEAD_LENGTH * scale;
  const headWidth = ARROWHEAD_WIDTH * scale;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;
  const ux = dx / length;
  const uy = dy / length;

  const startX = from.x + ux * insetStart;
  const startY = from.y + uy * insetStart;
  // The line stops short of the arrowhead's tip so the triangle isn't drawn over a thick line end.
  const lineEndX = to.x - ux * headLength;
  const lineEndY = to.y - uy * headLength;

  // Arrowhead: a triangle whose tip is `to`, base perpendicular to the line direction.
  const perpX = -uy;
  const perpY = ux;
  const baseX = to.x - ux * headLength;
  const baseY = to.y - uy * headLength;
  const points = [
    `${to.x},${to.y}`,
    `${baseX + perpX * (headWidth / 2)},${baseY + perpY * (headWidth / 2)}`,
    `${baseX - perpX * (headWidth / 2)},${baseY - perpY * (headWidth / 2)}`,
  ].join(' ');

  return (
    <>
      <Line x1={startX} y1={startY} x2={lineEndX} y2={lineEndY} stroke={ARROW_COLOR} strokeWidth={6 * scale} strokeLinecap="round" />
      <Polygon points={points} fill={ARROW_COLOR} />
    </>
  );
}

/** SVG overlay drawn on top of the board grid — highlighted squares, finished arrows, and (while
 * dragging) a live preview arrow. Purely visual: ChessBoard owns all the gesture/state logic that
 * feeds this. */
export default function BoardAnnotations({ squareSize, rows = 8, cols = 8, scale = 1, arrows, highlights, liveArrow }: BoardAnnotationsProps) {
  const inset = squareSize * END_INSET_RATIO;

  return (
    <Svg
      pointerEvents="none"
      width={squareSize * cols}
      height={squareSize * rows}
      style={{ position: 'absolute', top: 0, left: 0 }}
    >
      {highlights.map((point) => (
        <Rect
          key={`h-${point.row}-${point.col}`}
          x={point.col * squareSize}
          y={point.row * squareSize}
          width={squareSize}
          height={squareSize}
          fill={HIGHLIGHT_COLOR}
        />
      ))}
      {arrows.map((arrow, index) => (
        <ArrowShape key={index} from={center(arrow.from, squareSize)} to={center(arrow.to, squareSize)} insetStart={inset} scale={scale} />
      ))}
      {liveArrow && (
        <ArrowShape from={center(liveArrow.from, squareSize)} to={{ x: liveArrow.toX, y: liveArrow.toY }} insetStart={inset} scale={scale} />
      )}
    </Svg>
  );
}
