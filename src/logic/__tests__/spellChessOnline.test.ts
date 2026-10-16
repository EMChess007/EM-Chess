import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Source pins for the parts of Spell Chess that live in screens (the project has no React Native renderer, so these are asserted on the
 * source text, like the other screen-level pins). Added when Spell Chess was merged onto the refactored board / rejoin flow: each pin
 * names a way that merge (or a later one) could silently drop the Spell layer without any other test noticing.
 */
const read = (rel: string) => readFileSync(join(__dirname, '../..', rel), 'utf8').replace(/\r\n/g, '\n');

describe('Spell Chess online: the spell state follows every way a position reaches the screen', () => {
  const online = read('screens/OnlineGameScreen.tsx');

  it('a rejoin answer of kind "state" restores the spell state (or the initial one)', () => {
    expect(online).toContain("if (outcome.kind === 'state') {");
    expect(online).toContain('if (spellChess) setSpellState(outcome.state.spellState ?? initialSpellChessState());');
  });

  it('the rejoin rebuild replays every ply through spellTurnContext, so the frozen squares / jump square / waiver of THAT ply are used', () => {
    expect(online).toMatch(/spellTurnContext\(replaySpellState, mover, m\.spell\)/);
    expect(online).toContain('replaySpellState = afterSpellChessMove(stateAfterCast, mover);');
  });

  it('an opponent move adopts the server spell state and replays through spellTurnContext with the state BEFORE the cast', () => {
    expect(online).toContain('if (spellChess && payload.spellState !== undefined) setSpellState(payload.spellState);');
    expect(online).toContain('spellTurnContext(spellBeforeOpponentMove, opponentColor, payload.spell)');
  });

  it('our own move sends the cast and adopts the spell state of the ack (and restores it when the server refuses)', () => {
    expect(online).toContain('...(spellChess && move.spell ? { spell: move.spell } : {}),');
    expect(online).toContain('if (spellChess && ack.spellState !== undefined) setSpellState(ack.spellState);');
    expect(online).toContain('if (spellChess) setSpellState(spellStateBeforeMove);');
  });

  it('the board is given the DISPLAYED position spell state (the history entry when reviewing)', () => {
    expect(online).toContain('spellState={displaySpellState}');
    expect(online).toMatch(/moveList\[\(viewIndex as number\) - 1\]\?\.spellState \?\? initialSpellChessState\(\)/);
  });

  it('there is no premove in Spell Chess (a possible cast changes which moves are legal) - online, against a bot and local', () => {
    expect(online).toContain('premoveColor={giveaway || atomic || duckChess || spellChess ? undefined : myColor}');
    expect(read('screens/BotGameScreen.tsx')).toContain('premoveColor={giveaway || atomic || duckChess || spellChess ? undefined : userColor}');
  });
});

describe('Spell Chess spectating: the spell state arrives with the state and with every move', () => {
  const spectator = read('screens/SpectatorGameScreen.tsx');

  it('spectate state and live moves both carry the spell state into the board', () => {
    expect(spectator).toContain('...(payload.spellState !== undefined ? { spellState: payload.spellState } : {}),');
    expect(spectator).toContain('spellState={state.spellState ?? initialSpellChessState()}');
    expect(spectator).toContain('spellChess={state.isSpellChess}');
  });

  it('the spectator notation shows the cast ("F@e7 e4")', () => {
    expect(spectator).toContain('spellMoveNotation({ san: payload.san ?? \'?\' }, payload.spell)');
  });
});

describe('Spell Chess on the shared board: the Spell layer sits on the refactored board, not on the old one', () => {
  const board = read('components/ChessBoard.tsx');

  it('uses the shared gesture hook and the shared PromotionPicker, with no inline PanResponder or promotion Modal', () => {
    expect(board).toContain('{...panHandlers}');
    expect(board).toContain('<PromotionPicker');
    expect(board).not.toContain('PanResponder.create');
    expect(board).not.toContain('<Modal');
  });

  it('the Freeze/Jump bar exists only for Spell Chess and only with a spell state', () => {
    expect(board).toContain('{spellChess && spellState && (');
    expect(board).toContain('<View style={styles.spellBar}>');
  });

  it('the board is wrapped in a fragment so the bar sits UNDER it, outside the bordered board', () => {
    const fragmentOpen = board.indexOf('    <>\n      <View style={styles.border}>');
    const bar = board.indexOf('{spellChess && spellState && (');
    const picker = board.indexOf('<PromotionPicker');
    expect(fragmentOpen).toBeGreaterThan(0);
    expect(bar).toBeGreaterThan(fragmentOpen);
    expect(picker).toBeGreaterThan(bar);
  });

  it('a tap in cast mode picks the target instead of selecting a piece (Freeze: any square; Jump: an occupied one)', () => {
    expect(board).toContain("setPendingCast({ type: 'freeze', center: square, squares: getFreezeZoneSquares(square) });");
    expect(board).toContain("} else if (engine.getPieceAt(square)) {\n        setPendingCast({ type: 'jump', square });");
  });

  it('the cast rides on the move only when the move lands (finishRegularMove), and the pending zone is previewed on the squares', () => {
    expect(board).toContain('const move = spellChess && pendingCast ? { ...result.move, spell: pendingCast } : result.move;');
    expect(board).toContain('isPendingFreeze={spellChess && pendingFreezeZone !== null && pendingFreezeZone.includes(square.square)}');
    expect(board).toContain('isFrozen={spellChess && spellFrozenSquares.includes(square.square)}');
  });

  it('the cast state is dropped when the position changes (a move landed, Undo, a new game)', () => {
    expect(board).toMatch(/setCastMode\(null\);\n\s+setPendingCast\(null\);\n\s+\}, \[fen\]\);/);
  });
});
