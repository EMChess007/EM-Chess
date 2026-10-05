import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { START_FEN } from '../../types/chess';
import { ChessEngine } from '../ChessEngine';
import { getLegalDuckPlacementSquares } from '../duckChess';
import { variantTitlePrefix, variantWireFlags } from '../onlineVariants';

const duckEngine = (fen: string, duckSquare: string | null) => new ChessEngine(fen, { skipValidation: true, duckChess: true, duckSquare });

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Duck Chess wire flags', () => {
  it('maps Duck Chess to isDuckChess only', () => {
    expect(variantWireFlags('duckChess')).toEqual({
      isChess960: false,
      isKingOfTheHill: false,
      isThreeCheck: false,
      isSetupChess: false,
      isFogOfWar: false,
      isGiveaway: false,
      isAtomic: false,
      isDuckChess: true,
      isSpellChess: false,
    });
    expect(variantTitlePrefix('duckChess')).toBe('Duck Chess · ');
  });
});

describe('replaying a Duck Chess game the way the Online screen does', () => {
  it('a rejoin replay (running { fen, duck } pair, a fresh engine per ply) matches the turns that were played', () => {
    // The server's move list for a rejoin is [{from, to, promotion, san, duck}]; the duck is not part of the FEN,
    // so OnlineGameScreen replays each ply on an engine built from the running pair.
    const random = seeded(77);
    const played: { from: string; to: string; promotion?: string; duck?: string }[] = [];
    const fens: string[] = [START_FEN];
    let fen = START_FEN;
    let duck: string | null = null;
    for (let ply = 0; ply < 120; ply++) {
      const engine = duckEngine(fen, duck);
      const moves = engine.getPseudoLegalMoves();
      if (moves.length === 0) break;
      const pick = moves[Math.floor(random() * moves.length)];
      const mover = duckEngine(fen, duck);
      const move = mover.movePseudoLegal(pick.from, pick.to, pick.promotion);
      expect(move).not.toBeNull();
      if (move!.captured === 'k') {
        played.push({ from: pick.from, to: pick.to, promotion: pick.promotion });
        fens.push(mover.getFen());
        break;
      }
      const squares = getLegalDuckPlacementSquares(mover, duck);
      const next = squares[Math.floor(random() * squares.length)];
      played.push({ from: pick.from, to: pick.to, promotion: pick.promotion, duck: next });
      fen = mover.getFen();
      fens.push(fen);
      duck = next;
    }

    // The rejoin replay, exactly as written in OnlineGameScreen.
    let replayFen = START_FEN;
    let replayDuck: string | null = null;
    const rebuiltFens: string[] = [START_FEN];
    const rebuiltDucks: (string | null)[] = [];
    for (const m of played) {
      const step = new ChessEngine(replayFen, { skipValidation: true, duckChess: true, duckSquare: replayDuck });
      const stepped = step.movePseudoLegal(m.from, m.to, m.promotion as 'q' | undefined);
      expect(stepped, `${m.from}${m.to} from ${replayFen} with the duck on ${replayDuck}`).not.toBeNull();
      replayFen = step.getFen();
      if (m.duck) replayDuck = m.duck;
      rebuiltFens.push(replayFen);
      rebuiltDucks.push(replayDuck);
    }
    expect(rebuiltFens).toEqual(fens);
    expect(played.length).toBeGreaterThan(40);
    expect(rebuiltDucks[rebuiltDucks.length - 1]).toBe(played.filter((m) => m.duck).slice(-1)[0]?.duck ?? null);
  });
});

describe('Online wiring (no React Native renderer available)', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '../../', rel), 'utf8').replace(/\r\n/g, '\n');
  const online = read('screens/OnlineGameScreen.tsx');

  it('the wire types carry the Duck Chess flag, the reason, duckTo and the duck square', () => {
    const types = read('types/multiplayer.ts');
    expect(types).toContain("| 'duckChess'");
    expect(types).toContain('isDuckChess?: boolean;'); // join_queue / create_challenge payloads
    expect(types.match(/isDuckChess: boolean;/g)?.length).toBe(2); // MatchFoundPayload + RejoinStatePayload
    expect(types).toContain('duckTo?: string;'); // make_move
    expect(types.match(/duckSquare\?: string \| null;/g)?.length).toBe(2); // opponent_move + rejoin/spectate state
  });

  it('make_move carries the duck with the move, as one turn, and the optimistic state is reverted if refused', () => {
    expect(online).toContain('...(duckChess && move.duck ? { duckTo: move.duck } : {})');
    expect(online).toContain('if (duckChess) setDuckSquare(move.duck ?? duckSquare);');
    expect(online).toContain('if (duckChess) setDuckSquare(duckBeforeMove);');
    expect(online).toContain('if (duckChess && ack.duckSquare !== undefined) setDuckSquare(ack.duckSquare);');
  });

  it('opponent moves take the duck from the server, and the replay engine is built with the duck BEFORE that move', () => {
    expect(online).toContain('const duckBeforeOpponentMove = duckRef.current;');
    expect(online).toContain('duckSquare: duckBeforeOpponentMove,');
    expect(online).toContain('replayedMove && payload.duck');
    expect(online).toContain('{ ...replayedMove, duck: payload.duck }');
  });

  it('rejoin restores the duck and replays each ply on a fresh engine from the running pair', () => {
    expect(online).toContain('if (duckChess) setDuckSquare(ack.state.duckSquare ?? null);');
    expect(online).toContain('let replayDuck: string | null = null;');
    expect(online).toContain('duckChess: true, duckSquare: replayDuck');
  });

  it('Online Duck Chess has no premoves, no opening names, no rating change and no Game Review, and shows the notation', () => {
    expect(online).toContain('premoveColor={giveaway || atomic || duckChess || spellChess ? undefined : myColor}');
    expect(online).toContain('!duckChess && !spellChess && openingName');
    expect(online).toContain('ratingCategory && !giveaway && !atomic && !duckChess');
    expect(online).toContain('onDuckPlacementChange={setPlacingDuck}');
    expect(online).toContain('duckSquare={displayDuck}');
    expect(online).toContain('duckMoveNotation(m.move)');
    expect(online.match(/duckChess=\{duckChess\}/g)?.length).toBe(2); // ChessBoard + PostGameSummaryModal
  });

  it('spectators render the duck and its notation; tournaments never carry Duck Chess', () => {
    const spectator = read('screens/SpectatorGameScreen.tsx');
    expect(spectator).toContain('duckChess={state.isDuckChess}');
    expect(spectator).toContain('duckSquare={state.duckSquare ?? null}');
    expect(spectator).toContain('duckMoveNotation(');
    expect(read('screens/TournamentStandingsScreen.tsx').match(/isDuckChess: false/g)?.length).toBe(2);
    expect(read('screens/TournamentScreen.tsx')).toContain("'duckChess'");
  });

  it('the Online and Challenge pickers offer Duck Chess (no exclusion); Tournaments still never do', () => {
    expect(read('screens/OnlineTimeControlSelectScreen.tsx')).not.toContain('excludeVariants');
    expect(read('screens/ChallengeScreen.tsx')).not.toContain('excludeVariants');
    expect(read('screens/TournamentScreen.tsx')).toContain("'duckChess'");
    expect(read('screens/TournamentScreen.tsx')).toContain('excludeVariants={');
  });
});
