import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CHATURAJI W3 - wiring pins, for the parts the screen tests (chaturajiLocal / chaturajiOnline .dom.test.tsx) do not reach: App.tsx's navigation, and the rule that no 4-seat
 * UI file may name a square, size a board or read a cell through the CROSS board's module-level helpers any more (each of those silently misreads the 8 x 8 board - that is
 * what the screen tests found). Source scans, like the other `*App.test.ts` files; they check the shape, the screen tests check the behaviour.
 */
const ROOT = join(__dirname, '../../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const app = read('App.tsx');

describe('navigation', () => {
  it('the Play menu\'s Chaturaji buttons start the existing 4-seat flow with the variant, Online behind the login gate, and the resume link knows which game it is', () => {
    expect(app).toContain("onChaturaji={() => setScreen({ name: 'fourPlayerSetup', variant: 'chaturaji', seats: defaultSeatConfig() })}");
    expect(app).toContain("onChaturajiOnline={() => authSession && setScreen({ name: 'fourPlayerOnlineTimeControl', variant: 'chaturaji', token: authSession.token })}");
    expect(app).toContain('fourPlayerResumeVariant={fourResume ? fourVariantOf(fourResume.match) : undefined}');
    const menu = read('src/screens/PlayModeSelectScreen.tsx');
    expect(menu).toContain('const handleChaturajiOnline = requireLogin(onChaturajiOnline);');
    expect(menu).toContain("resumeLink('chaturaji')");
    expect(menu).toContain("resumeLink('ffa')");
    expect(menu).toContain("resumeLink('giveaway')");
  });

  it('the flow after the menu is variant-driven for every game: one setup, one time-control step (no Daily), one game screen, one queue', () => {
    for (const screen of ['fourPlayerSetup', 'fourPlayerBotSelect', 'fourPlayerTimeControl', 'fourPlayerGame', 'fourPlayerOnlineTimeControl', 'fourPlayerMatchmaking']) {
      expect(app, screen).toMatch(new RegExp(`name: '${screen}'[^}]*variant`));
    }
    expect(app).toContain("excludeCategories={['daily']}");
    expect(app).toContain("excludeCategories={['daily', 'unlimited']}");
    expect(app).toContain('variant: fourVariantOf(match), token, timeControl'); // Play again queues for the game that was just played
    expect(app).not.toMatch(/variant: 'chaturaji'[^\n]*(daily|unlimited)/);
  });
});

describe('no 4-seat UI file reads the 8 x 8 board through the cross board\'s helpers', () => {
  const FILES = ['src/components/FourPlayerBoard.tsx', 'src/screens/FourPlayerGameScreen.tsx', 'src/screens/FourPlayerOnlineGameScreen.tsx', 'src/screens/FourPlayerSpectatorScreen.tsx', 'src/components/FourPlayerSeatStrip.tsx', 'src/components/FourPlayerResultCard.tsx'];

  it('none of them imports the cross board\'s SIZE / VALID / index / fileOf / rankOf / squareName / parseSquare / fromDisplay / toDisplay / getFourPlayerCellSize', () => {
    const forbidden = ['SIZE', 'VALID', 'index', 'fileOf', 'rankOf', 'squareName', 'parseSquare', 'fromDisplay', 'toDisplay', 'getFourPlayerCellSize', 'moveLabel', 'PLAYABLE_SQUARES'];
    for (const file of FILES) {
      const imports = [...read(file).matchAll(/import \{([^}]*)\} from '\.\.\/logic\/fourPlayer';/g)].flatMap((m) => m[1].split(',').map((name) => name.trim().replace(/^type /, '')));
      for (const name of forbidden) expect(imports, `${file} imports ${name}`).not.toContain(name);
    }
  });

  it('the online reducer and session name and parse squares on the ROOM\'s board', () => {
    const online = read('src/logic/fourPlayerOnline.ts');
    expect(online).toContain('geometryOf(state.rules).parseSquare');
    expect(online).not.toMatch(/\bparseSquare\(/);
    expect(online).toContain('const name = rules ? geometryOf(rules).squareName : squareName;');
    const session = read('src/logic/fourPlayerOnlineSession.ts');
    expect(session).toContain('movePayloadFor(view.roomId, move, view.state.rules)');
    expect(session).toContain('moveLabelOn(move, geometryOf(view.state.rules))');
  });

  it('the board draws a king under attack as an amber ring in Chaturaji and the red check square in 4 Player Chess only', () => {
    const board = read('src/components/FourPlayerBoard.tsx');
    expect(board).toContain('checked={!chaturaji && checkedSquares.has(square)}');
    expect(board).toContain('attacked={chaturaji && checkedSquares.has(square)}');
    expect(board).toContain('boat={chaturaji && (pieceType === ROOK || pieceType === PROMOTED_ROOK)}');
    expect(board).toContain('promoted={chaturaji && !!lastMove?.promoted && lastMove.to === square}');
    expect(board).toContain('onlyPromotionType(state)');
  });
});

describe('the local screens stay local', () => {
  it('the local game and setup screens do not know the socket or the wire (Chaturaji included)', () => {
    for (const file of ['src/screens/FourPlayerGameScreen.tsx', 'src/screens/FourPlayerSetupScreen.tsx', 'src/components/ChaturajiRulesSheet.tsx', 'src/components/KingAttackedPill.tsx', 'src/components/BoatIcon.tsx']) {
      expect(read(file), file).not.toMatch(/api\/socket|fourPlayerWire|fourPlayerOnline|useFourPlayerOnlineGame/);
    }
  });

  it('the game-only seam of the local screen is optional and never passed by the app', () => {
    expect(read('src/screens/FourPlayerGameScreen.tsx')).toContain('startFrom?: FourPlayerState;');
    expect(app).not.toContain('startFrom');
  });
});

describe('the rules sheet is reachable from every place the spec lists', () => {
  it('the menu card, the setup screen and both game screens (local and online) open the same sheet', () => {
    for (const [file, marker] of [
      ['src/screens/PlayModeSelectScreen.tsx', '<ChaturajiRulesSheet visible={rulesOpen}'],
      ['src/screens/FourPlayerSetupScreen.tsx', '<ChaturajiRulesSheet visible={rulesOpen}'],
      ['src/screens/FourPlayerGameScreen.tsx', '<ChaturajiRulesSheet visible={rulesOpen}'],
      ['src/screens/FourPlayerOnlineGameScreen.tsx', '<ChaturajiRulesSheet visible={rulesOpen}'],
    ]) {
      expect(read(file), file).toContain(marker);
    }
  });
});
