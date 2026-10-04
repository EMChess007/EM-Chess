import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChessEngine } from '../ChessEngine';
import { getGiveawayMoves, getGiveawayWinner } from '../giveaway';
import { START_FEN } from '../../types/chess';

// Every Giveaway engine is built like this: skipValidation (a captured king makes later strict FEN
// reloads fail) and the giveaway option (no castling, king promotion, no check marks in SAN).
const giveawayEngine = (fen: string) => new ChessEngine(fen, { skipValidation: true, giveaway: true });
const ordinaryEngine = (fen: string) => new ChessEngine(fen, { skipValidation: true });
const tos = (moves: { to: string }[]) => moves.map((m) => m.to).sort();

describe('mandatory capture', () => {
  // White: Ke1, Ra1, Pe4. Black: Ke8, Pd5. Only e4xd5 captures anything.
  const FEN = '4k3/8/8/3p4/4P3/8/8/R3K3 w - - 0 1';

  it('when only one piece can capture, that capture is the ONLY legal move on the whole board', () => {
    const moves = getGiveawayMoves(giveawayEngine(FEN));
    expect(moves.map((m) => `${m.from}${m.to}`)).toEqual(['e4d5']);
    expect(moves[0].captured).toBe('p');
  });

  it("collapses every OTHER piece's move list to empty (the capture rule is global, not per piece)", () => {
    const engine = giveawayEngine(FEN);
    // The rook and king have plenty of quiet moves in ordinary chess — none are legal now.
    expect(ordinaryEngine(FEN).getPseudoLegalMoves('w').filter((m) => m.from === 'a1').length).toBeGreaterThan(0);
    expect(getGiveawayMoves(engine, 'a1')).toEqual([]);
    expect(getGiveawayMoves(engine, 'e1')).toEqual([]);
    expect(getGiveawayMoves(engine, 'e4')).toHaveLength(1);
  });

  it('with no capture available anywhere, every ordinary move stays legal', () => {
    const fen = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
    const engine = giveawayEngine(fen);
    expect(getGiveawayMoves(engine)).toHaveLength(engine.getPseudoLegalMoves('w').length);
  });

  it('a king can be the capturing piece, and a capture offered by several pieces keeps all of them', () => {
    // Pawn e4xd5 and rook d1xd5 both capture the pawn on d5: both stay legal, nothing else does.
    const moves = getGiveawayMoves(giveawayEngine('4k3/8/8/3p4/4P3/8/8/3RK3 w - - 0 1'));
    expect(moves.map((m) => `${m.from}${m.to}`).sort()).toEqual(['d1d5', 'e4d5']);
  });

  it('en passant counts as a capture, so it becomes the only legal move', () => {
    const moves = getGiveawayMoves(giveawayEngine('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'));
    expect(moves.map((m) => `${m.from}${m.to}`)).toEqual(['e5d6']);
    expect(moves[0].captured).toBe('p');
  });
});

describe('winning by having no legal move', () => {
  it('a side whose only piece is blocked WINS (stuck wins, it does not lose)', () => {
    // Black pawn a4 is blocked by the white pawn a3 and has no capture: black to move, no moves.
    const engine = giveawayEngine('8/8/8/8/p7/P7/8/8 b - - 0 1');
    expect(getGiveawayMoves(engine)).toEqual([]);
    expect(getGiveawayWinner(engine)).toBe('b');
  });

  it('the same holds for White', () => {
    expect(getGiveawayWinner(giveawayEngine('8/8/8/8/p7/P7/8/8 w - - 0 1'))).toBe('w');
  });

  it('a side with no pieces left wins', () => {
    expect(getGiveawayWinner(giveawayEngine('8/8/8/8/8/P7/8/8 b - - 0 1'))).toBe('b');
  });

  it('the opponent reduced to one stuck piece after a capture: capturer moves, the stuck side then wins', () => {
    // White rook a1 takes the black rook a8; the lone black pawn h7 is blocked by a white pawn on
    // h6 (and cannot capture), so after the capture Black to move has nothing and wins.
    const engine = giveawayEngine('r7/7p/7P/8/8/8/8/R7 w - - 0 1');
    expect(getGiveawayMoves(engine).map((m) => `${m.from}${m.to}`)).toEqual(['a1a8']);
    engine.movePseudoLegal('a1', 'a8');
    expect(getGiveawayWinner(engine)).toBe('b');
  });

  it('nobody has won while both sides still have a legal move', () => {
    expect(getGiveawayWinner(giveawayEngine(START_FEN))).toBeNull();
  });
});

describe('the king is just a piece', () => {
  // Black king a8 sits on an open file facing the white rook: capturing it is the only legal move.
  const FEN = 'k7/8/8/8/8/8/8/R3K3 w - - 0 1';

  it('a king can be captured directly, and the capture is mandatory', () => {
    const engine = giveawayEngine(FEN);
    const moves = getGiveawayMoves(engine);
    expect(moves.map((m) => `${m.from}${m.to}`)).toEqual(['a1a8']);
    const applied = engine.movePseudoLegal('a1', 'a8');
    expect(applied?.captured).toBe('k');
  });

  it('after the king falls the game continues normally — and the side with no pieces left wins', () => {
    const engine = giveawayEngine(FEN);
    engine.movePseudoLegal('a1', 'a8');
    // Black has no pieces at all and is to move: Black wins (the captured king did NOT end the game).
    expect(getGiveawayWinner(engine)).toBe('b');
    // The kingless position survives a FEN round trip (Giveaway builds engines from fen constantly).
    expect(() => giveawayEngine(engine.getFen())).not.toThrow();
  });

  it('there is no check: a king may step next to an enemy rook or stay on its file', () => {
    // White king e1 with a black rook on the e-file would be "in check" in ordinary chess.
    const engine = giveawayEngine('4r3/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(engine.getPseudoLegalMoves('w').some((m) => m.captured === 'r')).toBe(false); // sanity
    // Ke1 can capture nothing here, so every king move is legal, including staying on the e-file.
    expect(tos(getGiveawayMoves(engine, 'e1'))).toEqual(['d1', 'd2', 'e2', 'f1', 'f2']);
  });
});

describe('promotion', () => {
  it('a plain push offers Queen, Rook, Bishop, Knight AND King', () => {
    const promos = getGiveawayMoves(giveawayEngine('8/4P3/8/8/8/8/8/8 w - - 0 1'), 'e7').map((m) => m.promotion);
    expect(promos.sort()).toEqual(['b', 'k', 'n', 'q', 'r']);
  });

  it('ordinary chess (no giveaway option) is unchanged: no king promotion offered', () => {
    const promos = ordinaryEngine('8/4P3/8/8/8/8/8/8 w - - 0 1')
      .getPseudoLegalMoves('w')
      .filter((m) => m.from === 'e7')
      .map((m) => m.promotion);
    expect(promos.sort()).toEqual(['b', 'n', 'q', 'r']);
  });

  it('a mandatory capture-promotion offers all five pieces and nothing else', () => {
    const moves = getGiveawayMoves(giveawayEngine('5r2/4P3/8/8/8/8/8/8 w - - 0 1'));
    expect(tos(moves)).toEqual(['f8', 'f8', 'f8', 'f8', 'f8']);
    expect(moves.map((m) => m.promotion).sort()).toEqual(['b', 'k', 'n', 'q', 'r']);
  });

  it('promoting to a king really puts a king on the board (and records =K in the SAN)', () => {
    const engine = giveawayEngine('5r2/4P3/8/8/8/8/8/8 w - - 0 1');
    const applied = engine.movePseudoLegal('e7', 'f8', 'k');
    expect(applied?.promotion).toBe('k');
    expect(applied?.captured).toBe('r');
    expect(applied?.san).toContain('=K');
    expect(engine.getPieceAt('f8')).toEqual({ type: 'k', color: 'w' });
  });

  it('a SECOND king (promoting while your own king is alive) survives the FEN reload every ply goes through', () => {
    // chess.js refuses to place a second king of one colour when loading a FEN, so without special
    // handling the promoted king silently vanished on the very next move (screens and bots rebuild
    // their engine from the FEN every ply).
    const start = giveawayEngine('7k/4P3/8/8/8/8/8/K7 w - - 0 1');
    start.movePseudoLegal('e7', 'e8', 'k');
    const fen = start.getFen();
    expect(fen.split(' ')[0]).toBe('4K2k/8/8/8/8/8/8/K7');

    const reloaded = giveawayEngine(fen);
    const whiteKings = reloaded.getBoard().flat().filter((s) => s.piece?.type === 'k' && s.piece.color === 'w').map((s) => s.square).sort();
    expect(whiteKings).toEqual(['a1', 'e8']);
    expect(reloaded.getFen()).toBe(fen);

    // Both of White's kings can still move, and either may be captured like any piece.
    const whiteToMove = giveawayEngine('4K2k/8/8/8/8/8/8/K7 w - - 0 1');
    expect(getGiveawayMoves(whiteToMove, 'e8').length).toBeGreaterThan(0);
    expect(getGiveawayMoves(whiteToMove, 'a1').length).toBeGreaterThan(0);
    const blackToMove = giveawayEngine('4K2k/8/8/8/8/8/8/K7 b - - 0 1');
    expect(blackToMove.getPieceAt('e8')).toEqual({ type: 'k', color: 'w' });
    expect(blackToMove.getPieceAt('a1')).toEqual({ type: 'k', color: 'w' });
  });

  it('the same holds for Black, and when the extra king is the one found first in FEN order', () => {
    const black = giveawayEngine('k7/8/8/8/8/8/4p3/7K b - - 0 1');
    black.movePseudoLegal('e2', 'e1', 'k');
    const reloaded = giveawayEngine(black.getFen());
    const blackKings = reloaded.getBoard().flat().filter((s) => s.piece?.type === 'k' && s.piece.color === 'b').map((s) => s.square).sort();
    expect(blackKings).toEqual(['a8', 'e1']);

    // Two white kings with the "extra" one on an earlier rank than the original.
    const rebuilt = giveawayEngine('8/8/3K4/8/8/8/8/K6k w - - 0 1');
    expect(rebuilt.getBoard().flat().filter((s) => s.piece?.type === 'k' && s.piece.color === 'w')).toHaveLength(2);
  });

  it('black pawns promote on rank 1, also to a king', () => {
    const promos = getGiveawayMoves(giveawayEngine('8/8/8/8/8/8/4p3/8 b - - 0 1'), 'e2').map((m) => m.promotion);
    expect(promos.sort()).toEqual(['b', 'k', 'n', 'q', 'r']);
  });
});

describe('no castling, no check marks', () => {
  // Rooks on both corners, rights intact, nothing capturable — castling would be on offer in chess.
  const FEN = '4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1';

  it('castling is offered by ordinary chess but never in Giveaway', () => {
    expect(tos(ordinaryEngine(FEN).getPseudoLegalMoves('w').filter((m) => m.from === 'e1'))).toEqual(
      expect.arrayContaining(['c1', 'g1'])
    );
    const giveaway = tos(getGiveawayMoves(giveawayEngine(FEN), 'e1'));
    expect(giveaway).not.toContain('c1');
    expect(giveaway).not.toContain('g1');
    expect(giveaway).toEqual(['d1', 'd2', 'e2', 'f1', 'f2']);
  });

  it("SAN carries no '+' (chess.js's check marker means nothing here), unlike ordinary chess", () => {
    // Ra1-a8 gives "check" to the king on h8 along the back rank in ordinary chess.
    const fen = '7k/8/8/8/8/8/8/R3K3 w - - 0 1';
    expect(ordinaryEngine(fen).movePseudoLegal('a1', 'a8')?.san).toBe('Ra8+');
    expect(giveawayEngine(fen).movePseudoLegal('a1', 'a8')?.san).toBe('Ra8');
  });
});

// The "shown as available but rejected when played" bug class this project already hit once (en
// passant FEN serialization): every move Giveaway offers must also be accepted by a FRESH engine
// rebuilt from the position's FEN — exactly what ChessBoard does when a move is actually tapped.
describe('Giveaway move generation vs execution (seeded random games)', () => {
  function rng(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('every offered move is accepted on a fresh engine, captures stay mandatory, FEN reloads survive', () => {
    const random = rng(20261003);
    const problems: string[] = [];
    let finished = 0;
    let checked = 0;

    for (let g = 0; g < 25; g++) {
      let engine = giveawayEngine(START_FEN);
      for (let ply = 0; ply < 220; ply++) {
        const winner = getGiveawayWinner(engine);
        if (winner) {
          finished++;
          break;
        }
        const moves = getGiveawayMoves(engine);
        const anyCapture = engine.getPseudoLegalMoves(engine.getTurn()).some((m) => m.captured);
        if (anyCapture && moves.some((m) => !m.captured)) {
          problems.push(`non-capture offered despite a capture: ${engine.getFen()}`);
        }
        const fen = engine.getFen();
        for (const m of moves.slice(0, 6)) {
          checked++;
          const probe = giveawayEngine(fen);
          const result = probe.movePseudoLegal(m.from, m.to, m.promotion);
          if (!result || !!result.captured !== !!m.captured) {
            problems.push(`offered ${m.from}${m.to}${m.promotion ?? ''} but execution disagreed in ${fen}`);
          }
        }
        const pick = moves[Math.floor(random() * moves.length)];
        const next = giveawayEngine(fen);
        if (!next.movePseudoLegal(pick.from, pick.to, pick.promotion)) {
          problems.push(`chosen move failed to apply: ${fen}`);
          break;
        }
        engine = giveawayEngine(next.getFen()); // forces the strict-reload path every ply
      }
    }

    expect(problems.slice(0, 5)).toEqual([]);
    expect(checked).toBeGreaterThan(500);
    expect(finished).toBeGreaterThan(0); // sanity: games really do end via the no-legal-move rule
  }, 60000);
});

describe('performance budget', () => {
  it('getGiveawayMoves stays cheap on a realistic 40+ move game', () => {
    // Walk 90 plies of random-but-deterministic Giveaway play to a busy middlegame/endgame.
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let engine = giveawayEngine(START_FEN);
    for (let ply = 0; ply < 90 && !getGiveawayWinner(engine); ply++) {
      const moves = getGiveawayMoves(engine);
      const pick = moves[Math.floor(next() * moves.length)];
      engine.movePseudoLegal(pick.from, pick.to, pick.promotion);
    }
    const start = performance.now();
    for (let i = 0; i < 300; i++) getGiveawayMoves(engine);
    const perCallMs = (performance.now() - start) / 300;
    // Very generous (typically ~0.1ms): this runs on every piece tap and every bot turn, so a
    // regression to the old per-candidate chess.js Move-wrapper cost would blow well past it.
    expect(perCallMs).toBeLessThan(5);
  });
});

// No React Native renderer in this project, so the screen/board wiring is guarded at source level
// for the parts that, if forgotten, would silently break the rules or leak the variant online.
describe('wiring (no RN renderer available)', () => {
  // Line endings normalised to LF: the source files are checked out with CRLF on Windows.
  const read = (rel: string) => readFileSync(join(__dirname, '../../', rel), 'utf8').replace(/\r\n/g, '\n');
  const board = read('components/ChessBoard.tsx');

  it("ChessBoard gates a tapped move on getGiveawayMoves BEFORE executing it (movePseudoLegal alone isn't strict enough)", () => {
    const gate = board.indexOf('getGiveawayMoves(moveEngine, from)');
    const execute = board.indexOf('moveEngine.movePseudoLegal(from, to, promotion)');
    expect(gate).toBeGreaterThan(-1);
    expect(execute).toBeGreaterThan(gate);
  });

  it('ChessBoard builds its engines with the giveaway option and shows Giveaway targets only', () => {
    expect(board).toContain('skipValidation: usesPseudoLegalMoves, giveaway');
    expect(board).toContain('getGiveawayMoves(engine, selectedSquare)');
  });

  for (const screen of ['screens/LocalGameScreen.tsx', 'screens/BotGameScreen.tsx']) {
    it(`${screen} feeds the Giveaway winner into getGameOutcome and the saved-game payload`, () => {
      const src = read(screen);
      // atomicWinner follows giveawayWinner as getGameOutcome's last argument (see the Atomic variant).
      expect(src).toMatch(/getGameOutcome\([\s\S]*?giveawayWinner,\s*atomicWinner,\s*duckWinner\s*\)/);
      expect(src).toContain('giveawayWinner,\n        giveaway,');
    });
  }

  it('Giveaway is online for 1v1 (quick match + challenges) but still excluded from tournaments', () => {
    // See giveawayOnline.test.ts for the online wiring; the Online pickers no longer exclude it.
    expect(read('screens/ChallengeScreen.tsx')).toContain("excludeVariants={['duckChess']}");
    expect(read('screens/OnlineTimeControlSelectScreen.tsx')).toContain("excludeVariants={['duckChess']}");
    expect(read('screens/TournamentScreen.tsx')).toContain("'giveaway'");
  });

  it('the bot never asks Stockfish for a Giveaway move', () => {
    const bot = read('screens/BotGameScreen.tsx');
    const giveawayBranch = bot.indexOf('if (giveaway) {');
    // lastIndexOf: the earlier getBestMove call is the (separate) hint effect, not the bot's move.
    const stockfishCall = bot.lastIndexOf('engineRuntime.engine.getBestMove');
    expect(giveawayBranch).toBeGreaterThan(-1);
    expect(bot).toContain('chooseGiveawayBotMove(moveEngine');
    // The Stockfish call sits behind `if (!move)`, which the Giveaway branch has already satisfied.
    expect(stockfishCall).toBeGreaterThan(giveawayBranch);
  });
});
