import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameVariant } from '../../components/VariantSelector';
import { describeEndReason } from '../gameOutcomeText';
import { variantTitlePrefix, variantWireFlags } from '../onlineVariants';

const SRC = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');

const ALL: GameVariant[] = ['classic', 'chess960', 'kingOfTheHill', 'threeCheck', 'setupChess', 'fogOfWar', 'giveaway', 'atomic', 'duckChess', 'spellChess', 'horde', 'racingKings', 'crazyhouse'];

describe('Racing Kings wire flags', () => {
  it('maps Racing Kings to isRacingKings only, and no other variant sets it', () => {
    const flags = variantWireFlags('racingKings');
    expect(flags.isRacingKings).toBe(true);
    expect(Object.entries(flags).filter(([, v]) => v).map(([k]) => k)).toEqual(['isRacingKings']);
    for (const variant of ALL.filter((v) => v !== 'racingKings')) expect(variantWireFlags(variant).isRacingKings, variant).toBe(false);
    expect(variantTitlePrefix('racingKings')).toBe('Racing Kings · ');
  });

  it('is mutually exclusive with every other variant on the wire: exactly one flag is ever true', () => {
    for (const variant of ALL.filter((v) => v !== 'classic')) {
      expect(Object.values(variantWireFlags(variant)).filter(Boolean), variant).toHaveLength(1);
    }
  });

  it('says how a Racing Kings game ended', () => {
    expect(describeEndReason('racingKings')).toBe('by Reaching the 8th Rank');
  });
});

describe('Racing Kings online wiring (source scan; the rendered screens need no RN renderer here)', () => {
  it('OnlineGameScreen reads the flag, builds every engine with it, and turns the Stockfish-only extras off', () => {
    const online = read('screens/OnlineGameScreen.tsx');
    expect(online).toContain('const racingKings = match.isRacingKings === true;');
    expect(online.match(/\bracingKings,\n/g)?.length).toBe(2); // the opponent-move replay engine and the rejoin rebuild engine
    expect(online).toContain('racingKings={racingKings}');
    expect(online).toContain('spellChess || horde || racingKings || crazyhouse ? undefined : myColor');
    expect(online).toContain('!horde && !racingKings && !crazyhouse');
  });

  it('SpectatorGameScreen shows the label and passes the flag to the board', () => {
    const spectator = read('screens/SpectatorGameScreen.tsx');
    expect(spectator).toContain("' · Racing Kings'");
    expect(spectator).toContain('racingKings={state.isRacingKings === true}');
  });

  it('Tournaments leave Racing Kings out, as for every other special variant', () => {
    expect(read('screens/TournamentScreen.tsx')).toContain("'horde', 'racingKings', 'crazyhouse']");
  });

  it('the rooms, the queue and the wire types carry the flag on the server', () => {
    const server = (rel: string) => readFileSync(join(SRC, '../backend/src/game', rel), 'utf8');
    expect(server('matchmaking.ts')).toContain('q.isRacingKings === entry.isRacingKings');
    expect(server('socketHandlers.ts')).toContain('isRacingKings: Boolean(payload.isRacingKings)');
    expect(server('rooms.ts')).toContain('params.racingKings ? RACING_KINGS_START_FEN');
  });
});
