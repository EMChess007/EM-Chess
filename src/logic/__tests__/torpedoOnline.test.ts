import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameVariant } from '../../components/VariantSelector';
import { variantTitlePrefix, variantWireFlags } from '../onlineVariants';

const SRC = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');

const ALL: GameVariant[] = ['classic', 'chess960', 'kingOfTheHill', 'threeCheck', 'setupChess', 'fogOfWar', 'giveaway', 'atomic', 'duckChess', 'spellChess', 'horde', 'racingKings', 'torpedo', 'knightmate', 'crazyhouse'];

describe('Torpedo wire flags', () => {
  it('maps Torpedo to isTorpedo only, and no other variant sets it', () => {
    const flags = variantWireFlags('torpedo');
    expect(flags.isTorpedo).toBe(true);
    expect(Object.entries(flags).filter(([, v]) => v).map(([k]) => k)).toEqual(['isTorpedo']);
    for (const variant of ALL.filter((v) => v !== 'torpedo')) expect(variantWireFlags(variant).isTorpedo, variant).toBe(false);
    expect(variantTitlePrefix('torpedo')).toBe('Torpedo · ');
  });

  it('is mutually exclusive with every other variant on the wire: exactly one flag is ever true', () => {
    for (const variant of ALL.filter((v) => v !== 'classic')) {
      expect(Object.values(variantWireFlags(variant)).filter(Boolean), variant).toHaveLength(1);
    }
    expect(Object.values(variantWireFlags('classic')).filter(Boolean)).toHaveLength(0);
  });
});

describe('Torpedo online wiring (source scan; the rendered screens need no RN renderer here)', () => {
  it('OnlineGameScreen reads the flag, builds every engine with it, and turns the Stockfish-only extras off', () => {
    const online = read('screens/OnlineGameScreen.tsx');
    expect(online).toContain('const torpedo = match.isTorpedo === true;');
    expect(online.match(/\btorpedo,\n/g)?.length).toBe(2); // the opponent-move replay engine and the rejoin rebuild engine
    expect(online).toContain('torpedo={torpedo}');
    // no premoves (a queued pawn double step is not modelled), no rating, no opening names
    expect(online).toContain('horde || racingKings || torpedo || knightmate || crazyhouse ? undefined : myColor');
    expect(online).toContain('!horde && !racingKings && !torpedo && !knightmate && !crazyhouse');
    expect(online).toContain('<TorpedoRulesSheet');
    expect(online).toContain("? 'Torpedo'");
  });

  it('SpectatorGameScreen shows the label and passes the flag to the board', () => {
    const spectator = read('screens/SpectatorGameScreen.tsx');
    expect(spectator).toContain("' · Torpedo'");
    expect(spectator).toContain('torpedo={state.isTorpedo === true}');
  });

  it('Tournaments offer Torpedo (the other special variants stay excluded) and carry the flag to the server', () => {
    const screen = read('screens/TournamentScreen.tsx');
    expect(screen).toContain("'spellChess', 'horde', 'crazyhouse']");
    expect(screen).not.toContain("'torpedo', 'crazyhouse']");
    expect(screen).toContain("const isTorpedo = variant === 'torpedo'");
    expect(screen).toContain('lobby.isTorpedo ?');
    const standings = read('screens/TournamentStandingsScreen.tsx');
    expect(standings).toContain('isTorpedo: payload.isTorpedo');
    expect(standings).toContain('isTorpedo: match.isTorpedo');
  });

  it('the variant picker lists Torpedo for Quick Match, Challenge a Friend and Tournaments', () => {
    const selector = read('components/VariantSelector.tsx');
    expect(selector).toContain("| 'torpedo'");
    expect(selector).toContain("{ value: 'torpedo', label: 'Torpedo' }");
  });

  it('every game screen offers the Rules sheet for Torpedo', () => {
    for (const file of ['screens/LocalGameScreen.tsx', 'screens/BotGameScreen.tsx', 'screens/OnlineGameScreen.tsx']) {
      const source = read(file);
      expect(source, file).toContain("import TorpedoRulesSheet from '../components/TorpedoRulesSheet';");
      expect(source, file).toContain('{torpedo && <TorpedoRulesSheet visible={rulesOpen} onClose={() => setRulesOpen(false)} />}');
    }
  });
});
