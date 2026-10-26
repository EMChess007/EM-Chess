import { Pressable, StyleSheet, Text, View } from 'react-native';
import { remainingAt, type BughouseMatch } from '../logic/bughouse';
import type { ReservePieceType } from '../logic/crazyhouse';
import { seatPlace, type BoardId, type BughouseColor, type BughouseSeat } from '../logic/bughouse/types';
import { bughouseTeamShape } from '../logic/bughouseLayout';
import type { BankFlash, LastMove } from '../logic/bughouseLocal';
import { boardSeatsTopFirst, boardStatusLine, checkedKingSquare, formatBughouseClock, pocketChips, type KingBadge } from '../logic/bughouseView';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import BughouseBoard from './BughouseBoard';

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
  return (
    <View style={styles.block} testID={`block-${board}`}>
      <SeatBar {...props} seat={top} />
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
      />
      <SeatBar {...props} seat={bottom} />
      <Text style={[styles.status, status.kind === 'stuck' && styles.statusStuck, status.kind === 'check' && styles.statusCheck]} testID={`status-${board}`} accessibilityLiveRegion="polite">
        {status.text}
      </Text>
    </View>
  );
}

function SeatBar({ seat, match, nowMs, seatName, actor, pickedPiece, bank, onPickPocket, compact }: BughouseBoardBlockProps & { seat: BughouseSeat }) {
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
      <Text style={styles.name} numberOfLines={1}>
        {seatName(seat)}
      </Text>
      <View style={[styles.pocket, flashed && styles.pocketFlash]} testID={`pocket-${place.board}-${word}`} accessibilityLabel={flashed ? `Board ${place.board} ${word} pocket, just received a piece` : `Board ${place.board} ${word} pocket`}>
        {chips.length === 0 && <Text style={styles.empty}>-</Text>}
        {chips.map((chip) => (
          <Pressable
            key={chip.piece}
            disabled={!chip.usable}
            onPress={() => onPickPocket(place.board, chip.piece)}
            testID={`pocket-${place.board}-${word}-${chip.piece}`}
            accessibilityRole="button"
            accessibilityLabel={`Board ${place.board} ${word} pocket: ${chip.count} ${PIECE_NAMES[chip.piece]}${chip.count === 1 ? '' : 's'}${chip.usable ? ', tap to drop' : ''}`}
            style={[styles.chip, pickedPiece === chip.piece && actor === seat && styles.chipSelected, !chip.usable && actor === seat && styles.chipUnavailable]}
          >
            <Text style={[styles.glyph, place.color === 'w' ? styles.glyphWhite : styles.glyphBlack]}>{GLYPHS[chip.piece]}</Text>
            <Text style={styles.count}>{chip.count}</Text>
          </Pressable>
        ))}
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
    status: { fontSize: compact ? 12 : 13, fontWeight: '600', color: colors.textSecondary, textAlign: 'center' },
    statusStuck: { color: '#b26a00' },
    statusCheck: { color: colors.danger },
  });
}
