import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { START_FEN } from '../../types/chess';
import { ChessEngine } from '../ChessEngine';
import { getAtomicMoves, getAtomicWinner } from '../atomic';
import { variantTitlePrefix, variantWireFlags } from '../onlineVariants';

const atomicEngine = (fen: string) => new ChessEngine(fen, { atomic: true });

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Atomic wire flags', () => {
  it('maps Atomic to isAtomic only', () => {
    expect(variantWireFlags('atomic')).toEqual({
      isChess960: false,
      isKingOfTheHill: false,
      isThreeCheck: false,
      isSetupChess: false,
      isFogOfWar: false,
      isGiveaway: false,
      isAtomic: true,
    });
    expect(Object.values(variantWireFlags('classic')).filter(Boolean)).toHaveLength(0);
    expect(variantTitlePrefix('atomic')).toBe('Atomic · ');
  });
});

describe('replaying an Atomic game the way the Online screen does', () => {
  it('the server\'s moves, replayed on one live engine (the rejoin path) or a fresh one per ply, give the same positions', () => {
    let kingWins = 0;
    for (let g = 0; g < 60; g++) {
      const random = seeded(52000 + g);
      const live = atomicEngine(START_FEN);
      let fen = START_FEN;
      for (let ply = 0; ply < 160; ply++) {
        const fresh = atomicEngine(fen);
        if (fresh.isGameOver()) {
          if (getAtomicWinner(fresh)) kingWins++;
          break;
        }
        const moves = getAtomicMoves(fresh);
        const captures = moves.filter((m) => m.captured);
        const pool = captures.length > 0 && random() < 0.6 ? captures : moves;
        const pick = pool[Math.floor(random() * pool.length)];
        const a = live.move(pick.from, pick.to, pick.promotion ?? 'q');
        const b = fresh.move(pick.from, pick.to, pick.promotion ?? 'q');
        expect(a, `live engine rejected ${pick.from}${pick.to} in ${fen}`).not.toBeNull();
        expect(a?.san).toBe(b?.san);
        expect(a?.exploded?.length).toBe(b?.exploded?.length); // what the board animates comes from the local replay
        expect(live.getFen()).toBe(fresh.getFen());
        fen = fresh.getFen();
      }
    }
    expect(kingWins).toBeGreaterThan(3);
  }, 60000);
});

describe('Online wiring (no React Native renderer available)', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '../../', rel), 'utf8').replace(/\r\n/g, '\n');
  const online = read('screens/OnlineGameScreen.tsx');

  it('the wire types carry the Atomic flag and the reason', () => {
    const types = read('types/multiplayer.ts');
    expect(types).toContain("| 'atomic'");
    expect(types).toContain('isAtomic?: boolean;'); // join_queue / create_challenge payloads
    expect(types.match(/isAtomic: boolean;/g)?.length).toBe(2); // MatchFoundPayload + RejoinStatePayload
  });

  it('OnlineGameScreen builds BOTH replay engines with the atomic option and feeds exploded pieces to the tray', () => {
    expect(online).toContain('const atomic = match.isAtomic === true;');
    expect(online.match(/giveaway,\s*\n\s*atomic,/g)?.length).toBe(2);
    expect(online).toContain('exploded: m.move.exploded');
  });

  it('Online Atomic has no premoves, no opening names, no rating change and no Game Review', () => {
    expect(online).toContain('premoveColor={giveaway || atomic ? undefined : myColor}');
    expect(online).toContain('onPremove={giveaway || atomic ? undefined : handleQueuePremove}');
    expect(online).toContain('!giveaway && !atomic && openingName');
    expect(online).toContain('ratingCategory && !giveaway && !atomic');
    expect(online).toContain('wasMaterialDownRef.current && !giveaway && !atomic');
    expect(online).toContain('atomic={atomic}'); // ChessBoard (animation, capture-promotion) and PostGameSummaryModal
    expect(online.match(/atomic=\{atomic\}/g)?.length).toBe(2);
  });

  it('tournaments never carry Atomic, and spectators render it', () => {
    expect(read('screens/TournamentStandingsScreen.tsx').match(/isAtomic: false/g)?.length).toBe(2);
    expect(read('screens/TournamentScreen.tsx')).toContain("'atomic'");
    expect(read('screens/SpectatorGameScreen.tsx')).toContain('atomic={state.isAtomic}');
  });
});
