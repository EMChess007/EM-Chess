import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import BughouseBoard from '../components/BughouseBoard';
import BughouseBoardBlock from '../components/BughouseBoardBlock';
import BughouseRulesSheet from '../components/BughouseRulesSheet';
import PromotionPicker from '../components/PromotionPicker';
import ScreenHeader from '../components/ScreenHeader';
import { firstLegalAction, legalMovesOn, remainingAt, type BughouseMatch, type BughouseTimeControl, type PromotionPiece } from '../logic/bughouse';
import { BOARD_IDS, otherBoard, seatAt, seatPlace, type BoardId, type BughouseSeat } from '../logic/bughouse/types';
import { BUGHOUSE_THUMB_CELL, deriveBughouseLayout, getBughouseMainCellSize, getBughouseSideCellSize, humanBughouseSeats, seatRowLabel, standardArrangement } from '../logic/bughouseLayout';
import { bughouseBotThinkMs, dueBotSeats, localBotAction, localStep, nextDeadline, startLocalGame, type LocalGameState } from '../logic/bughouseLocal';
import { boardOrientation, boardStatusLine, dropSquares, formatBughouseClock, gameOverSummary, kingBadge, mainBoardOf, pocketChips, touchSeat } from '../logic/bughouseView';
import { type AppColors, useAppColors } from '../logic/colorSchemeHooks';
import type { ReservePieceType } from '../logic/crazyhouse';
import type { SeatConfig } from '../logic/fourPlayer/setup';
import { botDisplayName } from '../logic/fourPlayerBots';
import { PROMOTION_LABELS } from '../logic/promotion';

interface BughouseGameScreenProps {
  seats: SeatConfig;
  timeControl: BughouseTimeControl;
  onExit: () => void;
  /** Injected for tests: the randomness of the bots (and of the room number) and the clock (integer ms, any origin). */
  rng?: () => number;
  clock?: () => number;
  /** Tests only: start from this position instead of the standard one (its clocks must be on the screen's time base, i.e. start at 0). */
  startFrom?: BughouseMatch;
}

const GLYPH: Record<PromotionPiece, string> = { q: '♛', r: '♜', b: '♝', n: '♞' };
const PROMOTION_ORDER: readonly PromotionPiece[] = ['q', 'r', 'b', 'n'];

/**
 * Bughouse, Local (W3a): one human (its board large and the partner's a thumbnail, or two equal boards side by side in landscape) or several humans all on ONE board (pass-and-play: that
 * board turns to the side to move, only the side to move can touch). The match is the engine's; every action goes through its `settle` with ONE integer clock. Bots are the W2 bot.
 */
export default function BughouseGameScreen({ seats, timeControl, onExit, rng, clock, startFrom }: BughouseGameScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const { width, height } = useWindowDimensions();
  const layout = useMemo(() => deriveBughouseLayout(seats), [seats]);
  const random = useRef(rng ?? Math.random).current;
  const readClock = useRef(clock ?? (() => Date.now())).current;
  const base = useRef(readClock());
  const lastRead = useRef(0);
  /** The match's own time base: integer ms since the screen opened, never going back. */
  const elapsed = useCallback((): number => {
    lastRead.current = Math.max(lastRead.current, Math.floor(readClock() - base.current));
    return lastRead.current;
  }, [readClock]);

  const [state, setState] = useState<LocalGameState>(() => {
    const fresh = startLocalGame(timeControl, 0, Math.floor(random() * 1000000));
    return startFrom ? { ...fresh, match: startFrom } : fresh;
  });
  const stateRef = useRef(state);
  const [nowMs, setNowMs] = useState(0);
  const [flagKick, setFlagKick] = useState(0);
  const [swapped, setSwapped] = useState(false);
  const [autoFlip, setAutoFlip] = useState(true);
  const [rulesOpen, setRulesOpen] = useState(false);
  // What the human has half-way through on a board (a picked-up piece, a picked pocket piece, a promotion choice). Each remembers the position of ITS board it was made in and is
  // dropped the moment that board changes - not when the match as a whole commits: with bots on the other board a commit lands every few hundred milliseconds, and a selection that
  // any commit cleared could never be followed by its second tap.
  const [rawSelected, setSelected] = useState<{ board: BoardId; square: string; fen: string } | null>(null);
  const [rawPicked, setPicked] = useState<{ board: BoardId; piece: ReservePieceType; fen: string } | null>(null);
  const [rawPromotion, setPromotion] = useState<{ board: BoardId; from: string; to: string; choices: PromotionPiece[]; fen: string } | null>(null);
  const match = state.match;
  const stillHere = <T extends { board: BoardId; fen: string }>(held: T | null): T | null => (held !== null && match.result === null && held.fen === match.boards[held.board].fen ? held : null);
  const selected = stillHere(rawSelected);
  const picked = stillHere(rawPicked);
  const promotion = stillHere(rawPromotion);

  /** The one place the state changes: the engine's funnel at the current instant. */
  const commit = useCallback(
    (input: Parameters<typeof localStep>[1]) => {
      const step = localStep(stateRef.current, input, elapsed());
      if (step.outcome.kind === 'applied' || step.outcome.kind === 'flag') {
        stateRef.current = step.state;
        setState(step.state);
        setNowMs(step.state.match.nowMs);
      }
      return step.outcome;
    },
    [elapsed],
  );

  // The clocks on screen.
  const over = match.result !== null;
  useEffect(() => {
    if (over) return;
    const id = setInterval(() => setNowMs(elapsed()), 200);
    return () => clearInterval(id);
  }, [over, elapsed]);

  // The flag timer: it fires when the earliest running clock would flag; a timer that wakes a hair early is idle and re-armed.
  useEffect(() => {
    const deadline = nextDeadline(match);
    if (deadline === null) return;
    const id = setTimeout(() => {
      if (commit(null).kind === 'idle') setFlagKick((k) => k + 1);
    }, Math.max(0, deadline - elapsed()));
    return () => clearTimeout(id);
  }, [match, commit, elapsed, flagKick]);

  // The bots: one pending move per board, kept while the same seat is still on move (a busy other board must not postpone it).
  const botTimers = useRef<Record<BoardId, { seat: BughouseSeat; id: ReturnType<typeof setTimeout> } | null>>({ A: null, B: null });
  useEffect(() => {
    const due = dueBotSeats(seats, match);
    for (const board of BOARD_IDS) {
      const pending = botTimers.current[board];
      const seat = due.find((s) => seatPlace(s).board === board) ?? null;
      if (pending && seat === pending.seat) continue;
      if (pending) clearTimeout(pending.id);
      botTimers.current[board] = null;
      if (seat === null) continue;
      const id = setTimeout(() => {
        botTimers.current[board] = null;
        const current = stateRef.current.match;
        if (!dueBotSeats(seats, current).includes(seat)) return;
        const action = localBotAction(seats, current, seat, random) ?? firstLegalAction(current, seat);
        if (action === null) return;
        const outcome = commit({ seat, action });
        if (outcome.kind === 'rejected') {
          const fallback = firstLegalAction(stateRef.current.match, seat);
          if (fallback) commit({ seat, action: fallback });
        }
      }, bughouseBotThinkMs(timeControl.initialMs));
      botTimers.current[board] = { seat, id };
    }
  }, [match, seats, commit, random, timeControl.initialMs]);
  useEffect(
    () => () => {
      for (const board of BOARD_IDS) {
        const pending = botTimers.current[board];
        if (pending) clearTimeout(pending.id);
      }
    },
    [],
  );

  // --- Taps ---------------------------------------------------------------------------------------------------------------------------------
  const actors = { A: touchSeat(seats, match, 'A'), B: touchSeat(seats, match, 'B') };

  const movesOfSelected = useMemo(() => (selected ? legalMovesOn(match, selected.board).filter((m) => m.from === selected.square) : []), [match, selected]);
  const selectedTargets = useMemo(() => Array.from(new Set(movesOfSelected.map((m) => m.to))), [movesOfSelected]);
  const dropTargetsOfPick = useMemo(() => (picked ? dropSquares(match, picked.board, picked.piece) : []), [match, picked]);

  const onTapSquare = (board: BoardId, square: string) => {
    const actor = actors[board];
    if (actor === null) return;
    if (picked && picked.board === board) {
      if (dropSquares(match, board, picked.piece).includes(square)) {
        commit({ seat: actor, action: { kind: 'drop', board, piece: picked.piece, square } });
        return;
      }
      setPicked(null);
    }
    if (selected && selected.board === board) {
      const matching = movesOfSelected.filter((m) => m.to === square);
      if (matching.length > 0) {
        if (matching.some((m) => m.promotion)) {
          const choices = PROMOTION_ORDER.filter((p) => matching.some((m) => m.promotion === p));
          setPromotion({ board, from: selected.square, to: square, choices, fen: match.boards[board].fen });
          return;
        }
        commit({ seat: actor, action: { kind: 'move', board, from: selected.square, to: square } });
        return;
      }
    }
    const own = legalMovesOn(match, board).some((m) => m.from === square);
    setSelected(own ? { board, square, fen: match.boards[board].fen } : null);
  };

  const onPickPocket = (board: BoardId, piece: ReservePieceType) => {
    if (actors[board] === null) return;
    setSelected(null);
    setPicked(picked && picked.board === board && picked.piece === piece ? null : { board, piece, fen: match.boards[board].fen });
  };

  const choosePromotion = (piece: PromotionPiece) => {
    const pending = promotion;
    setPromotion(null);
    const actor = pending ? actors[pending.board] : null;
    if (pending && actor !== null) commit({ seat: actor, action: { kind: 'move', board: pending.board, from: pending.from, to: pending.to, promotion: piece } });
  };

  const rematch = () => {
    const fresh = startLocalGame(timeControl, elapsed(), Math.floor(random() * 1000000));
    stateRef.current = fresh;
    setState(fresh);
    setNowMs(fresh.match.nowMs);
    setSwapped(false);
  };

  const resign = () => {
    const board = mainBoardOf(layout);
    const seat = layout.kind === 'standard' ? layout.seat : touchSeat(seats, match, board);
    if (seat !== null && match.result === null) commit({ seat, action: { kind: 'resign' } });
  };

  // --- Rendering ----------------------------------------------------------------------------------------------------------------------------
  const humans = humanBughouseSeats(seats);
  const seatName = (seat: BughouseSeat): string => {
    const controller = seats[seat];
    if (controller.kind === 'bot') return botDisplayName(controller.elo);
    return humans.length === 1 ? 'You' : seatRowLabel(seat).text.replace(/ · Team \d/, '');
  };
  const summary = gameOverSummary(match);
  const mainBoard: BoardId = swapped ? otherBoard(mainBoardOf(layout)) : mainBoardOf(layout);
  const arrangement = standardArrangement(width, height);

  const blockOf = (board: BoardId, cell: number) => (
    <BughouseBoardBlock
      key={board}
      board={board}
      match={match}
      nowMs={nowMs}
      orientation={boardOrientation(layout, board, match, autoFlip)}
      cell={cell}
      lastMove={state.lastMove[board]}
      seatName={seatName}
      badgeOf={(color) => kingBadge(layout, board, color)}
      actor={actors[board]}
      selected={selected && selected.board === board ? selected.square : null}
      moveTargets={selected && selected.board === board ? selectedTargets : []}
      dropTargets={picked && picked.board === board ? dropTargetsOfPick : []}
      pickedPiece={picked && picked.board === board ? picked.piece : null}
      bank={state.bank}
      statusYou={layout.kind === 'standard' ? seatAt(board, match.verdicts[board].turn) === layout.seat : actors[board] !== null}
      onTapSquare={onTapSquare}
      onPickPocket={onPickPocket}
      outlined={summary !== null && summary.decidingBoard === board}
      compact={arrangement === 'sideBySide'}
    />
  );

  const thumbOf = (board: BoardId) => {
    const place = boardOrientation(layout, board, match, autoFlip);
    const seatsOfBoard = [seatAt(board, 'w'), seatAt(board, 'b')] as const;
    return (
      <Pressable
        key={`thumb-${board}`}
        testID={`thumb-${board}`}
        accessibilityRole="button"
        accessibilityLabel={`Swap boards: show board ${board}`}
        style={styles.thumb}
        onPress={() => setSwapped((s) => !s)}
      >
        <BughouseBoard
          board={board}
          fen={match.boards[board].fen}
          promoted={match.boards[board].promoted}
          cell={BUGHOUSE_THUMB_CELL}
          orientation={place}
          lastMove={state.lastMove[board]}
          checkedSquare={null}
          selected={null}
          moveTargets={[]}
          dropTargets={[]}
          badgeOf={(color) => kingBadge(layout, board, color)}
          interactive={false}
          outlined={summary !== null && summary.decidingBoard === board}
        />
        <View style={styles.thumbInfo}>
          <Text style={styles.thumbTitle}>{board === mainBoardOf(layout) ? 'Your board' : `Board ${board}`}</Text>
          {seatsOfBoard.map((seat) => {
            const word = seatPlace(seat).color === 'w' ? 'white' : 'black';
            const chips = pocketChips(match, seat, null);
            return (
              <Text key={seat} style={styles.thumbLine} testID={`thumb-line-${board}-${word}`}>
                {`${word === 'white' ? '○' : '●'} ${seatName(seat)}  ${formatBughouseClock(remainingAt(match.clocks[seat], nowMs))}${chips.length ? `  ${chips.map((c) => `${c.piece.toUpperCase()}${c.count}`).join(' ')}` : ''}`}
              </Text>
            );
          })}
          <Text style={styles.thumbStatus}>{boardStatusLine(match, board, false).text}</Text>
          <Text style={styles.thumbHint}>Tap to swap</Text>
        </View>
      </Pressable>
    );
  };

  const turnBanner =
    layout.kind === 'passAndPlay' && match.result === null ? (
      <Text style={styles.banner} testID="turn-banner">
        {match.verdicts[layout.board].turn === 'w' ? 'White' : 'Black'} to move
      </Text>
    ) : null;

  const blockedLayout = layout.kind === 'dual' || layout.kind === 'none';

  // Two equal boards side by side leave no height to spare (BUGHOUSE_SPEC.md 5.6: a compact header), so there the menu link, the title and the controls share ONE slim bar.
  const compact = arrangement === 'sideBySide' && !blockedLayout;
  const controls = (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="Rules" testID="bughouse-rules" style={styles.control} onPress={() => setRulesOpen(true)}>
        <Text style={styles.controlText}>Rules</Text>
      </Pressable>
      {layout.kind === 'passAndPlay' && (
        <Pressable accessibilityRole="button" accessibilityLabel={autoFlip ? 'Auto-turn is on' : 'Auto-turn is off'} testID="bughouse-autoflip" style={styles.control} onPress={() => setAutoFlip((a) => !a)}>
          <Text style={styles.controlText}>{autoFlip ? 'Auto-turn: on' : 'Auto-turn: off'}</Text>
        </Pressable>
      )}
      <Pressable accessibilityRole="button" accessibilityLabel="Resign" testID="bughouse-resign" style={styles.control} onPress={resign} disabled={over}>
        <Text style={styles.controlText}>Resign</Text>
      </Pressable>
    </>
  );

  return (
    <View style={styles.container} testID="bughouse-game">
      {compact ? (
        <View style={styles.compactBar} testID="bughouse-compact-bar">
          <Pressable accessibilityRole="button" accessibilityLabel="Back to the menu" onPress={onExit} style={styles.compactBack}>
            <Text style={styles.controlText}>‹ Menu</Text>
          </Pressable>
          <Text style={styles.compactTitle}>{layout.kind === 'passAndPlay' ? 'Bughouse · pass and play' : 'Bughouse'}</Text>
          <View style={styles.compactControls}>{controls}</View>
        </View>
      ) : (
        <ScreenHeader title="Bughouse" subtitle={layout.kind === 'passAndPlay' ? 'Local · pass and play' : 'Local'} onBack={onExit} backLabel="‹ Menu" />
      )}
      <ScrollView contentContainerStyle={styles.content}>
        {!compact && <View style={styles.controls}>{controls}</View>}

        {blockedLayout ? (
          <Text style={styles.banner}>This seat setup is not available yet.</Text>
        ) : (
          <>
            {turnBanner}
            {arrangement === 'sideBySide' ? (
              <View style={styles.sideBySide} testID="layout-side-by-side">
                {BOARD_IDS.map((board) => blockOf(board, getBughouseSideCellSize(width, height)))}
              </View>
            ) : (
              <View style={styles.portrait} testID="layout-thumbnail">
                {blockOf(mainBoard, getBughouseMainCellSize(width, height))}
                {thumbOf(otherBoard(mainBoard))}
              </View>
            )}
          </>
        )}

        {summary !== null && (
          <View style={styles.gameOver} testID="game-over">
            <Text style={styles.gameOverTitle} testID="game-over-headline">
              {summary.headline}
            </Text>
            <Text style={styles.gameOverDetail} testID="game-over-detail">
              {summary.detail}
            </Text>
            <View style={styles.gameOverButtons}>
              <Pressable accessibilityRole="button" testID="bughouse-rematch" style={styles.primary} onPress={rematch}>
                <Text style={styles.primaryText}>Rematch</Text>
              </Pressable>
              <Pressable accessibilityRole="button" testID="bughouse-menu" style={styles.secondary} onPress={onExit}>
                <Text style={styles.secondaryText}>Back to menu</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>

      <PromotionPicker
        visible={promotion !== null}
        choices={promotion?.choices ?? []}
        buttonSize={56}
        labelFor={(p) => PROMOTION_LABELS[p]}
        renderChoice={(p) => <Text style={{ fontSize: 34 }}>{GLYPH[p]}</Text>}
        onChoose={choosePromotion}
        onCancel={() => setPromotion(null)}
      />
      <BughouseRulesSheet visible={rulesOpen} onClose={() => setRulesOpen(false)} />
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 8, gap: 8, alignItems: 'center' },
    controls: { flexDirection: 'row', gap: 8, alignSelf: 'stretch', justifyContent: 'center' },
    control: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    controlText: { fontSize: 14, fontWeight: '700', color: colors.text },
    compactBar: { height: 36, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8 },
    compactBack: { paddingVertical: 4, paddingHorizontal: 6 },
    compactTitle: { flex: 1, fontSize: 16, fontWeight: '800', color: colors.text },
    compactControls: { flexDirection: 'row', gap: 8 },
    banner: { fontSize: 16, fontWeight: '800', color: colors.text, textAlign: 'center' },
    portrait: { alignItems: 'center', gap: 8, alignSelf: 'stretch' },
    sideBySide: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', justifyContent: 'center' },
    thumb: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignSelf: 'stretch' },
    thumbInfo: { flex: 1, gap: 2 },
    thumbTitle: { fontSize: 13, fontWeight: '800', color: colors.text },
    thumbLine: { fontSize: 12, color: colors.text },
    thumbStatus: { fontSize: 12, color: colors.textSecondary },
    thumbHint: { fontSize: 11, color: colors.textSecondary },
    gameOver: { alignSelf: 'stretch', padding: 14, gap: 6, alignItems: 'center', borderRadius: 12, borderWidth: 2, borderColor: colors.gold, backgroundColor: colors.surface },
    gameOverTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
    gameOverDetail: { fontSize: 14, color: colors.textSecondary },
    gameOverButtons: { flexDirection: 'row', gap: 10, marginTop: 6 },
    primary: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, backgroundColor: colors.buttonBackground },
    primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    secondary: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
    secondaryText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  });
}
