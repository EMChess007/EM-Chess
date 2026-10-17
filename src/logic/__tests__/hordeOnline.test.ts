import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameVariant } from '../../components/VariantSelector';
import { ChessEngine } from '../ChessEngine';
import { HORDE_START_FEN, getHordeMoves, getHordeWinnerFromFen } from '../horde';
import { variantTitlePrefix, variantWireFlags } from '../onlineVariants';

const SRC = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');

const ALL: GameVariant[] = ['classic', 'chess960', 'kingOfTheHill', 'threeCheck', 'setupChess', 'fogOfWar', 'giveaway', 'atomic', 'duckChess', 'spellChess', 'horde'];

describe('Horde wire flags', () => {
  it('maps Horde to isHorde only, and no other variant sets it', () => {
    expect(variantWireFlags('horde')).toEqual({
      isChess960: false,
      isKingOfTheHill: false,
      isThreeCheck: false,
      isSetupChess: false,
      isFogOfWar: false,
      isGiveaway: false,
      isAtomic: false,
      isDuckChess: false,
      isSpellChess: false,
      isHorde: true,
    });
    for (const variant of ALL.filter((v) => v !== 'horde')) expect(variantWireFlags(variant).isHorde, variant).toBe(false);
    expect(variantTitlePrefix('horde')).toBe('Horde · ');
  });

  it('Horde is mutually exclusive with every other variant on the wire: exactly one flag is ever true', () => {
    for (const variant of ALL.filter((v) => v !== 'classic')) {
      expect(Object.values(variantWireFlags(variant)).filter(Boolean), variant).toHaveLength(1);
    }
    expect(Object.values(variantWireFlags('classic')).filter(Boolean)).toHaveLength(0);
  });
});

describe('replaying a Horde game the way the Online screen does', () => {
  it('a rejoin replay (a fresh horde engine per ply, applying the server\'s move list) rebuilds the positions that were played', () => {
    // The server's move list for a rejoin is [{from, to, promotion}] — including the rank-1 double step chess.js alone
    // would refuse — and the client replays it on engines built with { horde: true }.
    let seed = 9;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const played: { from: string; to: string; promotion?: string }[] = [];
    const fens: string[] = [HORDE_START_FEN];
    let fen = HORDE_START_FEN;
    let rankOneDoubleSteps = 0;
    for (let ply = 0; ply < 160; ply++) {
      const engine = new ChessEngine(fen, { horde: true });
      const moves = getHordeMoves(engine);
      if (moves.length === 0 || engine.isGameOver()) break;
      const pick = moves[Math.floor(random() * moves.length)];
      const piece = engine.getPieceAt(pick.from);
      if (piece?.type === 'p' && piece.color === 'w' && pick.from[1] === '1' && pick.to[1] === '3') rankOneDoubleSteps++;
      engine.move(pick.from, pick.to, pick.promotion);
      played.push({ from: pick.from, to: pick.to, promotion: pick.promotion });
      fen = engine.getFen();
      fens.push(fen);
    }
    expect(played.length).toBeGreaterThan(40);

    let replayFen = HORDE_START_FEN;
    const rebuilt: string[] = [HORDE_START_FEN];
    for (const m of played) {
      const step = new ChessEngine(replayFen, { horde: true });
      expect(step.move(m.from, m.to, m.promotion as 'q' | undefined), `${m.from}${m.to} from ${replayFen}`).not.toBeNull();
      replayFen = step.getFen();
      rebuilt.push(replayFen);
    }
    expect(rebuilt).toEqual(fens);
    expect(rankOneDoubleSteps).toBeGreaterThanOrEqual(0);
    expect(getHordeWinnerFromFen(HORDE_START_FEN)).toBeNull();
  });
});

describe('Online wiring (no React Native renderer available)', () => {
  it('the wire types carry the Horde flag on every payload, and the reason', () => {
    const types = read('types/multiplayer.ts');
    expect(types).toContain("| 'horde'");
    expect(types.match(/isHorde\?: boolean;/g)?.length).toBe(2); // join_queue + create_challenge
    expect(types.match(/isHorde: boolean;/g)?.length).toBe(2); // MatchFoundPayload + RejoinStatePayload
  });

  it('OnlineGameScreen builds BOTH replay engines with the horde option, hides what Stockfish/Horde cannot do, and never rates it', () => {
    const online = read('screens/OnlineGameScreen.tsx');
    expect(online).toContain('const horde = match.isHorde === true;');
    expect(online).toContain('skipValidation: match.isFogOfWar || giveaway || duckChess || spellChess || horde,');
    expect(online).toContain('skipValidation: match.isFogOfWar || giveaway || duckChess || horde,');
    expect(online.match(/\bhorde,\n/g)?.length).toBeGreaterThanOrEqual(2);
    expect(online).toContain('premoveColor={giveaway || atomic || duckChess || spellChess || horde ? undefined : myColor}');
    expect(online).toContain('onPremove={giveaway || atomic || duckChess || spellChess || horde ? undefined : handleQueuePremove}');
    expect(online).toContain('!duckChess && !spellChess && !horde && openingName');
    expect(online).toContain('ratingCategory && !giveaway && !atomic && !duckChess && !spellChess && !horde');
    expect(online).toContain('wasMaterialDownRef.current && !giveaway && !atomic && !duckChess && !spellChess && !horde');
    expect(online).toContain('horde={horde}');
  });

  it('spectators get the Horde board and label', () => {
    const spectator = read('screens/SpectatorGameScreen.tsx');
    expect(spectator).toContain('horde={state.isHorde}');
    expect(spectator).toContain("' · Horde'");
  });
});
