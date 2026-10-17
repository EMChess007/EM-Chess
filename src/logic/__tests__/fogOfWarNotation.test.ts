import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChessEngine } from '../ChessEngine';
import { hideCheckFromPlayers, stripCheckSuffix } from '../fogOfWarNotation';

// Fog of War never tells a player about a check (chess.com). chess.js writes '+'/'#' into every SAN it produces, computed
// on the TRUE board, so a discovered check by a hidden piece reached the victim as "Nc3+" (and as a heavy haptic).
// movePseudoLegal now returns the SAN without the marker and the real one as `trueSan` (server-only: spectators, saved PGN).
// Server twin: backend/scripts/test-fogOfWarNotation.mjs.

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
const impactAsync = vi.fn(() => Promise.resolve());
vi.mock('expo-haptics', () => ({ impactAsync, ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' } }));

const fow = (fen: string) => new ChessEngine(fen, { skipValidation: true });
const REPRO = '4k3/6b1/8/8/4N3/8/8/4R1K1 w - - 0 1'; // Ne4-c3 uncovers the hidden rook e1: a discovered check on e8

describe('the helper', () => {
  it('strips one trailing + or # and keeps the original as trueSan', () => {
    expect(stripCheckSuffix('Nc3+')).toBe('Nc3');
    expect(stripCheckSuffix('Ra8#')).toBe('Ra8');
    expect(stripCheckSuffix('e8=Q+')).toBe('e8=Q');
    expect(stripCheckSuffix('O-O+')).toBe('O-O');
    expect(stripCheckSuffix('Nc3')).toBe('Nc3');
    expect(hideCheckFromPlayers({ san: 'Nc3+', from: 'e4' })).toEqual({ san: 'Nc3', trueSan: 'Nc3+', from: 'e4' });
  });

  it('leaves a move without a marker untouched (no trueSan key at all)', () => {
    const move = { san: 'Nc3', from: 'e4' };
    expect(hideCheckFromPlayers(move)).toBe(move);
    expect('trueSan' in hideCheckFromPlayers(move)).toBe(false);
  });
});

describe('Fog of War movePseudoLegal hides the check from the player', () => {
  it('the exact repro: a discovered check by a hidden rook arrives as "Nc3", the real notation is kept in trueSan', () => {
    const move = fow(REPRO).movePseudoLegal('e4', 'c3');
    expect(move?.san).toBe('Nc3');
    expect(move?.trueSan).toBe('Nc3+');
  });

  it.each([
    ['a direct check', '4k3/8/8/8/8/8/8/R3K3 w Q - 0 1', 'a1', 'a8', 'Ra8', 'Ra8+'],
    ['a checkmate', '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'a1', 'a8', 'Ra8', 'Ra8#'],
    ['a promotion with check', '7k/4P3/8/8/8/8/8/6K1 w - - 0 1', 'e7', 'e8', 'e8=Q', 'e8=Q+'],
    ['a castle that gives check', '5k2/8/8/8/8/8/8/4K2R w K - 0 1', 'e1', 'g1', 'O-O', 'O-O+'],
  ])('%s', (_name, fen, from, to, san, trueSan) => {
    const move = fow(fen).movePseudoLegal(from, to, from === 'e7' ? 'q' : undefined);
    expect(move?.san).toBe(san);
    expect(move?.trueSan).toBe(trueSan);
  });

  it('a quiet move has no trueSan', () => {
    const move = fow('4k3/8/8/8/8/8/8/R3K3 w Q - 0 1').movePseudoLegal('a1', 'a2');
    expect(move?.san).toBe('Ra2');
    expect(move && 'trueSan' in move).toBe(false);
  });

  it('the position still changes exactly as before (only the notation is hidden)', () => {
    const engine = fow(REPRO);
    engine.movePseudoLegal('e4', 'c3');
    expect(engine.getFen()).toBe('4k3/6b1/8/8/8/2N5/8/4R1K1 b - - 1 1');
  });
});

describe('what must NOT change', () => {
  it('the ordinary engine keeps chess.js notation', () => {
    expect(new ChessEngine('4k3/8/8/8/8/8/8/R3K3 w Q - 0 1').move('a1', 'a8')?.san).toBe('Ra8+');
  });

  it('Spell Chess (its freeze-escape move uses the pseudo-legal path) keeps check notation', () => {
    const spell = new ChessEngine('4k3/8/8/8/8/8/8/R3K3 w Q - 0 1', { spellChess: true, skipValidation: true, freezeEscapeActive: true });
    expect(spell.move('a1', 'a8')?.san).toBe('Ra8+');
  });

  it('Duck Chess and Giveaway still strip it as before, with no trueSan', () => {
    const duck = new ChessEngine('4k3/8/8/8/8/8/8/R3K3 w Q - 0 1', { skipValidation: true, duckChess: true, duckSquare: null });
    const duckMove = duck.movePseudoLegal('a1', 'a8');
    expect(duckMove?.san).toBe('Ra8');
    expect(duckMove && 'trueSan' in duckMove).toBe(false);
    const giveaway = new ChessEngine('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', { skipValidation: true, giveaway: true });
    expect(giveaway.movePseudoLegal('a1', 'a8')?.san).toBe('Ra8');
  });
});

describe('property: no Fog of War move a player can see ever carries + or #', () => {
  function seeded(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('200 random Fog of War games: san is always clean, trueSan is exactly san + the marker', () => {
    const rng = seeded(7);
    let withMarker = 0;
    let mates = 0;
    let plies = 0;
    for (let g = 0; g < 200; g++) {
      const engine = new ChessEngine(undefined, { skipValidation: true });
      for (let ply = 0; ply < 80; ply++) {
        const moves = engine.getPseudoLegalMoves(engine.getTurn());
        if (moves.length === 0) break;
        const pick = moves[Math.floor(rng() * moves.length)];
        const played = engine.movePseudoLegal(pick.from, pick.to, pick.promotion);
        expect(played).not.toBeNull();
        plies++;
        expect(played!.san).not.toMatch(/[+#]/);
        if (played!.trueSan !== undefined) {
          withMarker++;
          if (played!.trueSan.endsWith('#')) mates++;
          expect(played!.trueSan).toMatch(/[+#]$/);
          expect(played!.trueSan.slice(0, -1)).toBe(played!.san);
        }
        if (played!.captured === 'k') break;
      }
    }
    expect(plies).toBeGreaterThan(3000);
    expect(withMarker).toBeGreaterThan(100); // the property is exercised, not vacuous
    expect(mates).toBeGreaterThan(0);
  }, 60000);
});

describe('the Online screen guards against an older server that still sends the marker', () => {
  it('strips it from the opponent_move SAN and from the rejoin fallbacks, in Fog of War only', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'screens', 'OnlineGameScreen.tsx'), 'utf8').split('\r\n').join('\n');
    expect(src).toContain("import { stripCheckSuffix } from '../logic/fogOfWarNotation';");
    expect(src).toContain('const payloadSan = match.isFogOfWar ? stripCheckSuffix(payload.san!) : payload.san!;');
    expect(src).toContain("san: m.san ? (match.isFogOfWar ? stripCheckSuffix(m.san) : m.san) : '?'");
    expect(src).toContain('san: stripCheckSuffix(m.san!) }, mover, fenBefore, fenAfter: fenBefore });');
    expect(src).not.toMatch(/san: payload\.san!,\n\s*to: payload/); // the diagnostic log line uses payloadSan
  });
});

describe('the sound / haptic channel', () => {
  beforeEach(() => impactAsync.mockClear());

  it('haptics read the SAN suffix: a "+" move buzzes Heavy - which is why a Fog of War move must never carry it', async () => {
    const { triggerMoveHaptics } = await import('../haptics');
    triggerMoveHaptics({ san: 'Nc3+' });
    expect(impactAsync).toHaveBeenLastCalledWith('heavy');
    // what the engine hands every screen in Fog of War: no check buzz, whoever moved
    const move = fow(REPRO).movePseudoLegal('e4', 'c3')!;
    triggerMoveHaptics(move);
    expect(impactAsync).toHaveBeenLastCalledWith('light');
  });

  it('there is no check sound at all: moveSounds only distinguishes move / capture / castle', () => {
    const src = readFileSync(join(__dirname, '..', 'moveSounds.ts'), 'utf8');
    expect(src).toContain("type SoundKind = 'move' | 'capture' | 'castle'");
    expect(src).not.toMatch(/endsWith\(['"][+#]['"]\)|\.san\b[^;\n]*['"][+#]['"]/);
  });
});
