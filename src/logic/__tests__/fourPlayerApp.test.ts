import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOT_PERSONALITIES } from '../bots';
import {
  DEFAULT_BOT_ELO,
  defaultSeatConfig,
  defaultViewSeat,
  describeController,
  describeEvents,
  describeResultReason,
  formatSeatClock,
  getFourPlayerCellSize,
  humanSeats,
  isStartable,
  seatPieceImageKey,
  shortController,
  withController,
  type GameEvent,
  type SeatConfig,
} from '../fourPlayer';
import { AVAILABLE_PIECE_THEMES } from '../pieceThemes';
import { botDisplayName, controllerForBot, controllerName, rosterBotForElo } from '../fourPlayerBots';

const SRC = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');

const allBotsConfig = (): SeatConfig => [{ kind: 'bot', elo: 400 }, { kind: 'bot', elo: 400 }, { kind: 'bot', elo: 400 }, { kind: 'bot', elo: 400 }];

describe('seat setup', () => {
  it('starts as Red = human, the other three = the default roster bot (Amateur, 1200)', () => {
    const config = defaultSeatConfig();
    expect(config.map((c) => c.kind)).toEqual(['human', 'bot', 'bot', 'bot']);
    expect(config[1]).toEqual({ kind: 'bot', elo: DEFAULT_BOT_ELO });
    expect(DEFAULT_BOT_ELO).toBe(1200);
    expect(botDisplayName(DEFAULT_BOT_ELO)).toBe('Amateur');
    expect(humanSeats(config)).toEqual([0]);
    expect(defaultSeatConfig(2600)[3]).toEqual({ kind: 'bot', elo: 2600 });
  });

  it('withController returns a new config and leaves the original untouched', () => {
    const base = defaultSeatConfig(800);
    const changed = withController(base, 2, { kind: 'human' });
    expect(changed).not.toBe(base);
    expect(base[2]).toEqual({ kind: 'bot', elo: 800 });
    expect(changed[2]).toEqual({ kind: 'human' });
    expect(humanSeats(changed)).toEqual([0, 2]);
  });

  it("a game needs at least one human; the board starts from the only human's seat, otherwise Red's", () => {
    const allBots: SeatConfig = [{ kind: 'bot', elo: 400 }, { kind: 'bot', elo: 400 }, { kind: 'bot', elo: 400 }, { kind: 'bot', elo: 400 }];
    expect(isStartable(allBots)).toBe(false);
    expect(isStartable(defaultSeatConfig())).toBe(true);
    expect(defaultViewSeat(withController(allBots, 2, { kind: 'human' }))).toBe(2); // the sole human is Yellow
    const hotseat = withController(withController(defaultSeatConfig(), 1, { kind: 'human' }), 3, { kind: 'human' });
    expect(defaultViewSeat(hotseat)).toBe(0);
    // Two humans who are not Red: still Red-at-bottom, not whichever human happens to come first.
    const blueAndGreen = withController(withController(allBotsConfig(), 1, { kind: 'human' }), 3, { kind: 'human' });
    expect(defaultViewSeat(blueAndGreen)).toBe(0);
    expect(defaultViewSeat(defaultSeatConfig())).toBe(0);
  });

  it('labels', () => {
    expect(describeController({ kind: 'human' })).toBe('Human');
    expect(describeController({ kind: 'bot', elo: 1400 })).toBe('Bot (ELO 1400)');
    expect(shortController({ kind: 'bot', elo: 1400 })).toBe('Bot 1400');
    expect(shortController({ kind: 'human' })).toBe('Human');
  });
});

describe('the bot roster is the app\'s ONE roster (not a copy)', () => {
  it('every roster bot maps to a seat controller carrying its ELO, and back to its name', () => {
    expect(BOT_PERSONALITIES).toHaveLength(14);
    for (const bot of BOT_PERSONALITIES) {
      expect(controllerForBot(bot)).toEqual({ kind: 'bot', elo: bot.elo });
      expect(rosterBotForElo(bot.elo)).toBe(bot);
      expect(botDisplayName(bot.elo)).toBe(bot.name);
      expect(controllerName({ kind: 'bot', elo: bot.elo })).toBe(bot.name);
    }
    expect(botDisplayName(400)).toBe('Kiddo');
    expect(botDisplayName(3000)).toBe('The Unbeatable');
    expect(controllerName({ kind: 'human' })).toBe('Human');
    expect(botDisplayName(1234)).toBe('ELO 1234'); // not on the roster: still shown honestly
  });

  it('the setup screen offers the shared BotSelectScreen (no duplicated list): no bot names, no fixed tiers, no presets', () => {
    const setup = read('screens/FourPlayerSetupScreen.tsx');
    for (const bot of BOT_PERSONALITIES) expect(setup, bot.name).not.toContain(`'${bot.name}'`);
    expect(setup).not.toMatch(/Easy|Medium|Hard|BOT_LEVELS|BotLevel/);
    expect(setup).not.toMatch(/1 human \+ 3 bots|4 humans|oneHumanConfig|allHumansConfig|presetRow|presetButton/);
    expect(setup).toContain('onPickBot(seat)');
    const app = readFileSync(join(SRC, '../App.tsx'), 'utf8').replace(/\r\n/g, '\n');
    expect(app).toContain("{ name: 'fourPlayerBotSelect'; seats: SeatConfig; seat: Seat }");
    expect(app).toMatch(/<BotSelectScreen\s+subtitle=\{`4 Player Chess · \$\{SEAT_NAMES\[seat\]\}`\}\s+engineLabel="4 Player Chess bot"/);
    expect(app).toContain('withController(seats, seat, controllerForBot(bot))');
  });

  it('BotSelectScreen only gained optional props: its engine labels and custom-engine section are unchanged unless engineLabel is given', () => {
    const screen = read('screens/BotSelectScreen.tsx');
    expect(screen).toContain('subtitle={subtitle ?? variantName}');
    expect(screen).toContain('{engineLabel ?? (atomic ?');
    expect(screen).toContain('{customEngines.length > 0 && !engineLabel && (');
    expect(screen).toContain('BOT_CATEGORIES.map(');
  });
});

describe('the time-control step', () => {
  it('goes after seat setup and before the game, reusing TimeControlSelectScreen with Daily left out', () => {
    const app = readFileSync(join(SRC, '../App.tsx'), 'utf8').replace(/\r\n/g, '\n');
    expect(app).toContain("{ name: 'fourPlayerTimeControl'; seats: SeatConfig }");
    expect(app).toContain("{ name: 'fourPlayerGame'; seats: SeatConfig; timeControl: TimeControl }");
    expect(app).toContain("onContinue={() => setScreen({ name: 'fourPlayerTimeControl', seats })}");
    expect(app).toContain("excludeCategories={['daily']}");
    expect(app).toContain("setScreen({ name: 'fourPlayerGame', seats, timeControl })");
    expect(app).toContain('<FourPlayerGameScreen seats={screen.seats} timeControl={screen.timeControl}');
    const picker = read('screens/TimeControlSelectScreen.tsx');
    expect(picker).toContain('excludeCategories?: TimeControlCategory[];');
    expect(picker).toContain('TIME_CONTROL_CATEGORIES.filter(({ category }) => !excludeCategories.includes(category)).map(');
  });

  it('the preset list the picker shows is still Bullet / Blitz / Rapid / No time limit once Daily is removed', async () => {
    const { TIME_CONTROL_CATEGORIES } = await import('../timeControls');
    expect(TIME_CONTROL_CATEGORIES.filter(({ category }) => category !== 'daily').map((c) => c.label)).toEqual(['Bullet', 'Blitz', 'Rapid', 'No time limit']);
  });
});

describe('presentation helpers', () => {
  it('describeEvents narrates eliminations and frozen kings, and ignores ordinary moves', () => {
    const events: GameEvent[] = [
      { kind: 'move', seat: 0, move: { from: 1, to: 2, captured: 0, flags: 0 } },
      { kind: 'eliminated', seat: 1, reason: 'checkmate', credit: 0, points: [20, 0, 0, 0] },
      { kind: 'eliminated', seat: 3, reason: 'stalemate', credit: null, points: [10, 10, 10, 20] },
      { kind: 'eliminated', seat: 2, reason: 'resign', credit: null, points: [0, 0, 0, 0] },
      { kind: 'eliminated', seat: 2, reason: 'timeout', credit: null, points: [0, 0, 0, 0] },
      { kind: 'frozen', seat: 1 },
      { kind: 'deadKingMove', seat: 1, move: { from: 1, to: 2, captured: 0, flags: 0 } },
    ];
    expect(describeEvents(events)).toEqual([
      'Blue was checkmated by Red (+20)',
      'Green was stalemated (+20 to Green, +10 to the others)',
      'Yellow resigned',
      'Yellow ran out of time',
      "Blue's king can no longer move",
    ]);
  });

  it('the seat clock reads m:ss (h:mm:ss past an hour) and rounds UP, so a seat with any time left never shows 0:00', () => {
    expect(formatSeatClock(600)).toBe('10:00');
    expect(formatSeatClock(125)).toBe('2:05');
    expect(formatSeatClock(59.2)).toBe('1:00');
    expect(formatSeatClock(0.2)).toBe('0:01');
    expect(formatSeatClock(0)).toBe('0:00');
    expect(formatSeatClock(-3)).toBe('0:00');
    expect(formatSeatClock(3600)).toBe('1:00:00');
    expect(formatSeatClock(3725)).toBe('1:02:05');
  });

  it('the square size fills the width on a phone, shrinks for short screens, and never exceeds 34', () => {
    expect(getFourPlayerCellSize(390, 760)).toBe(26);
    expect(getFourPlayerCellSize(360, 640)).toBe(21); // the height budget wins (the seat cards take a little more room than a bare strip)
    expect(getFourPlayerCellSize(320, 480)).toBe(20); // never below 20
    expect(getFourPlayerCellSize(1200, 1000)).toBe(34); // a desktop window
  });
});

describe('the seat cards and the game screen (no React Native renderer available)', () => {
  it('each seat card shows name + score + remaining time together, plus who plays it, and the clock row disappears for "No time limit"', () => {
    const strip = read('components/FourPlayerSeatStrip.tsx');
    expect(strip).toContain('{SEAT_NAMES[seat]}');
    expect(strip).toContain('<Text style={styles.score}>{state.score[seat]}</Text>');
    expect(strip).toContain('{clock.enabled && <Text style={[styles.time');
    expect(strip).toContain('formatSeatClock(seconds)');
    expect(strip).toContain("{out ? 'out' : controllerName(seats[seat])}");
    expect(strip).toContain('state.turn === seat'); // the seat to move is highlighted
    expect(strip).toContain('out && styles.out'); // an eliminated seat is greyed (its clock is frozen)
  });

  it('the game screen runs the four clocks: ticks via the hook, increments for the mover only, timeouts adopted from the engine, clocks restored by Undo', () => {
    const game = read('screens/FourPlayerGameScreen.tsx');
    expect(game).toContain('useFourPlayerClock(timeControl, game, handleTimeout)');
    expect(game).toContain('setClock((c) => addIncrement(c, mover, game))');
    expect(game).toContain('setPast((p) => [...p, { state: game, clock, lastMove, log }]);');
    expect(game).toContain('setClock(past[i].clock);');
    expect(game).toContain('resetClock();');
    expect(game).toContain('<FourPlayerSeatStrip state={game} seats={seats} clock={clock} />');
    expect(game).toContain('chooseBotMove(game, controller.elo)');
  });

  it('regression: the bot effect must not depend on `apply` (which changes on every clock tick and would cancel the timer of the bot forever)', () => {
    const game = read('screens/FourPlayerGameScreen.tsx');
    expect(game).toContain('applyRef.current(move)');
    expect(game).toContain('}, [game, botToMove, controller, timeControl]);');
    expect(game).not.toContain('[game, botToMove, controller, apply');
  });

  it('the hook is the four-seat counterpart of useChessClock and only converts time through the pure model', () => {
    const hook = read('logic/useFourPlayerClock.ts');
    expect(hook).toContain('clockTick(gameRef.current, clockRef.current, elapsed)');
    expect(hook).toContain('hasLiveClock(timeControl.category)');
    expect(hook).toContain('const running = clock.enabled && !game.result;');
  });
});

describe('isolation and wiring (no React Native renderer available)', () => {
  const engineFiles = readdirSync(join(SRC, 'logic/fourPlayer')).filter((name) => name.endsWith('.ts'));

  it('the engine folder imports only from itself: no React, no React Native, no chess.js, no ChessEngine, nothing else in the app (the roster/clock glue lives outside it)', () => {
    expect(engineFiles.length).toBeGreaterThanOrEqual(9);
    expect(engineFiles).toContain('clock.ts');
    for (const name of engineFiles) {
      const text = read(`logic/fourPlayer/${name}`);
      const imports = [...text.matchAll(/^\s*(?:import|export)[^'"\n]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
      for (const source of imports) expect(source.startsWith('./'), `${name} imports ${source}`).toBe(true);
    }
  });

  it('it is a mode of its own: no 2-player variant plumbing mentions it (selector, outcome, payload, online flags, bots, history)', () => {
    for (const file of ['components/VariantSelector.tsx', 'logic/gameResult.ts', 'logic/gamePayload.ts', 'logic/onlineVariants.ts', 'logic/bots.ts', 'types/history.ts', 'types/multiplayer.ts', 'logic/ChessEngine.ts', 'logic/useChessClock.ts']) {
      expect(read(file), file).not.toMatch(/fourPlayer|FourPlayer|4 Player/);
    }
  });

  it('the games are neither rated, saved, nor given achievements in this pass', () => {
    const game = read('screens/FourPlayerGameScreen.tsx');
    for (const forbidden of ['recordRatedGame', 'unlockAchievement', 'buildGamePayload', 'gamePayload', 'saveGame', 'authToken']) expect(game, forbidden).not.toContain(forbidden);
  });

  it('PlayModeSelectScreen has a top-level "4 Player Chess" card with a Free-for-All button', () => {
    const menu = read('screens/PlayModeSelectScreen.tsx');
    expect(menu).toContain('onFourPlayer: () => void;');
    expect(menu).toContain('<Text style={styles.categoryTitle}>4 Player Chess</Text>');
    expect(menu).toContain('onPress={onFourPlayer}');
    expect(menu).toContain('label="Free-for-All"');
  });

  it('App.tsx starts setup with the default seats, and Back/Menu return one step / to the play menu', () => {
    const app = readFileSync(join(SRC, '../App.tsx'), 'utf8').replace(/\r\n/g, '\n');
    expect(app).toContain("onFourPlayer={() => setScreen({ name: 'fourPlayerSetup', seats: defaultSeatConfig() })}");
    expect(app).toContain("onBack={() => setScreen({ name: 'fourPlayerSetup', seats })}"); // from the bot picker and from the time control
    expect(app).toContain("onExit={() => setScreen({ name: 'playModeSelect' })} />");
  });

  it('the game screen plays bots through the engine (never Stockfish), with Undo snapshots and resign through the engine', () => {
    const game = read('screens/FourPlayerGameScreen.tsx');
    expect(game).toContain('playMove(game, move)');
    expect(game).toContain('resign(game, seat)');
    expect(game).not.toMatch(/stockfish|getBestMove|engineRuntime/i);
    expect(game).toContain("seats[past[i].state.turn].kind === 'human'"); // Undo returns to the most recent position in which a human was to move
  });

  it('the board is drawn from the engine state: rotation is a render-only transform, and the 36 corner cells are not pressable', () => {
    const board = read('components/FourPlayerBoard.tsx');
    expect(board).toContain('fromDisplay(dx, dy, viewSeat)');
    expect(board).toContain('if (!VALID[square])');
    expect(board).toContain('currentMoves(state)'); // legal squares come from the engine, not recomputed in the component
  });
});

describe('the piece theme on the 4 Player board', () => {
  it('every seat and piece type maps to a key every built-in image theme has (so no piece can fall back to nothing)', () => {
    const themes = AVAILABLE_PIECE_THEMES.filter((theme) => theme.images);
    expect(themes.length).toBeGreaterThanOrEqual(3);
    for (const theme of themes) {
      for (let seat = 0; seat < 4; seat++) {
        for (let type = 1; type <= 10; type++) expect(theme.images![seatPieceImageKey(seat, type)], `${theme.id} seat ${seat} type ${type}`).toBeTruthy();
      }
    }
  });

  it('the white set goes on the dark seats and the black set on Yellow; a promoted piece is drawn as the piece it became', () => {
    expect([0, 1, 2, 3].map((seat) => seatPieceImageKey(seat, 2))).toEqual(['wn', 'wn', 'bn', 'wn']);
    expect(seatPieceImageKey(0, 1)).toBe('wp');
    expect(seatPieceImageKey(2, 6)).toBe('bk');
    expect([7, 8, 9, 10].map((type) => seatPieceImageKey(1, type))).toEqual(['wq', 'wn', 'wb', 'wr']); // promoted Q, N, B, R
  });

  it('the board reads the SAME active piece theme the 2-player board does, keeps Classic on tinted glyphs, and marks promoted pieces', () => {
    const board = read('components/FourPlayerBoard.tsx');
    expect(board).toContain("import { useActiveBoardTheme, useActivePieceTheme } from '../logic/themeHooks';");
    expect(board).toContain('const pieceTheme = useActivePieceTheme();');
    expect(board).toContain('images={pieceTheme.images}');
    expect(board).toContain('images?.[seatPieceImageKey(seat, type)]'); // no image => the tinted glyph
    expect(board).toContain('isPromotedType(type)');
    expect(board).toContain('backgroundColor: dead ? DEAD_COLOR : SEAT_COLORS[seat]'); // eliminated seats are grey on themed pieces too
    expect(board).not.toMatch(/pieceSets|pieceThemes/); // it never reads theme data directly, only through the hook
  });
});

describe('promotion choice on the 4 Player board (no React Native renderer available)', () => {
  const board = read('components/FourPlayerBoard.tsx');

  it('reuses the shared picker the 2-player board uses, drawn in the picking seat\'s colour, instead of auto-queening', () => {
    expect(board).toContain("import PromotionPicker from './PromotionPicker';");
    expect(board).toContain('choices={PROMOTABLE_TYPES}');
    expect(board).toContain('visible={pendingPromotion !== null || pendingPremove !== null}'); // the same picker also serves a promoting premove
    expect(board).toContain('onChoose={completePromotion}');
    expect(board).toContain('seat={pickerSeat}');
    expect(board).toContain('seatOf(state.cells[pendingPromotion[0].from])'); // the seat that owns the pawn, not necessarily the viewer
    expect(read('components/ChessBoard.tsx')).toContain("import PromotionPicker from './PromotionPicker';"); // one picker, two boards
  });

  it('asks only when there is a choice, never moves before the player has chosen, and drops a half-made choice when the position changes', () => {
    expect(board).toContain('if (options.length > 1)');
    expect(board).toContain('setPendingPromotion(options); // a promotion: ask which piece');
    expect(board).toContain('if (pendingPromotion || pendingPremove) return;'); // nothing else is tappable while the picker is up
    expect(board).toContain('if (!interactive) return;'); // ...and no move without the turn
    expect(board).toContain('promotionOf(m) === pick');
    expect(board).toMatch(/setPendingPromotion\(null\);[\s\S]*?\}, \[state\]\)/);
    expect(board).not.toMatch(/QUEEN\)\s*\)?\s*onMove|onMove\([^)]*QUEEN/); // no hidden default pick
  });

  it('the notation shows what was chosen, and the game screen still receives one Move', () => {
    expect(read('screens/FourPlayerGameScreen.tsx')).toContain('onMove={apply}');
  });
});

describe('why a game ended', () => {
  it('has a line for each ending, including the dead position', () => {
    expect(describeResultReason('elimination')).toMatch(/eliminated/);
    expect(describeResultReason('cap')).toMatch(/Move limit/);
    expect(describeResultReason('deadPosition')).toMatch(/bare kings/);
    expect(read('screens/FourPlayerGameScreen.tsx')).toContain('describeResultReason(game.result.reason)');
  });
});

describe('arrows and premoves on the 4 Player board: shared code, wired in (no React Native renderer available)', () => {
  const importsOf = (text: string) => [...text.matchAll(/^\s*import[^'"\n]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);

  it('the gesture hook, annotation overlay, picker and premove step are SHARED: none of them knows about 4 Player Chess', () => {
    for (const file of ['components/useBoardGestures.ts', 'components/BoardAnnotations.tsx', 'components/PromotionPicker.tsx', 'logic/premove.ts', 'logic/usePremove.ts']) {
      for (const source of importsOf(read(file))) expect(source, `${file} imports ${source}`).not.toMatch(/fourPlayer|FourPlayer/);
    }
    // ...and the 2-player board uses the very same gesture hook and overlay (one implementation, two boards).
    const classic = read('components/ChessBoard.tsx');
    expect(classic).toContain("import { useBoardGestures } from './useBoardGestures';");
    expect(classic).toContain("import BoardAnnotations,");
    expect(classic).not.toMatch(/PanResponder.create|import {[^}]*PanResponder/); // the inline copy is gone
    expect(read('components/FourPlayerBoard.tsx')).toContain("import { useBoardGestures } from './useBoardGestures';");
    expect(read('components/FourPlayerBoard.tsx')).toContain("import BoardAnnotations from './BoardAnnotations';");
  });

  it('the gesture hook keeps the 2-player behaviour: the decision is the unit-tested pure one, a fresh measurement is awaited, termination is refused only mid-arrow', () => {
    const hook = read('components/useBoardGestures.ts');
    expect(hook).toContain("import { LONG_PRESS_MS, MOVE_THRESHOLD_PX, decideRelease, pixelToCell } from '../logic/boardGestures';");
    expect(hook).toContain('const decision = decideRelease({ armed, distance: Math.hypot(dx, dy), startCell, endCell: cell });');
    expect(hook).toContain('pendingMeasureRef.current.then((offset) => resolveRelease(offset, true));');
    expect(hook).toContain('onPanResponderTerminationRequest: () => !gestureRef.current?.armed,');
    expect(hook).toContain('evt.nativeEvent.pageX'); // page coordinates, never locationX
    expect(hook).not.toMatch(/nativeEvent.locationX/);
    expect(hook).toContain('pixelToCell(localX, localY, squareSize, rows, cols)'); // the grid it was given (8 or 14), not a hard-coded 8
    expect(read('logic/boardGestures.ts')).not.toMatch(/react-native|from 'react'/); // pure, so it can be unit-tested
  });

  it('BoardAnnotations still defaults to the 8 x 8 classic look and scales for smaller squares', () => {
    const overlay = read('components/BoardAnnotations.tsx');
    expect(overlay).toContain('rows = 8, cols = 8, scale = 1');
    expect(overlay).toContain('strokeWidth={6 * scale}');
    expect(read('components/ChessBoard.tsx')).not.toMatch(/<BoardAnnotations[^>]*\s(rows|cols|scale)=/); // the classic board passes nothing extra
  });

  it('the 4 Player board maps cells to squares through the view seat in ONE place each way, and stores annotations as squares', () => {
    const board = read('components/FourPlayerBoard.tsx');
    expect(board).toContain('gridToSquare(cell, viewSeat)');
    expect(board).toContain('squareToGrid(a.from, viewSeat)');
    expect(board).toContain('useState<readonly SquareArrow[]>([])');
    expect(board).toContain('rows={SIZE}');
    expect(board).toContain('cols={SIZE}');
    expect(board).toContain('enableAnnotations={enableAnnotations}'.replace('={enableAnnotations}', '')); // passed to the hook and the overlay
    expect(board).not.toContain('Pressable'); // taps come from the gesture hook; a Pressable per cell would steal the touches
  });

  it('premove mode: only while NOT interactive, with a premove seat, and never a legal-move preview; promotions ask for the piece', () => {
    const board = read('components/FourPlayerBoard.tsx');
    expect(board).toContain('const premoveMode = !interactive && premoveSeat !== undefined && onPremove !== undefined && canPremove(state, premoveSeat);');
    expect(board).toContain('const moves = useMemo(() => (interactive ? currentMoves(state) : []), [state, interactive]);'); // no targets while premoving
    expect(board).toContain('isPromotionPremove(state, premoveSeat, selected, square)');
    expect(board).toContain('onPremove?.({ from, to, promotion: pick });');
    // A position change (another seat moved) keeps a premove selection on the player's own piece instead of wiping it every ply.
    expect(board).toContain('prev !== null && premoveMode && isOwnPiece(prev) ? prev : null');
    expect(board).toContain('premoveMark={!!premove && (premove.from === square || premove.to === square)}');
    // Annotations follow the app-wide invariant (cleared when a move is played, never because of whose turn it is): see annotationLifecycle.test.ts.
    expect(board).toContain('useClearAnnotationsOnMove(positionEpoch(state), () => {');
  });

  it('the game screen has ONE premove slot (a new one replaces the old), validated by the engine, played through apply(), dropped on Undo / New Game', () => {
    const screen = read('screens/FourPlayerGameScreen.tsx');
    expect(screen).toContain('const myPremoveSeat = premoveSeat(seats);');
    expect(screen).toContain('play: apply,');
    expect(screen).toContain('resolvePremove(game, myPremoveSeat, intent)');
    expect(screen).toContain('canStillPlay: myPremoveSeat !== undefined && game.status[myPremoveSeat] === \'active\'');
    expect(screen).toContain('gameOver: !!game.result');
    expect(screen.match(/cancelPremove\(\);/g)?.length).toBe(2); // Undo and New Game
    expect(screen).toContain('describePremoveCancel(premoveCancelReason)');
    expect(screen).toContain('Premove queued: {describePremove(premove)}');
    const hook = read('logic/usePremove.ts');
    expect(hook).toContain('const [premove, setPremove] = useState<I | null>(null);'); // a single intent, not a list
    expect(hook).toContain('setPremove(intent);'); // queueing REPLACES
    expect(hook).not.toMatch(/\[\.\.\.prev|push\(|\.concat\(/); // never chains
    expect(hook).toContain('setCancelReason((reason) => noticeAfterTurnChange(reason, isMyTurn));'); // the notice lifecycle is the tested pure function
    expect(hook).toContain('if (step.reason) setCancelReason(step.reason);'); // a cancellation is always surfaced (except the silent game-over one)
  });

  it('the 2-player screens\' premove rules are unchanged (same notice text, same single slot)', () => {
    for (const file of ['screens/BotGameScreen.tsx', 'screens/OnlineGameScreen.tsx']) {
      const text = read(file);
      expect(text, file).toContain('Premove was no longer legal — cancelled.');
      expect(text, file).toContain('useState<PremoveIntent | null>(null)');
    }
  });
});
