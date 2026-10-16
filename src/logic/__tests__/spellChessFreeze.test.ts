import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { START_FEN } from '../../types/chess';
import type { PieceColor } from '../../types/chess';
import { ChessEngine } from '../ChessEngine';
import {
  afterSpellChessMove,
  canCastFreeze,
  canCastJump,
  castFreeze,
  castlingRookOrigin,
  checkIsWaivedByFreeze,
  frozenSquaresFor,
  getFreezeZoneSquares,
  initialSpellChessState,
  spellTurnContext,
  type SpellChessState,
} from '../spellChess';

const other = (c: PieceColor): PieceColor => (c === 'w' ? 'b' : 'w');
const sorted = (xs: string[]) => [...xs].sort();

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Freeze lifetime (state level)', () => {
  it('is present for the restricted color on its very next turn, and gone the turn after', () => {
    for (const caster of ['w', 'b'] as const) {
      const victim = other(caster);
      const zone = getFreezeZoneSquares('e5');

      let state = castFreeze(initialSpellChessState(), caster, 'e5');
      // The cast turn: the caster's own move is never restricted, and the victim's restriction is already recorded.
      expect(frozenSquaresFor(state, caster)).toEqual([]);
      expect(sorted(frozenSquaresFor(state, victim))).toEqual(sorted(zone));

      state = afterSpellChessMove(state, caster); // the caster's move lands — must NOT consume the freeze
      expect(sorted(frozenSquaresFor(state, victim))).toEqual(sorted(zone)); // the victim's very next turn
      expect(frozenSquaresFor(state, caster)).toEqual([]);

      state = afterSpellChessMove(state, victim); // the victim's move lands — now it is spent
      expect(frozenSquaresFor(state, victim)).toEqual([]);
      expect(frozenSquaresFor(state, caster)).toEqual([]);
      expect(state.pendingFreeze).toBeNull();
    }
  });
});

describe('spellTurnContext — which state each input is read from', () => {
  // White froze Black (zone around e7); it is now Black's turn.
  const afterWhiteFroze = (): SpellChessState => afterSpellChessMove(castFreeze(initialSpellChessState(), 'w', 'e7'), 'w');
  const e7Zone = getFreezeZoneSquares('e7');

  it('a FROZEN mover who casts their own Freeze is still frozen this turn (the bug: it was read after the cast and came out empty)', () => {
    const state = afterWhiteFroze();
    const ctx = spellTurnContext(state, 'b', { type: 'freeze', center: 'e2' });
    expect(sorted(ctx.frozenSquares)).toEqual(sorted(e7Zone));
    // ...and the zone being cast is reported separately, for the check-waiver, not mixed up with the frozen squares.
    expect(sorted(ctx.freezeZone ?? [])).toEqual(sorted(getFreezeZoneSquares('e2')));
    // The new freeze restricts White's next move, and the one that restricted Black is gone once Black has moved.
    const after = afterSpellChessMove(ctx.stateAfterCast, 'b');
    expect(frozenSquaresFor(after, 'b')).toEqual([]);
    expect(sorted(frozenSquaresFor(after, 'w'))).toEqual(sorted(getFreezeZoneSquares('e2')));
  });

  it('with no cast, frozenSquares and jumpSquare come straight from the state and freezeZone is null', () => {
    const state = afterWhiteFroze();
    const ctx = spellTurnContext(state, 'b', null);
    expect(ctx.stateAfterCast).toBe(state);
    expect(sorted(ctx.frozenSquares)).toEqual(sorted(e7Zone));
    expect(ctx.jumpSquare).toBeNull();
    expect(ctx.freezeZone).toBeNull();
    expect(spellTurnContext(state, 'b', undefined).freezeZone).toBeNull();
  });

  it('the mover is never restricted by the freeze they cast themselves, and a Jump takes effect at once', () => {
    const fresh = initialSpellChessState();
    expect(spellTurnContext(fresh, 'w', { type: 'freeze', center: 'e5' }).frozenSquares).toEqual([]);
    const jump = spellTurnContext(fresh, 'w', { type: 'jump', square: 'd4' });
    expect(jump.jumpSquare).toBe('d4');
    expect(jump.freezeZone).toBeNull();
    expect(jump.frozenSquares).toEqual([]);
  });

  it('a cast that is not allowed (no charge / on cooldown) changes nothing and reports no freeze zone', () => {
    let state = castFreeze(initialSpellChessState(), 'w', 'e5'); // White's Freeze is now on cooldown
    state = afterSpellChessMove(state, 'w');
    expect(canCastFreeze(state, 'w')).toBe(false);
    const ctx = spellTurnContext(state, 'w', { type: 'freeze', center: 'a1' });
    expect(ctx.stateAfterCast).toBe(state);
    expect(ctx.freezeZone).toBeNull();
  });
});

describe('Freeze across whole random games, using the derivation the server and the Online screen use', () => {
  it('nobody ever moves from a frozen square, and a freeze is there for exactly the victim\'s next turn', () => {
    const random = seeded(2024);
    const stats = { plies: 0, restrictedTurns: 0, frozenAndCastAgain: 0, refusals: 0 };

    for (let g = 0; g < 14; g++) {
      let fen = START_FEN;
      let state = initialSpellChessState();
      for (let ply = 0; ply < 60; ply++) {
        const probe = new ChessEngine(fen, { skipValidation: true });
        const mover = probe.getTurn();

        // What the state says BEFORE this turn: a freeze cast against the mover last turn must be there, in full.
        const expectedFrozen = state.pendingFreeze && state.pendingFreeze.restricts === mover ? state.pendingFreeze.squares : [];
        if (expectedFrozen.length > 0) stats.restrictedTurns++;

        // Maybe cast (any available spell, 60% of turns — far more often than a person, to cover the interactions),
        // exactly like a player would before moving.
        let cast: { type: 'freeze'; center: string } | { type: 'jump'; square: string } | null = null;
        if (random() < 0.6) {
          if (canCastFreeze(state, mover) && (random() < 0.7 || !canCastJump(state, mover))) {
            cast = { type: 'freeze', center: 'abcdefgh'[Math.floor(random() * 8)] + (1 + Math.floor(random() * 8)) };
          } else if (canCastJump(state, mover)) {
            const occupied = probe.getBoard().flat().filter((s) => s.piece);
            cast = { type: 'jump', square: occupied[Math.floor(random() * occupied.length)].square };
          }
        }
        if (cast?.type === 'freeze' && expectedFrozen.length > 0) stats.frozenAndCastAgain++;

        const ctx = spellTurnContext(state, mover, cast);
        // THE invariant: the squares frozen for this move are the ones recorded against the mover — cast or no cast.
        expect(sorted(ctx.frozenSquares)).toEqual(sorted(expectedFrozen));

        const freezeEscapeActive = ctx.freezeZone ? checkIsWaivedByFreeze(probe, mover, ctx.freezeZone) : false;
        const engine = new ChessEngine(fen, { skipValidation: true, spellChess: true, frozenSquares: ctx.frozenSquares, jumpSquare: ctx.jumpSquare, freezeEscapeActive });

        const candidates: { from: string; to: string }[] = [];
        for (const sq of engine.getBoard().flat()) {
          if (sq.piece?.color !== mover) continue;
          for (const to of engine.getLegalMoves(sq.square)) candidates.push({ from: sq.square, to });
        }
        if (candidates.length === 0) break;
        // Nothing the engine offers may start on a frozen square...
        expect(candidates.filter((c) => ctx.frozenSquares.includes(c.from))).toEqual([]);
        // ...and a move that does is refused outright.
        const frozenPiece = engine.getBoard().flat().find((s) => s.piece?.color === mover && ctx.frozenSquares.includes(s.square));
        if (frozenPiece) {
          const probeMoves = new ChessEngine(fen, { skipValidation: true }).getLegalMoves(frozenPiece.square);
          for (const to of probeMoves.slice(0, 2)) {
            expect(engine.move(frozenPiece.square, to)).toBeNull();
            stats.refusals++;
          }
        }

        const pick = candidates[Math.floor(random() * candidates.length)];
        const promotion = 'q' as const;
        const played = engine.move(pick.from, pick.to, promotion);
        expect(played, `${pick.from}${pick.to} from ${fen}`).not.toBeNull();
        stats.plies++;
        state = afterSpellChessMove(ctx.stateAfterCast, mover);
        fen = engine.getFen();

        // The freeze that restricted the mover is spent now; only a freeze cast THIS turn (against the other side) remains.
        expect(state.pendingFreeze === null || state.pendingFreeze.restricts === other(mover)).toBe(true);
        if (played!.captured === 'k') break;
      }
    }
    // The run really exercised the scenario (otherwise the assertions above prove nothing).
    expect(stats.plies).toBeGreaterThan(400);
    expect(stats.restrictedTurns).toBeGreaterThan(30);
    expect(stats.frozenAndCastAgain).toBeGreaterThan(3);
    expect(stats.refusals).toBeGreaterThan(10);
  }, 60_000);
});

describe('Freeze and castling — castling moves the rook, so a frozen rook forbids it', () => {
  const FEN_B = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R b KQkq - 0 1';
  const FEN_W = 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1';
  const spell = (fen: string, frozenSquares: string[]) => new ChessEngine(fen, { skipValidation: true, spellChess: true, frozenSquares });

  it('works out the rook for each castling move, and ignores everything else', () => {
    expect(castlingRookOrigin('e1', 'g1', 'k')).toBe('h1');
    expect(castlingRookOrigin('e1', 'c1', 'k')).toBe('a1');
    expect(castlingRookOrigin('e8', 'g8', 'k')).toBe('h8');
    expect(castlingRookOrigin('e8', 'c8', 'k')).toBe('a8');
    expect(castlingRookOrigin('e1', 'f1', 'k')).toBeNull(); // an ordinary king step
    expect(castlingRookOrigin('e2', 'g2', 'k')).toBeNull(); // not the home rank
    expect(castlingRookOrigin('e1', 'g1', 'r')).toBeNull(); // not a king
  });

  it('a frozen KING-SIDE rook forbids O-O but not O-O-O (both colors, both ways of asking)', () => {
    for (const [fen, king, kingSide, queenSide, rook] of [
      [FEN_B, 'e8', 'g8', 'c8', 'h8'],
      [FEN_W, 'e1', 'g1', 'c1', 'h1'],
    ] as const) {
      const engine = spell(fen, [rook]);
      expect(engine.getLegalMoves(king)).not.toContain(kingSide);
      expect(engine.getLegalMoves(king)).toContain(queenSide);
      expect(spell(fen, [rook]).move(king, kingSide)).toBeNull();
      expect(spell(fen, [rook]).move(king, queenSide)).not.toBeNull();
    }
  });

  it('a frozen QUEEN-SIDE rook forbids O-O-O but not O-O', () => {
    const engine = spell(FEN_B, ['a8']);
    expect(engine.getLegalMoves('e8')).toContain('g8');
    expect(engine.getLegalMoves('e8')).not.toContain('c8');
    expect(spell(FEN_B, ['a8']).move('e8', 'c8')).toBeNull();
    expect(spell(FEN_B, ['a8']).move('e8', 'g8')).not.toBeNull();
  });

  it('a frozen king cannot castle at all, and with nothing frozen castling is untouched', () => {
    const frozenKing = spell(FEN_B, ['e8']);
    expect(frozenKing.getLegalMoves('e8')).toEqual([]);
    expect(spell(FEN_B, ['e8']).move('e8', 'g8')).toBeNull();
    const free = spell(FEN_B, []);
    expect(free.getLegalMoves('e8')).toEqual(expect.arrayContaining(['g8', 'c8']));
  });
});

describe('Freeze wiring (no React Native renderer available)', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '../../', rel), 'utf8').replace(/\r\n/g, '\n');

  it('no call site derives frozen squares from a state that already has the mover\'s own cast applied', () => {
    for (const file of ['screens/OnlineGameScreen.tsx', 'screens/BotGameScreen.tsx', 'screens/LocalGameScreen.tsx', 'components/ChessBoard.tsx']) {
      const src = read(file);
      expect(src, file).not.toMatch(/frozenSquaresFor\(\s*(spellStateAfterCast|stateAfterCast)\b/);
    }
  });

  it('the Online screen derives both its live and its rejoin replay through spellTurnContext', () => {
    const online = read('screens/OnlineGameScreen.tsx');
    expect(online).toContain('spellTurnContext(spellBeforeOpponentMove, opponentColor, payload.spell)');
    expect(online).toContain('spellTurnContext(replaySpellState, mover, m.spell)');
    expect(online).not.toContain('frozenSquaresFor(');
  });

  it('the bot and the board read the freeze against the side to move from the state BEFORE any cast this turn', () => {
    expect(read('screens/BotGameScreen.tsx')).toContain('frozenSquaresFor(spellState, botColor)');
    expect(read('components/ChessBoard.tsx')).toContain('frozenSquaresFor(spellState, turnFromFen(shownFen))');
  });
});
