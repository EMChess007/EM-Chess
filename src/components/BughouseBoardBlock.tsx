import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable } from './AppPressable';
import Text from './BughouseText';
import { remainingAt, type BughouseMatch, type PromotionPiece } from '../logic/bughouse';
import { PROMOTION_LABELS } from '../logic/promotion';
import type { ReservePieceType } from '../logic/crazyhouse';
import { seatPlace, type BoardId, type BughouseColor, type BughouseSeat } from '../logic/bughouse/types';
import { bughouseTeamShape } from '../logic/bughouseLayout';
import type { BankFlash, LastMove } from '../logic/bughouseLocal';
import { boardCellToSquare, boardSeatsTopFirst, boardStatusLine, checkedKingSquare, formatBughouseClock, pocketChips, type KingBadge } from '../logic/bughouseView';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import {
  pocketChipHeight,
  pocketChipWidth,
  pocketMinWidth,
  pocketPieceSize,
  POCKET_GAP,
  POCKET_MAX_CHIPS,
  POCKET_PADDING,
  showSeatName,
  showStripMarks,
  stripChipMin,
  stripClockMin,
  STRIP_DOT,
  STRIP_GAP,
  STRIP_PADDING,
  STRIP_SHAPE,
} from '../logic/bughousePocket';
import BughouseBoard from './BughouseBoard';
import { pieceInk } from './pieceArt';
import PieceIcon from './PieceIcon';
import { useBoardTouches, type BoardTouches, type DebugFinger } from './useBoardTouches';

const PIECE_NAMES: Record<ReservePieceType, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' };

export interface BughouseBoardBlockProps {
  board: BoardId;
  match: BughouseMatch;
  /** The instant the clocks are drawn at (the match's own time base). */
  nowMs: number;
  orientation: BughouseColor;
  cell: number;
  lastMove: LastMove | null;
  /** Names for the seat bars ("You", "Amateur"). */
  seatName: (seat: BughouseSeat) => string;
  badgeOf: (color: BughouseColor) => KingBadge | null;
  /** The seat a finger may act for on this board right now (the turn lock), or null. */
  actor: BughouseSeat | null;
  selected: string | null;
  moveTargets: readonly string[];
  dropTargets: readonly string[];
  pickedPiece: ReservePieceType | null;
  bank: BankFlash | null;
  /** The status line speaks to the viewer ("your partner") or about a bystander ("their partner"). */
  statusYou: boolean;
  onTapSquare: (board: BoardId, square: string) => void;
  onPickPocket: (board: BoardId, piece: ReservePieceType) => void;
  outlined?: boolean;
  /** Tighter bars and chips, for two boards side by side with no height to spare. */
  compact?: boolean;
  /** Two boards side by side: each block is as wide as its board, so the second cannot be pushed past the window by a bar's one-line content. (Stacked, the bars use the whole column.) */
  sideBySide?: boolean;
  /** W3b, humans on both boards: the grid and the chips take their input from this board's own raw touches (useBoardTouches), not from the responder system. */
  rawTouch?: boolean;
  /** DEV ONLY: draw the square the app computes under each finger over the board (the in-game dev switch; never given in a release build). */
  touchDebug?: boolean;
  /** The promotion choices waiting on THIS board (the dual layout draws them over the board), or none. */
  promotionChoices?: readonly PromotionPiece[];
  /** Both colours of this board are human (pass-and-play rules): the status line doubles as the "<Colour> to move" banner. */
  shared?: boolean;
  onPromotionChoice?: (board: BoardId, choice: PromotionPiece | 'cancel') => void;
}


/**
 * One board with everything that belongs to it: the two players' bars (colour, name, clock, running marker), their pockets with counts, the board and its status line. Every test id
 * says which board it belongs to ("clock-A-white", "pocket-A-white-n", "A-e4"): a board is never implied.
 */
export default function BughouseBoardBlock(props: BughouseBoardBlockProps) {
  const { board, match, orientation, cell, lastMove, badgeOf, actor, selected, moveTargets, dropTargets, onTapSquare, outlined } = props;
  const colors = useAppColors();
  const styles = createStyles(colors, Boolean(props.compact));
  const [top, bottom] = boardSeatsTopFirst(board, orientation);
  const checked = checkedKingSquare(match, board);
  const status = boardStatusLine(match, board, props.statusYou);
  // DEV ONLY (the touch-debug overlay): the fingers on this board's grid, kept only while the dev switch is on.
  const [debugFingers, setDebugFingers] = useState<DebugFinger[]>([]);
  // This board's own raw touches (W3b). The hook is always called; only the dual layout wires it to the grid and the chips.
  const touches = useBoardTouches({
    board,
    cell,
    onTapCell: (tappedBoard, displayCell) => {
      const tapped = boardCellToSquare(tappedBoard, orientation, displayCell.row, displayCell.col);
      onTapSquare(tapped.board, tapped.square);
    },
    onTapChip: props.onPickPocket,
    onTapPromotion: (promotingBoard, choice) => props.onPromotionChoice?.(promotingBoard, choice),
    onDebug: props.touchDebug ? setDebugFingers : undefined,
  });
  const choices = props.rawTouch ? props.promotionChoices ?? [] : [];
  return (
    // Side by side: as wide as its board (+ the 3 dp outline on each side), so the bars take that width and wrap their pocket inside it. Without it the block was as wide as its bar's one-line
    // content and the second board was pushed past the window (landscape phone, a full pocket). Stacked there is room, and a narrower bar would wrap the seat names for nothing.
    <View style={[styles.block, props.sideBySide && { width: cell * 8 + 6 }]} testID={`block-${board}`}>
      <SeatBar {...props} seat={top} touches={props.rawTouch ? touches : null} />
      <View>
        <BughouseBoard
        board={board}
        fen={match.boards[board].fen}
        promoted={match.boards[board].promoted}
        cell={cell}
        orientation={orientation}
        lastMove={lastMove}
        checkedSquare={checked}
        selected={selected}
        moveTargets={moveTargets}
        dropTargets={dropTargets}
        badgeOf={badgeOf}
        interactive={actor !== null}
        onTapSquare={onTapSquare}
        outlined={outlined}
        touches={props.rawTouch ? touches : undefined}
        debugFingers={props.touchDebug ? debugFingers : undefined}
        />
        {choices.length > 0 && (
          // The promotion choice of THIS board, drawn over it: the shared Modal of the other layouts would cover the other board too, and the other board must stay playable.
          <View style={styles.promotion} testID={`promotion-${board}`} accessibilityLabel={`Board ${board}: promote to`}>
            <Text style={styles.promotionTitle}>Promote to</Text>
            <View style={styles.promotionRow}>
              {choices.map((choice) => (
                <View key={choice} accessible accessibilityRole="button" testID={`promote-${board}-${choice}`} accessibilityLabel={`Board ${board}: promote to ${PROMOTION_LABELS[choice]}`} style={styles.promotionButton} {...touches.promotionProps(choice)}>
                  <PieceIcon type={choice} ink={pieceInk(match.verdicts[board].turn)} size={30} />
                </View>
              ))}
              <View accessible accessibilityRole="button" testID={`promote-${board}-cancel`} accessibilityLabel={`Board ${board}: cancel promotion`} style={styles.promotionButton} {...touches.promotionProps('cancel')}>
                <Text style={styles.promotionCancel}>✕</Text>
              </View>
            </View>
          </View>
        )}
      </View>
      <SeatBar {...props} seat={bottom} touches={props.rawTouch ? touches : null} />
      {/* A board whose two colours are both human is pass-and-play: its status line is also the banner that says whose turn it is. */}
      <View testID={props.shared ? `turn-banner-${board}` : undefined}>
        <Text style={[styles.status, props.shared && styles.banner, status.kind === 'stuck' && styles.statusStuck, status.kind === 'check' && styles.statusCheck]} testID={`status-${board}`} accessibilityLiveRegion="polite">
          {status.text}
        </Text>
      </View>
    </View>
  );
}

/**
 * A chip is 24-26 dp tall and 24-40 wide in a bar that is as slim as the two-board layouts need. The hit slop reaches the bar's own edge above and below (the bar clips, and a touch outside a
 * clipping parent is not a touch of its child) and half a gap to each neighbour, so two chips never claim the same point: a touch area of about 36 x 26..40 dp, the most five chips of a full
 * pocket can have side by side in a 304 dp strip.
 */
const CHIP_HIT_SLOP = { top: 5, bottom: 5, left: 1, right: 1 };
/** On web the device matrix reads this attribute: the small size is intended (react-native-web renders `dataSet` as data-* attributes; a phone ignores it). */
const MATRIX_EXEMPT = { dataSet: { matrixExempt: '1' } } as object;
/** `compact` opts out of AppPressable's 44 dp floor (the chips are 22-26 dp tall with hit slop; bughouseCompact.dom.test.tsx pins that the prop reaches AppPressable). */
const COMPACT = { compact: true } as object;

function SeatBar({ seat, match, nowMs, seatName, actor, pickedPiece, bank, onPickPocket, compact, touches }: BughouseBoardBlockProps & { seat: BughouseSeat; touches: BoardTouches | null }) {
  const colors = useAppColors();
  const styles = createStyles(colors, Boolean(compact));
  const place = seatPlace(seat);
  const word = place.color === 'w' ? 'white' : 'black';
  const clock = match.clocks[seat];
  const running = match.result === null && clock.runningSince !== null;
  const remaining = remainingAt(clock, nowMs);
  const chips = pocketChips(match, seat, actor);
  const flashed = bank !== null && bank.seat === seat && bank.seq === match.seq;
  // The strip is MEASURED, never assumed (bughousePocket.ts): its width decides whether the name is shown, the pocket row's width how wide the chips are. Not measured yet (the first render, a
  // test without layout): the name is shown and the chips are the smallest, which always fit.
  const [stripWidth, setStripWidth] = useState<number | null>(null);
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const chipWidth = pocketChipWidth(rowWidth, chips.length, stripChipMin(stripWidth));
  return (
    <View
      style={[styles.bar, running && styles.barRunning]}
      testID={`bar-${place.board}-${word}`}
      accessibilityLabel={`${seatName(seat)}, board ${place.board} ${word}`}
      onLayout={(e) => setStripWidth(Math.round(e.nativeEvent.layout.width))}
    >
      {/* a NARROW strip (a 20 dp cell, side by side) drops the colour dot and the team shape to keep room for a full pocket */}
      {showStripMarks(stripWidth) && <View style={[styles.colourDot, place.color === 'w' ? styles.dotWhite : styles.dotBlack]} />}
      {showStripMarks(stripWidth) && (
        <Text maxFontSizeMultiplier={1} style={styles.shape}>
          {bughouseTeamShape(place.team)}
        </Text>
      )}
      {showSeatName(stripWidth) && <Text style={styles.name}>{seatName(seat)}</Text>}
      {/* ONE row that never wraps: an empty pocket shows nothing, a full one shrinks its chips. */}
      <View
        // The room of a FULL pocket is reserved (flexBasis, no shrink): the seat's name, the only part whose width is not fixed, gives way first. Reserved for five chips whatever the pocket holds now,
        // so nothing moves while a game is played.
        style={[styles.pocket, { flexBasis: pocketMinWidth(POCKET_MAX_CHIPS, stripChipMin(stripWidth)) }, flashed && styles.pocketFlash]}
        testID={`pocket-${place.board}-${word}`}
        accessibilityLabel={flashed ? `Board ${place.board} ${word} pocket, just received a piece` : `Board ${place.board} ${word} pocket`}
        onLayout={(e) => setRowWidth(Math.round(e.nativeEvent.layout.width))}
      >
        {chips.map((chip) => {
          const common = {
            testID: `pocket-${place.board}-${word}-${chip.piece}`,
            accessibilityRole: 'button' as const,
            accessibilityLabel: `Board ${place.board} ${word} pocket: ${chip.count} ${PIECE_NAMES[chip.piece]}${chip.count === 1 ? '' : 's'}${chip.usable ? ', tap to drop' : ''}${pickedPiece === chip.piece && actor === seat ? ', picked up' : ''}`,
            style: [styles.chip, { width: chipWidth }, pickedPiece === chip.piece && actor === seat && styles.chipSelected, !chip.usable && actor === seat && styles.chipUnavailable],
          };
          const face = (
            <>
              {/* The chip is board art: the piece is a vector in its colour (pieceArt.ts) and the count a small pill on it; neither grows with the system font (maxFontSizeMultiplier 1, CHECKLIST 6b). */}
              <PieceIcon type={chip.piece} ink={pieceInk(place.color)} size={pocketPieceSize(Boolean(compact), chipWidth)} />
              <View style={styles.countPill} pointerEvents="none">
                <Text maxFontSizeMultiplier={1} style={styles.count}>{chip.count}</Text>
              </View>
            </>
          );
          // The dual layout: a chip is a plain View with this board's own touch handlers (a Pressable would join the responder system the two boards must stay out of).
          if (touches) {
            return (
              // only the chip of the side to move that has a legal square listens (the Pressable of the other layouts is `disabled` for every other chip): the reducer would otherwise lift the
              // piece of the SIDE TO MOVE when the pocket of its opponent is touched
              <View key={chip.piece} accessible hitSlop={CHIP_HIT_SLOP} {...MATRIX_EXEMPT} {...common} {...(chip.usable ? touches.chipProps(chip.piece) : {})}>
                {face}
              </View>
            );
          }
          return (
            <Pressable key={chip.piece} {...COMPACT} hitSlop={CHIP_HIT_SLOP} disabled={!chip.usable} onPress={() => onPickPocket(place.board, chip.piece)} {...common}>
              {face}
            </Pressable>
          );
        })}
      </View>
      <Text maxFontSizeMultiplier={1} style={[styles.clock, { minWidth: stripClockMin(stripWidth) }, running && styles.clockRunning, remaining < 10000 && styles.clockLow]} testID={`clock-${place.board}-${word}`} accessibilityLabel={`Board ${place.board} ${word} clock`}>
        {formatBughouseClock(remaining)}
      </Text>
    </View>
  );
}

function createStyles(colors: AppColors, compact: boolean) {
  return StyleSheet.create({
    block: { alignItems: 'center', gap: compact ? 1 : 4 },
    // The strip: one row, at least as tall as its chips, CLIPPING what it holds (overflow hidden): whatever a layout engine does with the parts inside, nothing is drawn outside it, so nothing
    // can cover the board, the clock beside it or the status line below. Its height is the chip's plus the bar's own padding - it does not depend on what the pocket holds.
    bar: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: STRIP_GAP, minHeight: compact ? 30 : 36, paddingHorizontal: STRIP_PADDING, borderRadius: 8, borderWidth: 1, borderColor: 'transparent', overflow: 'hidden' },
    barRunning: { borderColor: colors.gold },
    colourDot: { width: STRIP_DOT, height: STRIP_DOT, borderRadius: STRIP_DOT / 2, borderWidth: 1, borderColor: '#555' },
    dotWhite: { backgroundColor: '#fff' },
    dotBlack: { backgroundColor: '#111' },
    shape: { minWidth: STRIP_SHAPE, flexShrink: 0, textAlign: 'center', fontSize: 12, color: colors.textSecondary },
    name: { flexShrink: 1, minWidth: 0, fontSize: compact ? 12 : 13, fontWeight: '700', color: colors.text },
    // The pocket: a row that NEVER wraps (the old flex-wrap row stacked its chips vertically on the phone and let them run out of the bar), exactly as tall as a chip. It takes what the other
    // parts leave (flex 1, minWidth 0); the chips' own widths are computed to fit it (pocketChipWidth).
    pocket: { flexGrow: 1, flexShrink: 0, minWidth: 0, flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', justifyContent: 'flex-start', gap: POCKET_GAP, height: pocketChipHeight(compact) + 2, paddingHorizontal: POCKET_PADDING, borderRadius: 6, borderWidth: 1, borderColor: 'transparent' },
    pocketFlash: { borderColor: '#2e7d32', backgroundColor: 'rgba(46,125,50,0.18)' },
    chip: { height: pocketChipHeight(compact), flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 7, backgroundColor: '#b58863', borderWidth: 1, borderColor: '#8a6d3b' },
    chipSelected: { backgroundColor: '#a2d149', borderColor: '#5a7a1a' },
    chipUnavailable: { opacity: 0.45 },
    // the count: a small pill on the chip's lower right corner, readable on the piece in either colour
    countPill: { position: 'absolute', right: -1, bottom: -1, minWidth: 13, height: 13, paddingHorizontal: 2, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.92)' },
    count: { fontSize: 10, lineHeight: 12, fontWeight: '700', color: '#2a1d10' },
    clock: { textAlign: 'right', fontSize: compact ? 14 : 15, fontWeight: '700', fontVariant: ['tabular-nums'], color: colors.textSecondary },
    clockRunning: { color: colors.text },
    clockLow: { color: colors.danger },
    banner: { fontSize: compact ? 13 : 15, fontWeight: '800', color: colors.text },
    promotion: { position: 'absolute', left: 0, right: 0, top: '30%', alignItems: 'center', gap: 4, paddingVertical: 6, backgroundColor: 'rgba(244,236,216,0.96)', borderRadius: 8 },
    promotionTitle: { fontSize: 12, fontWeight: '700', color: '#3a2d1a' },
    promotionRow: { flexDirection: 'row', gap: 8 },
    promotionButton: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#b58863', borderWidth: 1, borderColor: '#8a6d3b' },
    promotionGlyph: { fontSize: 26, color: '#1b130c' },
    promotionCancel: { fontSize: 18, color: '#3a2d1a' },
    status: { fontSize: compact ? 12 : 13, fontWeight: '600', color: colors.textSecondary, textAlign: 'center' },
    statusStuck: { color: '#b26a00' },
    statusCheck: { color: colors.danger },
  });
}
