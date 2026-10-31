import { memo, useMemo, useRef } from 'react';
import { Platform, StyleSheet, View, type ViewInstance } from 'react-native';
import { Text } from './AppText';
import { openBoard } from '../logic/bughouse';
import type { BoardId, BughouseColor } from '../logic/bughouse/types';
import { boardCellToSquare, type KingBadge } from '../logic/bughouseView';
import { useActiveBoardTheme, useActivePieceTheme } from '../logic/themeHooks';
import type { PieceImageMap } from '../types/theme';
import Piece from './Piece';
import { useBoardGestures } from './useBoardGestures';
import { getE2eStateProbe, getTouchDebugOverlay } from './devOverlayRegistry';
import type { BoardTouches, DebugFinger } from './useBoardTouches';

const PIECE_NAMES: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export interface BughouseBoardProps {
  /** Which board this is: every label and test id of the board says so ("A-e4"), and the touch seam files its gestures under it. */
  board: BoardId;
  fen: string;
  /** The squares holding a promoted piece (drawn with a "~"). */
  promoted: readonly string[];
  /** Side of one cell in pixels. */
  cell: number;
  /** The colour at the bottom. */
  orientation: BughouseColor;
  lastMove: { from: string; to: string } | null;
  checkedSquare: string | null;
  selected: string | null;
  /** Squares a selected piece may move to / a picked pocket piece may be dropped on. */
  moveTargets: readonly string[];
  dropTargets: readonly string[];
  /** The team badge of the king of that colour, if it has one. */
  badgeOf: (color: BughouseColor) => KingBadge | null;
  /** Whether a finger may use the board (the side to move is a human at this device). A read-only board (the thumbnail) is not interactive. */
  interactive: boolean;
  onTapSquare?: (board: BoardId, square: string) => void;
  /** The deciding board of a finished match is outlined. */
  outlined?: boolean;
  /**
   * W3b, the dual-board layout: this board takes its input from raw touches of its own (components/useBoardTouches.ts) instead of the PanResponder, so that a finger on the other board
   * cannot cancel or steal a gesture on this one. Given, the grid is wired to it at all times (the screen decides what a tap means for a side that may not move).
   */
  touches?: BoardTouches;
  /** DEV ONLY: the fingers to draw the touch-debug overlay for (given only in a development build with the overlay switched on). */
  debugFingers?: readonly DebugFinger[];
  /** W5: the queued premove of the human at this device on this board - the squares in the premove colour and a ghost of the piece on the target. */
  premove?: { from: string | null; to: string; ghost: { color: BughouseColor; type: string } } | null;
}

/** The premove colour: a blue the other highlights (green selection, yellow last move, red check) are not. A literal on purpose. */
export const PREMOVE_COLOR = '#7fa8e0';

/**
 * One Bughouse board. Pieces and squares come from the engine's FEN; this component only DRAWS and reports a tap as (board, square) - the screen decides what a tap means. The board is the
 * unit the spec's HP9 is about: every cell is board-qualified ("e4, board A, White knight"), and a tap carries its board.
 */
function BughouseBoard({ board, fen, promoted, cell, orientation, lastMove, checkedSquare, selected, moveTargets, dropTargets, badgeOf, interactive, onTapSquare, outlined, touches, debugFingers, premove }: BughouseBoardProps) {
  const theme = useActiveBoardTheme();
  const pieceTheme = useActivePieceTheme();
  const grid = useMemo(() => openBoard(fen)?.board() ?? [], [fen]);
  const promotedSet = useMemo(() => new Set(promoted), [promoted]);
  const moveSet = useMemo(() => new Set(moveTargets), [moveTargets]);
  const dropSet = useMemo(() => new Set(dropTargets), [dropTargets]);

  const gestures = useBoardGestures({
    squareSize: cell,
    rows: 8,
    cols: 8,
    enableAnnotations: false,
    seamKey: board,
    onTap: ({ row, col }) => {
      if (!interactive || !onTapSquare) return;
      const tapped = boardCellToSquare(board, orientation, row, col);
      onTapSquare(tapped.board, tapped.square);
    },
    onArrow: () => {},
    onHighlight: () => {},
  });

  const size = cell * 8;
  const DebugOverlay = getTouchDebugOverlay();
  const E2eProbe = getE2eStateProbe();
  // A board nobody may touch (a spectator's) has no gesture container; the end-to-end build still has to measure it, so the grid carries a ref of its own then.
  const measuredRef = useRef<ViewInstance>(null);
  // On a phone the grid's touches come through the overlay (below) and carry the grid's own frame; in the browser the grid itself listens.
  const surface = false && touches !== undefined && Platform.OS !== 'web'; // PROOF BRANCH: the command #26 overlay fix switched OFF
  return (
    <View
      ref={touches ? touches.gridRef : interactive ? gestures.containerRef : measuredRef}
      onLayout={touches ? undefined : interactive ? gestures.onLayout : undefined}
      {...(touches ? (surface ? {} : touches.gridProps) : interactive ? gestures.panHandlers : {})}
      style={[styles.board, { width: size, height: size }, touches && styles.rawTouch, outlined && styles.outlined]}
      testID={`board-${board}`}
      accessibilityLabel={outlined ? `Board ${board}, deciding board` : `Board ${board}`}
    >
      {Array.from({ length: 8 }, (_, row) => (
        <View key={row} style={styles.row}>
          {Array.from({ length: 8 }, (_, col) => {
            const { square } = boardCellToSquare(board, orientation, row, col);
            const file = square.charCodeAt(0) - 97;
            const rank = Number(square[1]);
            const piece = grid[8 - rank]?.[file] ?? null;
            // a1 is a dark square and a8 a light one (file 0-based, rank 1-based: an even sum is light). It was the other way round on every Bughouse board until command #27b.
            const light = (file + rank) % 2 === 0;
            const badge = piece && piece.type === 'k' ? badgeOf(piece.color) : null;
            const isMove = moveSet.has(square);
            const isDrop = dropSet.has(square);
            const label = [
              square,
              `board ${board}`,
              piece ? `${piece.color === 'w' ? 'White' : 'Black'} ${PIECE_NAMES[piece.type]}${promotedSet.has(square) ? ' (promoted)' : ''}` : null,
              isMove ? 'can move here' : null,
              isDrop ? 'can drop here' : null,
              premove && premove.from === square ? 'premove from' : null,
              premove && premove.to === square ? 'premove to' : null,
              badge ? badge.label : null,
            ]
              .filter(Boolean)
              .join(', ');
            const background = checkedSquare === square ? '#ef5350' : selected === square ? '#a2d149' : premove && (premove.from === square || premove.to === square) ? PREMOVE_COLOR : lastMove &&(lastMove.from === square || lastMove.to === square) ? '#f7ec74' : light ? theme.lightColor : theme.darkColor;
            return (
              <View key={col} testID={`${board}-${square}`} accessibilityLabel={label} style={[styles.cell, { width: cell, height: cell, backgroundColor: background }]}>
                {(isMove || isDrop) && <View style={[styles.dot, isDrop && styles.dropDot, { width: cell * 0.36, height: cell * 0.36, borderRadius: cell * 0.18 }]} />}
                {piece && (
                  <View style={{ width: cell, height: cell, alignItems: 'center', justifyContent: 'center' }}>
                    <PieceArt color={piece.color} type={piece.type} cell={cell} images={pieceTheme.images} />
                  </View>
                )}
                {premove && premove.to === square && (
                  <View pointerEvents="none" testID={`premove-ghost-${board}`} style={[styles.ghost, { width: cell, height: cell }]}>
                    <PieceArt color={premove.ghost.color} type={premove.ghost.type} cell={cell} images={pieceTheme.images} />
                  </View>
                )}
                {promotedSet.has(square) && piece && <Text maxFontSizeMultiplier={1} style={[styles.promotedMark, { fontSize: Math.max(8, cell * 0.3) }]}>~</Text>}
                {badge && <BadgeMark badge={badge} cell={cell} board={board} square={square} />}
              </View>
            );
          })}
        </View>
      ))}
      {/*
        The grid's touch surface (a phone): a transparent view over the whole grid, the LAST child so it is the touch target. A touch on it reports `locationX / locationY` in the grid's own frame
        (useBoardTouches), which needs no origin - no window, status-bar, navigation-bar, header or scroll offset can enter the cell (command #26: on Android every tap landed one rank too low).
        On web the browser reports page coordinates against the grid's rectangle and the cells stay the hit targets.
      */}
      {touches && surface && <View ref={touches.surfaceRef} testID={`board-${board}-surface`} style={StyleSheet.absoluteFill} {...touches.surfaceProps} />}
      {/* DEV ONLY: the square under each finger. The overlay is registered only in a development build (devOverlayRegistry.ts); in a release build there is none. */}
      {touches && debugFingers && DebugOverlay ? <DebugOverlay board={board} orientation={orientation} cell={cell} fingers={debugFingers} /> : null}
      {/* DEV ONLY, the Android end-to-end build: the board's state for the driver (src/dev/E2eStateProbe.tsx). Null everywhere else. */}
      {E2eProbe ? <E2eProbe channel={`board-${board}`} rectOf={touches ? touches.gridRef : interactive ? gestures.containerRef : measuredRef} state={{ fen, selected, orientation, interactive, targets: moveTargets.length }} /> : null}
    </View>
  );
}

function PieceArt({ color, type, cell, images }: { color: BughouseColor; type: string; cell: number; images?: PieceImageMap }) {
  return (
    <View style={{ width: cell, height: cell, alignItems: 'center', justifyContent: 'center' }}>
      <Piece piece={{ color, type } as never} images={images} size={cell} />
    </View>
  );
}

/** The team badge: a diamond (Team 1) or a circle (Team 2), our own shapes, drawn in a cell's top-right corner. */
function BadgeMark({ badge, cell, board, square }: { badge: KingBadge; cell: number; board: BoardId; square: string }) {
  const size = Math.max(3, Math.round(cell * 0.18));
  return (
    <View
      testID={`badge-${board}-${square}`}
      accessibilityLabel={`team ${badge.team} badge`}
      pointerEvents="none"
      style={[
        styles.badge,
        { width: size, height: size, top: Math.round(cell * 0.04), right: Math.round(cell * 0.04), backgroundColor: badge.team === 1 ? '#1e88e5' : '#f9a825', borderRadius: badge.shape === '●' ? size / 2 : 0 },
        badge.shape === '◆' && { transform: [{ rotate: '45deg' }] },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  board: { flexDirection: 'column', borderWidth: 0 },
  // web: the browser must not scroll, zoom or select on a board that two fingers play at once (touch events would then end in a cancel)
  rawTouch: { touchAction: 'none', userSelect: 'none' } as object,
  outlined: { borderWidth: 3, borderColor: '#e53935' },
  row: { flexDirection: 'row' },
  cell: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  dot: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.3)' },
  dropDot: { backgroundColor: 'rgba(46,125,50,0.55)' },
  ghost: { position: 'absolute', opacity: 0.55 },
  promotedMark: { position: 'absolute', top: 0, left: 2, fontWeight: '800', color: '#c62828' },
  badge: { position: 'absolute', borderWidth: 1, borderColor: '#fff' },
});

export default memo(BughouseBoard);
