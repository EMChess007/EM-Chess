import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Pressable } from '../components/AppPressable';
import Text from '../components/BughouseText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BughouseBoard from '../components/BughouseBoard';
import BughouseBoardBlock from '../components/BughouseBoardBlock';
import BughouseRulesSheet from '../components/BughouseRulesSheet';
import { getTouchDebugOverlay } from '../components/devOverlayRegistry';
import { pieceInk } from '../components/pieceArt';
import PieceIcon from '../components/PieceIcon';
import PromotionPicker from '../components/PromotionPicker';
import ScreenHeader from '../components/ScreenHeader';
import { firstLegalAction, legalMovesOn, remainingAt, type BughouseMatch, type BughouseTimeControl, type PromotionPiece } from '../logic/bughouse';
import { BOARD_IDS, otherBoard, seatAt, seatPlace, type BoardId, type BughouseSeat } from '../logic/bughouse/types';
import {
  BUGHOUSE_DUAL_GUTTER,
  BUGHOUSE_DUAL_MIN_CELL,
  BUGHOUSE_ROTATE_OVERLAY_DETAIL,
  BUGHOUSE_ROTATE_OVERLAY_TITLE,
  BUGHOUSE_THUMB_CELL,
  dualBoardPlan,
  fitStackedCell,
  deriveBughouseLayout,
  getBughouseDualCellSize,
  getBughouseMainCellSize,
  getBughouseSideCellSize,
  humanBughouseSeats,
  keepTogether,
  needsRotateOverlay,
  seatRowLabel,
  standardArrangement,
} from '../logic/bughouseLayout';
import { BUGHOUSE_FIXTURE_GLOBAL, fixtureMatch, readBughouseFixture } from '../logic/bughouseFixture';
import { bughouseBotThinkMs, dueBotSeats, localBotAction, localStep, nextDeadline, startLocalGame, type LocalGameState } from '../logic/bughouseLocal';
import { liveSelection, type BoardPosition, type SelectionInput } from '../logic/bughouseSelection';
import { boardOrientation, boardStatusLine, dropSquares, dualBoardOrientation, formatBughouseClock, gameOverSummary, kingBadge, mainBoardOf, pocketChips, touchSeat } from '../logic/bughouseView';
import { useBoardSelection } from '../components/useBoardSelection';
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

const PROMOTION_ORDER: readonly PromotionPiece[] = ['q', 'r', 'b', 'n'];

/**
 * Bughouse, Local (W3a): one human (its board large and the partner's a thumbnail, or two equal boards side by side in landscape) or several humans all on ONE board (pass-and-play: that
 * board turns to the side to move, only the side to move can touch). The match is the engine's; every action goes through its `settle` with ONE integer clock. Bots are the W2 bot.
 */
/** The hit slop of a slim control (28 dp tall): 8 dp above and below, 4 dp to the sides - a 44 dp touch area without the height. */
const SLIM_HIT_SLOP = { top: 8, bottom: 8, left: 4, right: 4 };

export default function BughouseGameScreen({ seats, timeControl, onExit, rng, clock, startFrom }: BughouseGameScreenProps) {
  const colors = useAppColors();
  const styles = createStyles(colors);
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The layouts are sized to the room the app really has: the window without the system bars and the display cutout (the status bar above, the gesture / navigation strip below, a cutout or the
  // navigation bar at the sides). Sized to the whole window, a phone with a status bar had boards and bars cut off at the bottom.
  const width = win.width - insets.left - insets.right;
  const height = win.height - insets.top - insets.bottom;
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
    // The device matrix's test-only fixture (bughouseFixture.ts): honoured on the web in a development build only, ignored (with one warning) anywhere else.
    const fixture = readBughouseFixture(typeof __DEV__ !== 'undefined' && __DEV__, Platform.OS, (globalThis as Record<string, unknown>)[BUGHOUSE_FIXTURE_GLOBAL]);
    const from = startFrom ?? (fixture !== null ? fixtureMatch(fixture, timeControl) : undefined);
    return from ? { ...fresh, match: from } : fresh;
  });
  const stateRef = useRef(state);
  const [nowMs, setNowMs] = useState(0);
  const [flagKick, setFlagKick] = useState(0);
  const [swapped, setSwapped] = useState(false);
  const [autoFlip, setAutoFlip] = useState(true);
  const [rulesOpen, setRulesOpen] = useState(false);
  // DEV ONLY (a development build): the touch-debug overlay, switched on from the controls. A release build has neither the switch nor the overlay's code (BughouseBoard).
  const devTouchDebug = typeof __DEV__ !== 'undefined' && __DEV__ && getTouchDebugOverlay() !== null;
  const [touchDebug, setTouchDebug] = useState(false);
  const [scrollViewportHeight, setScrollViewportHeight] = useState(0);
  const [scrollContentHeight, setScrollContentHeight] = useState(0);
  const contentOverflows = scrollViewportHeight > 0 && scrollContentHeight > scrollViewportHeight + 1;
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
  // Humans on both boards (W3b): the half-made action of each board lives in a reducer instance of its own (two hooks, one per board; a board's handlers only ever see theirs).
  const selectionA = useBoardSelection('A');
  const selectionB = useBoardSelection('B');

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

  // --- Humans on both boards (W3b): each board's taps go to ITS reducer only ------------------------------------------------------------------
  const positionOf = (current: BughouseMatch, board: BoardId): BoardPosition => {
    let moves: ReturnType<typeof legalMovesOn> | null = null;
    const all = () => (moves ??= legalMovesOn(current, board));
    return {
      fen: current.boards[board].fen,
      active: touchSeat(seats, current, board) !== null,
      movesFrom: (square) => all().filter((m) => m.from === square),
      dropSquares: (piece) => dropSquares(current, board, piece),
    };
  };
  const selectionOf = (board: BoardId) => (board === 'A' ? selectionA : selectionB);
  /** One input of one board: through that board's reducer, and a completed selection to the engine's funnel. Reads the LATEST match, so a tap that lands before a re-render is still right. */
  const dualInput = (board: BoardId, input: SelectionInput) => {
    const current = stateRef.current.match;
    const actor = touchSeat(seats, current, board);
    if (actor === null) return;
    const done = selectionOf(board).apply(input, positionOf(current, board));
    if (done === null) return;
    if (done.kind === 'move') commit({ seat: actor, action: { kind: 'move', board: done.board, from: done.from, to: done.to, promotion: done.promotion } });
    else commit({ seat: actor, action: { kind: 'drop', board: done.board, piece: done.piece, square: done.square } });
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

  const dual = layout.kind === 'dual';
  const dualFit = getBughouseDualCellSize(width, height);
  // The stacked boards are sized from the room the scroll view REALLY has (fitStackedCell): the table's chrome constant is a calibration, not a measurement. `cellAdjust` is whole cells on top of
  // the table, 0 until the first measurement and again whenever the window changes. A measurement is only used with the cell it was taken at (`measured.cell`), so a stale one cannot make
  // the boards step twice; once the game is over the result card joins the content and the boards keep their size.
  const [cellAdjust, setCellAdjust] = useState(0);
  const [measured, setMeasured] = useState<{ cell: number; content: number } | null>(null);
  const stacked = dual && dualFit.arrangement === 'stacked';
  const dualCell = Math.max(stacked ? dualFit.cell + cellAdjust : dualFit.cell, 1);
  const renderedCell = useRef(dualCell);
  renderedCell.current = dualCell;
  useEffect(() => {
    setCellAdjust(0);
    setMeasured(null);
  }, [width, height, stacked]);
  useEffect(() => {
    if (!stacked || over || measured === null || measured.cell !== dualCell || scrollViewportHeight <= 0) return;
    const next = fitStackedCell(dualCell, scrollViewportHeight, measured.content, Math.floor((width - 16) / 8), Math.min(dualFit.cell, BUGHOUSE_DUAL_MIN_CELL));
    if (next !== dualCell) setCellAdjust(next - dualFit.cell);
  }, [stacked, over, measured, dualCell, scrollViewportHeight, width, dualFit.cell]);
  /** What board `board` shows of its OWN reducer instance (dual layout): the picked piece, its targets, the picked chip, a promotion waiting. */
  const dualViewOf = (board: BoardId) => {
    const position = positionOf(match, board);
    const live = liveSelection(selectionOf(board).selection, position);
    return {
      selected: live.selected ? live.selected.square : null,
      moveTargets: live.selected ? Array.from(new Set(position.movesFrom(live.selected.square).map((m) => m.to))) : [],
      dropTargets: live.picked ? position.dropSquares(live.picked.piece) : [],
      picked: live.picked ? live.picked.piece : null,
      promotionChoices: live.promotion ? live.promotion.choices : undefined,
    };
  };

  const blockOf = (board: BoardId, cell: number) => {
    const own = dual ? dualViewOf(board) : null;
    return (
      <BughouseBoardBlock
        key={board}
        board={board}
        match={match}
        nowMs={nowMs}
        orientation={dual ? dualBoardOrientation(seats, board, match, autoFlip) : boardOrientation(layout, board, match, autoFlip)}
        cell={cell}
        lastMove={state.lastMove[board]}
        seatName={seatName}
        badgeOf={(color) => kingBadge(layout, board, color)}
        actor={actors[board]}
        selected={own ? own.selected : selected && selected.board === board ? selected.square : null}
        moveTargets={own ? own.moveTargets : selected && selected.board === board ? selectedTargets : []}
        dropTargets={own ? own.dropTargets : picked && picked.board === board ? dropTargetsOfPick : []}
        pickedPiece={own ? own.picked : picked && picked.board === board ? picked.piece : null}
        bank={state.bank}
        statusYou={layout.kind === 'standard' ? seatAt(board, match.verdicts[board].turn) === layout.seat : actors[board] !== null}
        onTapSquare={dual ? (tapped, square) => dualInput(tapped, { kind: 'tapSquare', square }) : onTapSquare}
        onPickPocket={dual ? (tapped, piece) => dualInput(tapped, { kind: 'pickPocket', piece }) : onPickPocket}
        outlined={summary !== null && summary.decidingBoard === board}
        compact={dual || arrangement === 'sideBySide'}
        sideBySide={dual ? dualFit.arrangement === 'sideBySide' : arrangement === 'sideBySide'}
        rawTouch={dual}
        touchDebug={devTouchDebug && touchDebug}
        shared={dual && match.result === null && dualBoardPlan(seats, board).shared}
        promotionChoices={own ? own.promotionChoices : undefined}
        onPromotionChoice={(chosen, choice) => dualInput(chosen, choice === 'cancel' ? { kind: 'cancelPromotion' } : { kind: 'choosePromotion', piece: choice })}
      />
    );
  };

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

  const blockedLayout = layout.kind === 'none';

  // Two equal boards side by side leave no height to spare (BUGHOUSE_SPEC.md 5.6: a compact header), so there the menu link, the title and the controls share ONE slim bar.
  // The dual layouts (both boards stacked, or side by side) are tight in BOTH arrangements: one slim bar, slim controls, compact blocks.
  const compact = (dual || arrangement === 'sideBySide') && !blockedLayout;
  // Side by side there is no height for a second row, so the controls share the bar; stacked (portrait) the bar holds only the menu link and the title - four controls (Rules, turn, two Resign)
  // do not fit beside them at 360 px - and the controls sit in a slim row of their own, which the stacked boards have the height for (checked in the browser at 360 x 740).
  const controlsInBar = compact && (dual ? dualFit.arrangement === 'sideBySide' : true);
  const ctl = dual ? styles.controlSlim : styles.control;
  // The dual layouts are as tall as the window allows (the spec's cell table): their controls stay slim and reach the 44 dp touch target with hit slop (8 dp above and below a 28 dp control).
  // `compact` opts out of AppPressable's 44 dp floor (components/AppPressable.tsx; bughouseCompact.dom.test.tsx pins that it takes effect).
  const slim: object = dual ? { compact: true, hitSlop: SLIM_HIT_SLOP } : {};
  const ctlText = dual ? styles.controlTextSlim : styles.controlText;
  const hasSharedBoard = dual && BOARD_IDS.some((board) => dualBoardPlan(seats, board).shared);
  // Humans on both boards: who resigns is a TEAM matter (any seat's resignation ends the match against its team); one button per team that has a human at the device.
  const resignTeams = ([1, 2] as const).filter((team) => humans.some((seat) => seatPlace(seat).team === team));
  const resignTeam = (team: 1 | 2) => {
    const seat = humans.find((s) => seatPlace(s).team === team);
    if (seat !== undefined && match.result === null) commit({ seat, action: { kind: 'resign' } });
  };
  const controls = (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="Rules" testID="bughouse-rules" style={ctl} onPress={() => setRulesOpen(true)} {...slim}>
        <Text style={ctlText}>Rules</Text>
      </Pressable>
      {(layout.kind === 'passAndPlay' || hasSharedBoard) && (
        <Pressable accessibilityRole="button" accessibilityLabel={autoFlip ? 'Auto-turn is on' : 'Auto-turn is off'} testID="bughouse-autoflip" style={ctl} onPress={() => setAutoFlip((a) => !a)} {...slim}>
          <Text style={ctlText}>{dual ? (autoFlip ? 'Turn: auto' : 'Turn: fixed') : autoFlip ? 'Auto-turn: on' : 'Auto-turn: off'}</Text>
        </Pressable>
      )}
      {devTouchDebug && dual && (
        <Pressable accessibilityRole="button" accessibilityLabel={touchDebug ? 'Touch debug is on' : 'Touch debug is off'} testID="bughouse-touch-debug" style={ctl} onPress={() => setTouchDebug((on) => !on)} {...slim}>
          <Text style={ctlText}>{touchDebug ? 'Touch debug: on' : 'Touch debug: off'}</Text>
        </Pressable>
      )}
      {dual ? (
        resignTeams.map((team) => (
          <Pressable key={team} accessibilityRole="button" accessibilityLabel={`Team ${team} resigns`} testID={`bughouse-resign-team-${team}`} style={ctl} onPress={() => resignTeam(team)} disabled={over} {...slim}>
            <Text style={ctlText}>{keepTogether(`Resign ${team === 1 ? '◆' : '●'} Team ${team}`)}</Text>
          </Pressable>
        ))
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="Resign" testID="bughouse-resign" style={ctl} onPress={resign} disabled={over} {...slim}>
          <Text style={ctlText}>Resign</Text>
        </Pressable>
      )}
    </>
  );
  // Local has no pause: below the minimum the boards are covered, and the clocks keep running (5.6).
  const rotateOverlay = !over && needsRotateOverlay(seats, width, height);

  return (
    <View style={styles.container} testID="bughouse-game">
      {compact ? (
        <View style={[styles.compactBar, { paddingTop: insets.top }]} testID="bughouse-compact-bar">
          {/* Slim like the controls beside it (28 dp + hit slop = 44 dp): with AppPressable's 44 dp floor the bar grew by 8 dp and two boards side by side no longer fitted a 360 dp high window. */}
          <Pressable accessibilityRole="button" accessibilityLabel="Back to the menu" onPress={onExit} style={styles.compactBack} compact hitSlop={SLIM_HIT_SLOP}>
            <Text style={styles.controlText}>‹ Menu</Text>
          </Pressable>
          <Text style={styles.compactTitle}>
            {layout.kind === 'passAndPlay' ? 'Bughouse · pass and play' : 'Bughouse'}
          </Text>
          {controlsInBar && <View style={styles.compactControls}>{controls}</View>}
        </View>
      ) : (
        <ScreenHeader title="Bughouse" subtitle={layout.kind === 'passAndPlay' ? 'Local · pass and play' : 'Local'} onBack={onExit} backLabel="‹ Menu" />
      )}
      <ScrollView
        contentContainerStyle={styles.content}
        // The two-board layouts do not scroll while everything fits (a scroll view could take a touch from a board); they DO when the content is taller than the window - large text or a
        // wide font wraps a control row onto a second line - so nothing is ever cut off (Android device matrix).
        scrollEnabled={!dual || over || contentOverflows}
        onLayout={(e) => setScrollViewportHeight(e.nativeEvent.layout.height)}
        onContentSizeChange={(_w, h) => {
          setScrollContentHeight(h);
          setMeasured({ cell: renderedCell.current, content: h });
        }}
      >
        {!controlsInBar && <View style={styles.controls}>{controls}</View>}

        {blockedLayout ? (
          <Text style={styles.banner}>This seat setup is not available yet.</Text>
        ) : dual ? (
          <View style={dualFit.arrangement === 'sideBySide' ? styles.dualRow : styles.dualColumn} testID={dualFit.arrangement === 'sideBySide' ? 'layout-dual-side-by-side' : 'layout-dual-stacked'}>
            {BOARD_IDS.map((board) => blockOf(board, dualCell))}
          </View>
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
        renderChoice={(p) => <PieceIcon type={p} ink={pieceInk(promotion ? match.verdicts[promotion.board].turn : 'w')} size={40} />}
        onChoose={choosePromotion}
        onCancel={() => setPromotion(null)}
      />
      <BughouseRulesSheet visible={rulesOpen} onClose={() => setRulesOpen(false)} />
      {rotateOverlay && (
        // Over everything, touches included: the boards under it cannot be touched while it shows.
        <View style={styles.overlay} testID="rotate-overlay" accessibilityViewIsModal accessibilityLabel={BUGHOUSE_ROTATE_OVERLAY_TITLE}>
          <Text style={styles.overlayTitle}>{BUGHOUSE_ROTATE_OVERLAY_TITLE}</Text>
          <Text style={styles.overlayDetail}>{BUGHOUSE_ROTATE_OVERLAY_DETAIL}</Text>
        </View>
      )}
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 8, gap: 8, alignItems: 'center' },
    controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignSelf: 'stretch', justifyContent: 'center' },
    control: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    controlText: { fontSize: 14, fontWeight: '700', color: colors.text },
    controlSlim: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    controlTextSlim: { fontSize: 13, fontWeight: '700', color: colors.text },
    compactBar: { minHeight: 36, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, paddingHorizontal: 8 },
    compactBack: { paddingVertical: 4, paddingHorizontal: 6 },
    compactTitle: { flexGrow: 1, flexShrink: 1, minWidth: 0, fontSize: 16, fontWeight: '800', color: colors.text },
    compactControls: { flexDirection: 'row', flexWrap: 'wrap', flexShrink: 1, justifyContent: 'flex-end', gap: 6 },
    banner: { fontSize: 16, fontWeight: '800', color: colors.text, textAlign: 'center' },
    portrait: { alignItems: 'center', gap: 8, alignSelf: 'stretch' },
    sideBySide: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', justifyContent: 'center' },
    // humans on both boards: the gap between the boards is a dead zone for touches (BUGHOUSE_DUAL_GUTTER)
    dualColumn: { alignItems: 'center', gap: BUGHOUSE_DUAL_GUTTER, alignSelf: 'stretch' },
    dualRow: { flexDirection: 'row', gap: BUGHOUSE_DUAL_GUTTER, alignItems: 'flex-start', justifyContent: 'center' },
    overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, gap: 8, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.88)' },
    overlayTitle: { fontSize: 22, fontWeight: '800', color: '#fff', textAlign: 'center' },
    overlayDetail: { fontSize: 15, color: '#ddd', textAlign: 'center' },
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
