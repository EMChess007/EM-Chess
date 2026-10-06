import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameVariant } from '../../components/VariantSelector';
import { ChessEngine } from '../ChessEngine';
import { getCrazyhouseMoves, initialCrazyhouseState, type CrazyhouseState, type ReservePieceType } from '../crazyhouse';
import { variantTitlePrefix, variantWireFlags } from '../onlineVariants';
import { START_FEN } from '../../types/chess';

const SRC = join(__dirname, '../..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');

const ALL: GameVariant[] = ['classic', 'chess960', 'kingOfTheHill', 'threeCheck', 'setupChess', 'fogOfWar', 'giveaway', 'atomic', 'duckChess', 'spellChess', 'horde', 'crazyhouse'];

describe('Crazyhouse wire flags', () => {
  it('maps Crazyhouse to isCrazyhouse only, and no other variant sets it', () => {
    const flags = variantWireFlags('crazyhouse');
    expect(flags.isCrazyhouse).toBe(true);
    expect(Object.entries(flags).filter(([, v]) => v).map(([k]) => k)).toEqual(['isCrazyhouse']);
    for (const variant of ALL.filter((v) => v !== 'crazyhouse')) expect(variantWireFlags(variant).isCrazyhouse, variant).toBe(false);
    expect(variantTitlePrefix('crazyhouse')).toBe('Crazyhouse · ');
  });

  it('every variant but classic sets exactly one flag (mutual exclusivity on the wire)', () => {
    for (const variant of ALL.filter((v) => v !== 'classic')) expect(Object.values(variantWireFlags(variant)).filter(Boolean), variant).toHaveLength(1);
    expect(Object.values(variantWireFlags('classic')).filter(Boolean)).toHaveLength(0);
  });
});

type WireTurn = { from?: string; to?: string; promotion?: string; san?: string; drop?: ReservePieceType };

/** A seeded random Crazyhouse game, recorded as the server's move list (what rejoin_game sends) plus every state it passed through. */
function randomGame(seed: number, plies: number) {
  let s = seed;
  const random = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const moves: WireTurn[] = [];
  const fens: string[] = [START_FEN];
  const states: CrazyhouseState[] = [initialCrazyhouseState()];
  let fen = START_FEN;
  let state = initialCrazyhouseState();
  let drops = 0;
  for (let ply = 0; ply < plies; ply++) {
    const engine = new ChessEngine(fen, { crazyhouse: true, crazyhouseState: state });
    if (engine.isGameOver()) break;
    const candidates = getCrazyhouseMoves(engine);
    const dropList = engine.getLegalDrops();
    if (dropList.length > 0 && (candidates.length === 0 || random() < 0.4)) {
      const d = dropList[Math.floor(random() * dropList.length)];
      const turn = engine.drop(d.piece, d.square)!;
      moves.push({ from: d.square, to: d.square, san: turn.san, drop: d.piece });
      drops++;
    } else {
      const capturing = candidates.filter((m) => m.captured);
      const pool = capturing.length > 0 && random() < 0.6 ? capturing : candidates;
      const pick = pool[Math.floor(random() * pool.length)];
      const turn = engine.move(pick.from, pick.to, pick.promotion)!;
      moves.push({ from: pick.from, to: pick.to, promotion: pick.promotion, san: turn.san });
    }
    fen = engine.getFen();
    state = engine.getCrazyhouseState();
    fens.push(fen);
    states.push(state);
  }
  return { moves, fens, states, drops };
}

describe('replaying a Crazyhouse game the way the Online screen does', () => {
  const game = randomGame(5, 120);

  it('the recording really contains drops and reserves that were non-empty (so the replays below prove something)', () => {
    expect(game.moves.length).toBeGreaterThan(60);
    expect(game.drops).toBeGreaterThan(10);
    expect(game.states.some((s) => s.reserve.w.p + s.reserve.b.p + s.reserve.w.n + s.reserve.b.n > 0)).toBe(true);
  });

  it('a rejoin replay (ONE engine tracking the state itself, drop() for a drop) rebuilds every position and state that was played', () => {
    const engine = new ChessEngine(START_FEN, { crazyhouse: true });
    game.moves.forEach((m, i) => {
      const result = m.drop ? engine.drop(m.drop, m.to!) : engine.move(m.from!, m.to!, m.promotion as 'q' | undefined);
      expect(result, `ply ${i}`).not.toBeNull();
      expect(result!.san).toBe(m.san);
      expect(engine.getFen()).toBe(game.fens[i + 1]);
      expect(engine.getCrazyhouseState()).toEqual(game.states[i + 1]);
      expect(result!.crazyhouse).toEqual(game.states[i + 1]); // what the screen stores on each move record
    });
  });

  it('an opponent_move replay (a FRESH engine built from the previous (fen, state) each ply) gives the same positions and states', () => {
    let fen = START_FEN;
    let state = initialCrazyhouseState();
    game.moves.forEach((m, i) => {
      const step = new ChessEngine(fen, { crazyhouse: true, crazyhouseState: state });
      const result = m.drop ? step.drop(m.drop, m.to!) : step.move(m.from!, m.to!, m.promotion as 'q' | undefined);
      expect(result, `ply ${i}`).not.toBeNull();
      fen = step.getFen();
      state = step.getCrazyhouseState();
      expect(fen).toBe(game.fens[i + 1]);
      expect(state).toEqual(game.states[i + 1]);
    });
  });

  it("a reverted optimistic drop (the server refused it) restores the previous state exactly — the screen keeps the state from before the move", () => {
    const i = game.moves.findIndex((m) => m.drop);
    expect(i).toBeGreaterThan(-1);
    const before = game.states[i];
    const engine = new ChessEngine(game.fens[i], { crazyhouse: true, crazyhouseState: before });
    engine.drop(game.moves[i].drop!, game.moves[i].to!);
    expect(engine.getCrazyhouseState()).not.toEqual(before); // the optimistic state moved on...
    expect(before).toEqual(game.states[i]); // ...but the saved "before" snapshot was not mutated by it
  });
});

describe('Online wiring (no React Native renderer available)', () => {
  it('the wire types carry the Crazyhouse flag on every payload, plus the drop and the state', () => {
    const types = read('types/multiplayer.ts');
    expect(types.match(/isCrazyhouse\?: boolean;/g)?.length).toBe(2); // join_queue + create_challenge
    expect(types.match(/isCrazyhouse: boolean;/g)?.length).toBe(2); // MatchFoundPayload + RejoinStatePayload
    expect(types).toContain('drop?: ReservePieceType;'); // make_move, opponent_move and the rejoin move list
    expect(types.match(/crazyhouse\?: CrazyhouseState;/g)?.length).toBe(2); // opponent_move + rejoin/spectate state
  });

  it('OnlineGameScreen sends the drop, replays it, keeps and reverts the state, and hides what Stockfish/Crazyhouse cannot do', () => {
    const online = read('screens/OnlineGameScreen.tsx');
    expect(online).toContain('const crazyhouse = match.isCrazyhouse === true;');
    expect(online).toContain('...(crazyhouse && move.drop ? { drop: move.drop } : {}),'); // make_move
    expect(online).toContain('? replayEngine.drop(payload.drop, payload.to!)'); // opponent_move
    expect(online).toContain('? replayEngine.drop(m.drop, m.to!)'); // rejoin
    expect(online).toContain('if (crazyhouse) setCrazyhouseState(crazyhouseBeforeMove);'); // the server refused
    expect(online).toContain('if (crazyhouse && ack.crazyhouse !== undefined) setCrazyhouseState(ack.crazyhouse);');
    expect(online).toContain('if (crazyhouse && payload.crazyhouse !== undefined) setCrazyhouseState(payload.crazyhouse);');
    expect(online).toContain('if (crazyhouse) setCrazyhouseState(ack.state.crazyhouse ?? initialCrazyhouseState());');
    expect(online).toContain('plyStateAtView(moveList, viewIndex, (m) => m.crazyhouse, initialCrazyhouseState())');
    expect(online).toContain('crazyhouseState={displayCrazyhouse}');
    expect(online).toContain('compact={spellChess || crazyhouse}');
    expect(online).toContain('premoveColor={giveaway || atomic || duckChess || spellChess || horde || crazyhouse ? undefined : myColor}');
    expect(online).toContain('onPremove={giveaway || atomic || duckChess || spellChess || horde || crazyhouse ? undefined : handleQueuePremove}');
    expect(online).toContain('!duckChess && !spellChess && !horde && !crazyhouse && openingName');
    expect(online).toContain('ratingCategory && !giveaway && !atomic && !duckChess && !spellChess && !horde && !crazyhouse');
    expect(online).toContain('wasMaterialDownRef.current && !giveaway && !atomic && !duckChess && !spellChess && !horde && !crazyhouse');
    expect(online).toContain('crazyhouse={crazyhouse}');
  });

  it('spectators get the Crazyhouse board, reserves and label', () => {
    const spectator = read('screens/SpectatorGameScreen.tsx');
    expect(spectator).toContain('crazyhouse={state.isCrazyhouse}');
    expect(spectator).toContain('crazyhouseState={state.crazyhouse ?? initialCrazyhouseState()}');
    expect(spectator).toContain("' · Crazyhouse'");
    expect(spectator).toContain('payload.crazyhouse !== undefined');
  });
});
