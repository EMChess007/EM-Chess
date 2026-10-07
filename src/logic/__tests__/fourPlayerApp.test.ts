import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allHumansConfig,
  defaultViewSeat,
  describeController,
  describeEvents,
  getFourPlayerCellSize,
  humanSeats,
  isStartable,
  oneHumanConfig,
  shortController,
  withController,
  type GameEvent,
  type SeatConfig,
} from '../fourPlayer';

const SRC = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');

describe('seat setup', () => {
  it('presets: one human (Red) + three bots, or four humans', () => {
    const one = oneHumanConfig('hard');
    expect(one.map((c) => c.kind)).toEqual(['human', 'bot', 'bot', 'bot']);
    expect(one[1]).toEqual({ kind: 'bot', level: 'hard' });
    expect(allHumansConfig().map((c) => c.kind)).toEqual(['human', 'human', 'human', 'human']);
    expect(humanSeats(one)).toEqual([0]);
    expect(humanSeats(allHumansConfig())).toEqual([0, 1, 2, 3]);
  });

  it('withController returns a new config and leaves the original untouched', () => {
    const base = oneHumanConfig('easy');
    const changed = withController(base, 2, { kind: 'human' });
    expect(changed).not.toBe(base);
    expect(base[2]).toEqual({ kind: 'bot', level: 'easy' });
    expect(changed[2]).toEqual({ kind: 'human' });
    expect(humanSeats(changed)).toEqual([0, 2]);
  });

  it('a game needs at least one human; the board starts from the only human\'s seat, otherwise Red\'s', () => {
    const allBots: SeatConfig = [{ kind: 'bot', level: 'easy' }, { kind: 'bot', level: 'easy' }, { kind: 'bot', level: 'easy' }, { kind: 'bot', level: 'easy' }];
    expect(isStartable(allBots)).toBe(false);
    expect(isStartable(oneHumanConfig())).toBe(true);
    expect(defaultViewSeat(withController(allBots, 2, { kind: 'human' }))).toBe(2); // the sole human is Yellow
    expect(defaultViewSeat(allHumansConfig())).toBe(0);
    expect(defaultViewSeat(oneHumanConfig())).toBe(0);
  });

  it('labels', () => {
    expect(describeController({ kind: 'human' })).toBe('Human');
    expect(describeController({ kind: 'bot', level: 'medium' })).toBe('Bot (medium)');
    expect(shortController({ kind: 'bot', level: 'medium' })).toBe('Bot med');
    expect(shortController({ kind: 'human' })).toBe('Human');
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

  it('the square size fills the width on a phone, shrinks for short screens, and never exceeds 34', () => {
    expect(getFourPlayerCellSize(390, 760)).toBe(26);
    expect(getFourPlayerCellSize(360, 640)).toBe(22); // the height budget wins
    expect(getFourPlayerCellSize(320, 480)).toBe(20); // never below 20
    expect(getFourPlayerCellSize(1200, 1000)).toBe(34); // a desktop window
  });
});

describe('isolation and wiring (no React Native renderer available)', () => {
  const engineFiles = readdirSync(join(SRC, 'logic/fourPlayer')).filter((name) => name.endsWith('.ts'));

  it('the engine folder imports only from itself: no React, no React Native, no chess.js, no ChessEngine, nothing else in the app', () => {
    expect(engineFiles.length).toBeGreaterThanOrEqual(8);
    for (const name of engineFiles) {
      const text = read(`logic/fourPlayer/${name}`);
      const imports = [...text.matchAll(/^\s*(?:import|export)[^'"\n]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
      for (const source of imports) expect(source.startsWith('./'), `${name} imports ${source}`).toBe(true);
    }
  });

  it('it is a mode of its own: no 2-player variant plumbing mentions it (selector, outcome, payload, online flags, bots, history)', () => {
    for (const file of ['components/VariantSelector.tsx', 'logic/gameResult.ts', 'logic/gamePayload.ts', 'logic/onlineVariants.ts', 'logic/bots.ts', 'types/history.ts', 'types/multiplayer.ts', 'logic/ChessEngine.ts']) {
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

  it('App.tsx routes setup -> game with the seat config, and Back/Menu return to the play menu', () => {
    const app = readFileSync(join(SRC, '../App.tsx'), 'utf8').replace(/\r\n/g, '\n');
    expect(app).toContain("{ name: 'fourPlayerSetup' }");
    expect(app).toContain("{ name: 'fourPlayerGame'; seats: SeatConfig }");
    expect(app).toContain("onFourPlayer={() => setScreen({ name: 'fourPlayerSetup' })}");
    expect(app).toContain("setScreen({ name: 'fourPlayerGame', seats })");
    expect(app).toMatch(/<FourPlayerGameScreen seats=\{screen\.seats\} onExit=\{\(\) => setScreen\(\{ name: 'playModeSelect' \}\)\} \/>/);
  });

  it('the game screen plays bots through the engine (never Stockfish), uses Undo snapshots and resign through the engine', () => {
    const game = read('screens/FourPlayerGameScreen.tsx');
    expect(game).toContain('chooseBotMove(game, controller.level)');
    expect(game).toContain('playMove(game, move)');
    expect(game).toContain('resign(game, seat)');
    expect(game).not.toMatch(/stockfish|Engine\b.*getBestMove|engineRuntime/i);
    // Undo returns to the most recent position in which a human was to move.
    expect(game).toContain("seats[past[i].state.turn].kind === 'human'");
  });

  it('the board is drawn from the engine state: rotation is a render-only transform, and the 36 corner cells are not pressable', () => {
    const board = read('components/FourPlayerBoard.tsx');
    expect(board).toContain('fromDisplay(dx, dy, viewSeat)');
    expect(board).toContain('if (!VALID[square])');
    expect(board).toContain('currentMoves(state)'); // legal squares come from the engine, not recomputed in the component
  });
});
