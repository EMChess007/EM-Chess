import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameVariant } from '../../components/VariantSelector';
import { START_FEN } from '../../types/chess';
import { ChessEngine } from '../ChessEngine';
import { getGiveawayMoves, getGiveawayWinner } from '../giveaway';
import { variantTitlePrefix, variantWireFlags } from '../onlineVariants';

const giveawayEngine = (fen: string) => new ChessEngine(fen, { skipValidation: true, giveaway: true });

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('variantWireFlags (what join_queue / create_challenge send)', () => {
  const ALL: GameVariant[] = ['classic', 'chess960', 'kingOfTheHill', 'threeCheck', 'setupChess', 'fogOfWar', 'giveaway', 'atomic'];

  it('sets exactly one flag for a variant and none for classic', () => {
    expect(Object.values(variantWireFlags('classic')).filter(Boolean)).toHaveLength(0);
    for (const variant of ALL.filter((v) => v !== 'classic' && v !== 'atomic')) {
      const flags = variantWireFlags(variant);
      expect(Object.values(flags).filter(Boolean), variant).toHaveLength(1);
    }
  });

  it('maps Giveaway to isGiveaway only', () => {
    expect(variantWireFlags('giveaway')).toEqual({
      isChess960: false,
      isKingOfTheHill: false,
      isThreeCheck: false,
      isSetupChess: false,
      isFogOfWar: false,
      isGiveaway: true,
      isAtomic: false,
      isDuckChess: false,
      isSpellChess: false,
      isHorde: false,
    });
  });

  it('titles the matchmaking screen', () => {
    expect(variantTitlePrefix('giveaway')).toBe('Giveaway · ');
    expect(variantTitlePrefix('classic')).toBe('');
  });
});

describe('replaying a Giveaway game the way the Online screen does', () => {
  it('a SINGLE live engine (the rejoin path) survives a king capture and agrees with per-ply rebuilds', () => {
    // OnlineGameScreen's reconnect handler replays the whole move list on ONE engine, unlike every other
    // screen (a fresh engine from the FEN each ply). A Giveaway game carries on after a king is captured,
    // which chess.js's live internal state cannot handle (stale king square + castling rights made the next
    // move throw) — the engine must rebuild itself from its FEN after each Giveaway move.
    let games = 0;
    let kingCaptures = 0;
    for (let g = 0; g < 80; g++) {
      const random = seeded(31000 + g);
      const live = giveawayEngine(START_FEN);
      let fen = START_FEN;
      for (let ply = 0; ply < 200; ply++) {
        const rebuilt = giveawayEngine(fen);
        const moves = getGiveawayMoves(rebuilt);
        if (moves.length === 0 || getGiveawayWinner(rebuilt)) break;
        const pick = moves[Math.floor(random() * moves.length)];
        const a = live.movePseudoLegal(pick.from, pick.to, pick.promotion);
        const b = rebuilt.movePseudoLegal(pick.from, pick.to, pick.promotion);
        expect(a, `live engine failed to apply ${pick.from}${pick.to} in ${fen}`).not.toBeNull();
        expect(a?.san).toBe(b?.san);
        expect(live.getFen()).toBe(rebuilt.getFen());
        if (a?.captured === 'k') kingCaptures++;
        fen = rebuilt.getFen();
      }
      games++;
    }
    expect(games).toBe(80);
    expect(kingCaptures).toBeGreaterThan(20); // the games really did capture kings and carry on
  }, 60000);
});

describe('Online wiring (no React Native renderer available)', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '../../', rel), 'utf8').replace(/\r\n/g, '\n');
  const online = read('screens/OnlineGameScreen.tsx');

  it('the wire types carry the Giveaway flag, the reason and king promotion', () => {
    const types = read('types/multiplayer.ts');
    expect(types).toContain("| 'giveaway'");
    expect(types).toContain('isGiveaway?: boolean;'); // join_queue / create_challenge payloads
    expect(types.match(/isGiveaway: boolean;/g)?.length).toBe(2); // MatchFoundPayload + RejoinStatePayload
    expect(types.match(/promotion\?: 'n' \| 'b' \| 'r' \| 'q' \| 'k'/g)?.length).toBe(2); // make_move + opponent_move
  });

  it('OnlineGameScreen builds BOTH replay engines the Giveaway way and applies moves through movePseudoLegal', () => {
    expect(online).toContain('const giveaway = match.isGiveaway === true;');
    expect(online.match(/skipValidation: match\.isFogOfWar \|\| giveaway \|\| duckChess(?: \|\| spellChess)?(?: \|\| horde)?,\s*\n\s*giveaway,/g)?.length).toBe(2);
    expect(online.match(/match\.isFogOfWar \|\| giveaway(?: \|\| duckChess)?\s*\n?\s*\?\s*(replayEngine)\.movePseudoLegal/g)?.length).toBe(2);
  });

  it('Online Giveaway has no premoves, no opening names, no rating change and no Game Review', () => {
    expect(online).toContain('premoveColor={giveaway || atomic || duckChess || spellChess || horde ? undefined : myColor}');
    expect(online).toContain('onPremove={giveaway || atomic || duckChess || spellChess || horde ? undefined : handleQueuePremove}');
    expect(online).toContain('!giveaway && !atomic && !duckChess && !spellChess && !horde && openingName');
    expect(online).toContain('ratingCategory && !giveaway');
    expect(online).toContain('wasMaterialDownRef.current && !giveaway');
    expect(online).toMatch(/PostGameSummaryModal[\s\S]*?giveaway=\{giveaway\}/);
    expect(online).toContain('giveaway={giveaway}'); // ChessBoard
  });

  it('matchmaking and challenges send the flags through the shared helper', () => {
    expect(read('screens/MatchmakingScreen.tsx').match(/\.\.\.variantWireFlags\(variant\)/g)?.length).toBe(2);
    expect(read('screens/ChallengeScreen.tsx')).toContain('...variantWireFlags(variant)');
    expect(read('screens/OnlineTimeControlSelectScreen.tsx')).toContain('onSelect(tc, variant)');
  });

  it('tournaments never carry Giveaway, and spectators render it', () => {
    expect(read('screens/TournamentStandingsScreen.tsx').match(/isGiveaway: false/g)?.length).toBe(2);
    expect(read('screens/TournamentScreen.tsx')).toContain("'giveaway'");
    expect(read('screens/SpectatorGameScreen.tsx')).toContain('giveaway={state.isGiveaway}');
  });
});
