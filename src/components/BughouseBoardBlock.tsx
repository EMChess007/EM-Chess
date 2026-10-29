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
import BughouseBoard from './BughouseBoard';
import { useBoardTouches, type BoardTouches, type DebugFinger } from './useBoardTouches';

const GLYPHS: Record<ReservePieceType, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' };
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

const PROMOTION_GLYPHS: Record<PromotionPiece, string> = { q: '♛', r: '♜', b: '♝', n: '♞' };

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
    <View style={styles.block} testID={`block-${board}`}>
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
                  <Text style={styles.promotionGlyph}>{PROMOTION_GLYPHS[choice]}</Text>
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

/** A chip is 22-26 dp tall in a bar that is as slim as the two-board layouts need: 9 dp above and below (and 8 to the sides of a 28 dp minimum width) make its touch area 44 dp. */
const CHIP_HIT_SLOP = { top: 9, bottom: 9, left: 8, right: 8 };
/** On web the device matrix reads this attribute: the small size is intended (react-native-web renders `dataSet` as data-* attributes; a phone ignores it). */
const MATRIX_EXEMPT = { dataSet: { matrixExempt: '1' } } as object;
/** `compact` opts out of AppPressable's 44 dp floor; react-native's own Pressable (until master's text-fit change is merged here) ignores it. */
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
  return (
    <View style={[styles.bar, running && styles.barRunning]} testID={`bar-${place.board}-${word}`}>
      <View style={[styles.colourDot, place.color === 'w' ? styles.dotWhite : styles.dotBlack]} />
      <Text style={styles.shape}>{bughouseTeamShape(place.team)}</Text>
      <Text style={styles.name}>
        {seatName(seat)}
      </Text>
      <View style={[styles.pocket, flashed && styles.pocketFlash]} testID={`pocket-${place.board}-${word}`} accessibilityLabel={flashed ? `Board ${place.board} ${word} pocket, just received a piece` : `Board ${place.board} ${word} pocket`}>
        {chips.length === 0 && <Text style={styles.empty}>-</Text>}
        {chips.map((chip) => {
          const common = {
            testID: `pocket-${place.board}-${word}-${chip.piece}`,
            accessibilityRole: 'button' as const,
            accessibilityLabel: `Board ${place.board} ${word} pocket: ${chip.count} ${PIECE_NAMES[chip.piece]}${chip.count === 1 ? '' : 's'}${chip.usable ? ', tap to drop' : ''}${pickedPiece === chip.piece && actor === seat ? ', picked up' : ''}`,
            style: [styles.chip, pickedPiece === chip.piece && actor === seat && styles.chipSelected, !chip.usable && actor === seat && styles.chipUnavailable],
          };
          const face = (
            <>
              <Text style={[styles.glyph, place.color === 'w' ? styles.glyphWhite : styles.glyphBlack]}>{GLYPHS[chip.piece]}</Text>
              <Text style={styles.count}>{chip.count}</Text>
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
      <Text style={[styles.clock, running && styles.clockRunning, remaining < 10000 && styles.clockLow]} testID={`clock-${place.board}-${word}`} accessibilityLabel={`Board ${place.board} ${word} clock`}>
        {formatBughouseClock(remaining)}
      </Text>
    </View>
  );
}

function createStyles(colors: AppColors, compact: boolean) {
  return StyleSheet.create({
    block: { alignItems: 'center', gap: compact ? 1 : 4 },
    bar: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: compact ? 0 : 3, paddingHorizontal: 6, borderRadius: 8, borderWidth: 1, borderColor: 'transparent' },
    barRunning: { borderColor: colors.gold },
    colourDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: '#555' },
    dotWhite: { backgroundColor: '#fff' },
    dotBlack: { backgroundColor: '#111' },
    shape: { fontSize: 12, color: colors.textSecondary },
    name: { flexShrink: 1, fontSize: 13, fontWeight: '700', color: colors.text },
    pocket: { flex: 1, flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', gap: 3, minHeight: 28, paddingHorizontal: 4, borderRadius: 6, borderWidth: 1, borderColor: 'transparent' },
    pocketFlash: { borderColor: '#2e7d32', backgroundColor: 'rgba(46,125,50,0.18)' },
    empty: { fontSize: 12, color: colors.textSecondary },
    chip: { height: compact ? 22 : 26, minWidth: 28, paddingHorizontal: 3, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 1, borderRadius: 7, backgroundColor: '#b58863', borderWidth: 1, borderColor: '#8a6d3b' },
    chipSelected: { backgroundColor: '#a2d149', borderColor: '#5a7a1a' },
    chipUnavailable: { opacity: 0.45 },
    glyph: { fontSize: 16, lineHeight: 20 },
    glyphWhite: { color: '#fff', textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 2 },
    glyphBlack: { color: '#1b130c' },
    count: { fontSize: 11, fontWeight: '700', color: '#2a1d10' },
    clock: { minWidth: 58, textAlign: 'right', fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'], color: colors.textSecondary },
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
