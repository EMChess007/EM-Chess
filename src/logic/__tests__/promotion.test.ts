import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { ChessEngine } from '../ChessEngine';
import { PROMOTION_CHOICES, isPromotionMove, promotionRank } from '../promotion';

describe('isPromotionMove', () => {
  it('a white pawn reaching rank 8 is a promotion, by push or capture target alike', () => {
    expect(isPromotionMove({ type: 'p', color: 'w' }, 'e8')).toBe(true); // push
    expect(isPromotionMove({ type: 'p', color: 'w' }, 'f8')).toBe(true); // capture target
  });

  it('a black pawn reaching rank 1 is a promotion', () => {
    expect(isPromotionMove({ type: 'p', color: 'b' }, 'e1')).toBe(true);
    expect(isPromotionMove({ type: 'p', color: 'b' }, 'd1')).toBe(true);
  });

  it('a pawn not arriving on its last rank is not a promotion', () => {
    expect(isPromotionMove({ type: 'p', color: 'w' }, 'e7')).toBe(false);
    expect(isPromotionMove({ type: 'p', color: 'b' }, 'e2')).toBe(false);
    expect(isPromotionMove({ type: 'p', color: 'w' }, 'e1')).toBe(false); // wrong end for white
    expect(isPromotionMove({ type: 'p', color: 'b' }, 'e8')).toBe(false); // wrong end for black
  });

  it('only pawns promote — any other piece landing on the last rank is an ordinary move', () => {
    for (const type of ['n', 'b', 'r', 'q', 'k'] as const) {
      expect(isPromotionMove({ type, color: 'w' }, 'e8')).toBe(false);
    }
    expect(isPromotionMove(null, 'e8')).toBe(false);
  });

  it('offers exactly the four legal promotion pieces, never a king or pawn', () => {
    expect([...PROMOTION_CHOICES].sort()).toEqual(['b', 'n', 'q', 'r']);
    expect(promotionRank('w')).toBe('8');
    expect(promotionRank('b')).toBe('1');
  });
});

// The reported case: a capture-promotion (exf8) must ask, same as a plain push (e8). Both are
// checked through the real engine for every piece the picker offers — the board hands the chosen
// piece to move()/movePseudoLegal(), so each must honor all four, not just the queen it used to
// be hardcoded to.
describe('promotion through the engine (push and capture, normal and Fog of War paths)', () => {
  // White pawn e7, black rook f8 (capturable), e8 empty (pushable). Kings far away.
  const FEN = '5r1k/4P3/8/8/8/8/8/K7 w - - 0 1';
  const SUFFIX: Record<string, string> = { q: '=Q', r: '=R', b: '=B', n: '=N' };

  for (const mode of ['normal', 'fog'] as const) {
    for (const [label, to] of [
      ['plain push', 'e8'],
      ['capture (exf8)', 'f8'],
    ] as const) {
      it(`${mode}: ${label} is classified as a promotion and honors every chosen piece`, () => {
        const probe = new ChessEngine(FEN, { skipValidation: mode === 'fog' });
        expect(isPromotionMove(probe.getPieceAt('e7'), to)).toBe(true);

        for (const choice of PROMOTION_CHOICES) {
          const engine = new ChessEngine(FEN, { skipValidation: mode === 'fog' });
          const move = mode === 'fog' ? engine.movePseudoLegal('e7', to, choice) : engine.move('e7', to, choice);
          expect(move, `${label} =${choice}`).not.toBeNull();
          expect(move!.promotion).toBe(choice);
          expect(move!.san).toContain(SUFFIX[choice]);
          expect(engine.getPieceAt(to)).toEqual({ type: choice, color: 'w' });
        }
      });
    }
  }

  it('the capture really captures the rook (so this exercises capture+promotion together)', () => {
    const engine = new ChessEngine(FEN);
    const move = engine.move('e7', 'f8', 'n');
    expect(move!.captured).toBe('r');
    expect(move!.promotion).toBe('n');
  });
});

describe('isPromotionMove agrees with chess.js ground truth on real games', () => {
  function randInt(n: number) {
    return Math.floor(Math.random() * n);
  }

  it('flags exactly the legal moves chess.js itself reports as promotions (random games)', () => {
    // Plain counting inside the loop (one assertion at the end) — an expect() per move across tens
    // of thousands of moves made this sweep needlessly slow.
    const mismatches: string[] = [];
    let promotionsSeen = 0;
    let movesChecked = 0;
    for (let g = 0; g < 6; g++) {
      const chess = new Chess();
      for (let ply = 0; ply < 120 && !chess.isGameOver(); ply++) {
        const moves = chess.moves({ verbose: true });
        for (const m of moves) {
          movesChecked++;
          const expected = m.promotion !== undefined;
          if (expected) promotionsSeen++;
          if (isPromotionMove(chess.get(m.from), m.to) !== expected && mismatches.length < 5) {
            mismatches.push(`${m.from}-${m.to} in ${chess.fen()}`);
          }
        }
        chess.move(moves[randInt(moves.length)]);
      }
    }
    // Hand-built positions guarantee promotions (pushes AND captures, both colors, underpromotion
    // squares) get checked every run — random play alone rarely reaches them in so few games.
    for (const fen of ['5r1k/4P3/8/8/8/8/8/K7 w - - 0 1', '8/8/8/8/8/8/4p3/K2R1k1B b - - 0 1', '1n1r3k/2P5/8/8/8/8/8/K7 w - - 0 1']) {
      const chess = new Chess(fen);
      for (const m of chess.moves({ verbose: true })) {
        movesChecked++;
        const expected = m.promotion !== undefined;
        if (expected) promotionsSeen++;
        if (isPromotionMove(chess.get(m.from), m.to) !== expected) mismatches.push(`${m.from}-${m.to} in ${fen}`);
      }
    }
    expect(mismatches).toEqual([]);
    expect(movesChecked).toBeGreaterThan(200);
    // Sanity: the sweep must actually have hit promotions, or it proves nothing.
    expect(promotionsSeen).toBeGreaterThan(0);
  }, 60000);
});

// ChessBoard is a React Native component and this project has no RN test renderer, so the picker
// itself can't be rendered here. This guards the one thing that previously went wrong — a hardcoded
// 'q' completing human promotions silently — by asserting the board source no longer does that and
// is wired to the shared decision function and the picker.
describe('ChessBoard source wiring (no RN renderer available)', () => {
  const source = readFileSync(join(__dirname, '../../components/ChessBoard.tsx'), 'utf8');

  it('does not hardcode a promotion piece when completing or queueing a human move', () => {
    expect(source).not.toMatch(/movePseudoLegal\([^)]*'q'\)/);
    expect(source).not.toMatch(/\.move\([^)]*'q'\)/);
    expect(source).not.toMatch(/promotion:\s*'q'/);
  });

  it('shows the shared picker (a full-screen Modal, not a board-bounded overlay) whenever a promotion is pending, and cancels through it', () => {
    expect(source).toMatch(/<PromotionPicker[\s\S]*?visible=\{pendingPromotion !== null\}/);
    expect(source).toMatch(/onCancel=\{cancelPromotion\}/);
    expect(source).toMatch(/onChoose=\{completePromotion\}/);
    const picker = readFileSync(join(__dirname, '../../components/PromotionPicker.tsx'), 'utf8');
    expect(picker).toMatch(/<Modal visible=\{visible\}/);
    expect(picker).toMatch(/onRequestClose=\{onCancel\}/);
    expect(picker).toContain('accessibilityLabel="Cancel promotion"'); // a tap on the backdrop cancels
  });

  it('asks via the shared isPromotionMove check and the picker for both real moves and premoves', () => {
    expect(source).toContain('isPromotionMove');
    expect(source).toContain('getPromotionChoices');
    expect(source).toMatch(/kind: 'move'/);
    expect(source).toMatch(/kind: 'premove'/);
  });
});
