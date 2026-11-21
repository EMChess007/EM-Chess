import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameVariant } from '../../components/VariantSelector';
import { ChessEngine } from '../ChessEngine';
import { KNIGHTMATE_START_FEN } from '../knightmate';
import { buildPgn } from '../pgn';
import { variantTitlePrefix, variantWireFlags } from '../onlineVariants';

const SRC = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');

const ALL: GameVariant[] = ['classic', 'chess960', 'kingOfTheHill', 'threeCheck', 'setupChess', 'fogOfWar', 'giveaway', 'atomic', 'duckChess', 'spellChess', 'horde', 'racingKings', 'torpedo', 'knightmate', 'crazyhouse'];

describe('Knightmate wire flags', () => {
  it('maps Knightmate to isKnightmate only, and no other variant sets it', () => {
    const flags = variantWireFlags('knightmate');
    expect(flags.isKnightmate).toBe(true);
    expect(Object.entries(flags).filter(([, v]) => v).map(([k]) => k)).toEqual(['isKnightmate']);
    for (const variant of ALL.filter((v) => v !== 'knightmate')) expect(variantWireFlags(variant).isKnightmate, variant).toBe(false);
    expect(variantTitlePrefix('knightmate')).toBe('Knightmate · ');
  });

  it('is mutually exclusive with every other variant on the wire: exactly one flag is ever true', () => {
    for (const variant of ALL.filter((v) => v !== 'classic')) {
      expect(Object.values(variantWireFlags(variant)).filter(Boolean), variant).toHaveLength(1);
    }
    expect(Object.values(variantWireFlags('classic')).filter(Boolean)).toHaveLength(0);
  });
});

describe('Knightmate wire and PGN notation', () => {
  /** The same line the server's test-knightmate.mjs and test-multiplayer.mjs play: the Commoner promotion rides as 'm' and is written "=M". */
  const LINE: [string, string, 'm'?][] = [['e1', 'f3'], ['e8', 'f6'], ['a2', 'a4'], ['b7', 'b5'], ['a4', 'b5'], ['a7', 'a6'], ['b5', 'a6'], ['h7', 'h6'], ['a6', 'a7'], ['h6', 'h5'], ['a7', 'b8', 'm']];

  it('plays the line with the same notation the server answers: Kf3 Kf6 ... axb8=M, the promotion piece "m"', () => {
    const engine = new ChessEngine(KNIGHTMATE_START_FEN, { knightmate: true });
    const played = LINE.map(([from, to, promotion]) => engine.move(from, to, promotion));
    expect(played.every(Boolean)).toBe(true);
    expect(played.map((m) => m?.san)).toEqual(['Kf3', 'Kf6', 'a4', 'b5', 'axb5', 'a6', 'bxa6', 'h6', 'a7', 'h5', 'axb8=M']);
    expect(played.at(-1)?.promotion).toBe('m');
    // the FEN the server sends (backend test-knightmate.mjs checks the same string): the new white Commoner is the capital "M" on b8
    expect(engine.getFen()).toBe('rMbq1bmr/2ppppp1/5k2/7p/8/5K2/1PPPPPPP/RMBQ1BMR b - - 0 6');
  });

  it('refuses a promotion to a knight, and the saved PGN carries [Variant "Knightmate"], "K" / "M" and "=M"', () => {
    const engine = new ChessEngine(KNIGHTMATE_START_FEN, { knightmate: true });
    for (const [from, to] of LINE.slice(0, -1)) engine.move(from, to);
    expect(engine.move('a7', 'b8', 'n')).toBeNull();
    const history = [];
    const replay = new ChessEngine(KNIGHTMATE_START_FEN, { knightmate: true });
    for (const [from, to, promotion] of LINE) {
      const fenBefore = replay.getFen();
      const move = replay.move(from, to, promotion);
      history.push({ move, fenBefore });
    }
    const pgn = buildPgn(KNIGHTMATE_START_FEN, history as Parameters<typeof buildPgn>[1], '*', 'Knightmate');
    expect(pgn).toContain('[Variant "Knightmate"]');
    expect(pgn).toContain('1.Kf3 Kf6 2.a4 b5');
    expect(pgn).toContain('6.axb8=M');
  });
});

describe('Knightmate online wiring (source scan; the rendered screen is in knightmateOnline.dom.test.tsx)', () => {
  it('OnlineGameScreen reads the flag, builds every engine with it, and turns the Stockfish-only extras off', () => {
    const online = read('screens/OnlineGameScreen.tsx');
    expect(online).toContain('const knightmate = match.isKnightmate === true;');
    expect(online.match(/\bknightmate,\n/g)?.length).toBe(2); // the opponent-move replay engine and the rejoin rebuild engine
    expect(online).toContain('knightmate={knightmate}');
    // no premoves, no rating, no opening names
    expect(online).toContain('racingKings || torpedo || knightmate || crazyhouse ? undefined : myColor');
    expect(online).toContain('!racingKings && !torpedo && !knightmate && !crazyhouse');
    expect(online).toContain('<KnightmateRulesSheet');
    expect(online).toContain("? 'Knightmate'");
  });

  it('SpectatorGameScreen shows the label and passes the flag to the board', () => {
    const spectator = read('screens/SpectatorGameScreen.tsx');
    expect(spectator).toContain("' · Knightmate'");
    expect(spectator).toContain('knightmate={state.isKnightmate === true}');
  });

  it('Tournaments offer Knightmate (only Setup Chess is excluded) and carry the flag to the server through the shared mapping', () => {
    const screen = read('screens/TournamentScreen.tsx');
    expect(screen).toContain('excludeVariants={TOURNAMENT_EXCLUDED_VARIANTS}');
    expect(screen).not.toContain("'knightmate'");
    expect(screen).toContain('variantWireFlags(variant)');
    expect(screen).toContain('variantFromWireFlags(lobby)');
    const standings = read('screens/TournamentStandingsScreen.tsx');
    expect(standings).toContain('tournamentMatchToGame(payload');
    expect(standings).toContain('tournamentMatchToGame(');
    expect(standings).not.toContain('isKnightmate');
  });

  it('the variant picker lists Knightmate for Quick Match, Challenge a Friend and Tournaments', () => {
    const selector = read('components/VariantSelector.tsx');
    expect(selector).toContain("| 'knightmate'");
    expect(selector).toContain("{ value: 'knightmate', label: 'Knightmate' }");
  });

  it('every game screen offers the Rules sheet for Knightmate', () => {
    for (const file of ['screens/LocalGameScreen.tsx', 'screens/BotGameScreen.tsx', 'screens/OnlineGameScreen.tsx']) {
      const source = read(file);
      expect(source, file).toContain("import KnightmateRulesSheet from '../components/KnightmateRulesSheet';");
      expect(source, file).toContain('{knightmate && <KnightmateRulesSheet visible={rulesOpen} onClose={() => setRulesOpen(false)} />}');
      expect(source, file).toContain('racingKings || torpedo || knightmate ? [{ label: \'Rules\'');
    }
  });

  it('the wire types carry the Commoner promotion "m" (make_move and opponent_move) and the flag on every payload', () => {
    const types = read('types/multiplayer.ts');
    expect(types.match(/promotion\?: 'n' \| 'b' \| 'r' \| 'q' \| 'k' \| 'm';/g)?.length).toBe(2);
    expect(types.match(/isKnightmate\??: boolean;/g)?.length).toBe(4); // queue, match_found, rejoin, challenge (the tournament payloads extend OnlineVariantFlags)
  });
});
