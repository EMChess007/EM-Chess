import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TWO_PLAYER_VARIANT_IDS } from '../../components/VariantSelector';
import { FROM_POSITION_TEST_ID, playRowTestId } from '../../logic/playMenuIds';
import { findNodes, findOne, parseBounds } from '../../../scripts/android/lib/hierarchy.mjs';
import { FROM_POSITION_ROW, isLowRow, playRow } from '../../../scripts/android/lib/playMenu.mjs';
import PlayModeSelectScreen from '../PlayModeSelectScreen';

/**
 * THE PLAY MENU'S ROWS HAVE STABLE TESTIDS (command #66, item 0). PR #49 run 44883195830 (attempt 2, large-touch) failed `{ text: 'Knightmate', below: 'Local' }`: the find's own scrolling had
 * pushed the heading "Local" off the window. Every 2-player variant row of the Bots and Local cards (and the Engine vs Engine card's four, and From Position) now carries `play-<card>-<variant>`
 * from ONE helper, the Android harness looks rows up by it, and this test proves (a) every variant of the selector has its row in BOTH cards, so a new variant cannot ship without one, (b) the
 * harness's copy of the id is the app's, and (c) the harness finds the row with NO heading on screen - the exact tree of the failed run.
 */
vi.mock('../../api/socket', () => ({ connectSocket: () => ({ on: () => {}, off: () => {}, emit: () => {} }), disconnectSocket: () => {} }));

const cap = (v: string) => v[0].toUpperCase() + v.slice(1);
const handlerNames = (prefix: string) => TWO_PLAYER_VARIANT_IDS.map((v) => `${prefix}${cap(v)}`);
const ENGINE = ['classic', 'chess960', 'kingOfTheHill', 'threeCheck'] as const;

function menu() {
  const handlers: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of [...handlerNames('onLocal'), ...handlerNames('onBot'), ...ENGINE.map((v) => `onEngineVsEngine${cap(v)}`), 'onFromPosition', 'onBoardEditor', 'onImportPgn']) handlers[name] = vi.fn();
  const props = { authUser: null, onAuthPress: vi.fn(), onBack: vi.fn(), ...handlers } as unknown as ComponentProps<typeof PlayModeSelectScreen>;
  return { props, handlers };
}

describe('Play-menu row testIDs', () => {
  it('the ids are the literal strings the harness uses', () => {
    expect(playRowTestId('local', 'knightmate')).toBe('play-local-knightmate');
    expect(playRowTestId('bots', 'racingKings')).toBe('play-bots-racingKings');
    expect(playRowTestId('engine', 'classic')).toBe('play-engine-classic');
    expect(FROM_POSITION_TEST_ID).toBe('play-editor-from-position');
    expect(TWO_PLAYER_VARIANT_IDS).toHaveLength(15);
  });

  it('every 2-player variant has its row in the Local AND the Bots card, with its testID, and the row opens that variant', () => {
    const { props, handlers } = menu();
    render(<PlayModeSelectScreen {...props} />);
    for (const variant of TWO_PLAYER_VARIANT_IDS) {
      for (const [card, prefix] of [['local', 'onLocal'], ['bots', 'onBot']] as const) {
        const id = playRowTestId(card, variant);
        const row = screen.getByTestId(id);
        expect(row.textContent, id).not.toBe('');
        fireEvent.click(row);
        expect(handlers[`${prefix}${cap(variant)}`], id).toHaveBeenCalledTimes(1);
      }
    }
    for (const variant of ENGINE) expect(screen.getByTestId(playRowTestId('engine', variant))).toBeTruthy();
    expect(within(screen.getByTestId(FROM_POSITION_TEST_ID)).getByText('From Position')).toBeTruthy();
    // ids are unique: a Bots-card Knightmate can never answer for the Local one
    const ids = [...document.querySelectorAll('[data-testid^="play-"]')].map((n) => n.getAttribute('data-testid'));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(15 * 2 + 4 + 1);
  });

  it('the harness copy (scripts/android/lib/playMenu.mjs) names the same ids for every card and variant', () => {
    for (const variant of TWO_PLAYER_VARIANT_IDS) for (const card of ['bots', 'local', 'engine'] as const) expect(playRow(card, variant).id).toBe(playRowTestId(card, variant));
    expect(FROM_POSITION_ROW.id).toBe(FROM_POSITION_TEST_ID);
  });
});

describe('the harness lookup works with NO heading on screen (PR #49 run 44883195830 attempt 2)', () => {
  const node = (extra: Record<string, unknown>) => ({ index: 0, parent: -1, depth: 0, text: '', desc: '', id: '', cls: 'android.view.ViewGroup', pkg: 'com.emchess.app', bounds: null, clickable: true, enabled: true, scrollable: false, password: false, ...extra });
  const at = (cy: number) => parseBounds(`[100,${cy - 40}][900,${cy + 40}]`);
  // "‹ Menu | Play | Knightmate | 4 Player Variations": the heading "Local" is above the window; one Knightmate row on screen is the Local card's, and (on another scroll) the Bots card's would be too
  const tree = [
    node({ text: '‹ Menu', bounds: at(80) }),
    node({ text: 'Play', bounds: at(80) }),
    node({ id: 'play-local-torpedo', bounds: at(300) }),
    node({ text: 'Torpedo', bounds: at(300), cls: 'android.widget.TextView' }),
    node({ id: 'play-local-knightmate', bounds: at(400) }),
    node({ text: 'Knightmate', bounds: at(400), cls: 'android.widget.TextView' }),
    node({ text: '4 Player Variations', bounds: at(600), cls: 'android.widget.TextView' }),
  ];

  it('the old step could not find the row; the testID step does', () => {
    expect(findOne(tree, { text: 'Local' })).toBeNull();
    expect(findOne(tree, playRow('local', 'knightmate'))?.bounds?.cy).toBe(400);
  });

  it('never answers with the other card\'s row of the same variant', () => {
    const bots = [node({ id: 'play-bots-knightmate', bounds: at(200) }), node({ text: 'Knightmate', bounds: at(200), cls: 'android.widget.TextView' }), ...tree.slice(4)];
    expect(findNodes(bots, playRow('local', 'knightmate')).map((n: { bounds: { cy: number } }) => n.bounds.cy)).toEqual([400]);
    expect(findOne([bots[0], bots[1]], playRow('local', 'knightmate'))).toBeNull();
  });

  it('a row in the bottom quarter is swiped once more, then re-found by its id in the new tree', () => {
    const low = findOne([node({ id: 'play-local-knightmate', bounds: at(2300) })], playRow('local', 'knightmate'))!;
    expect(isLowRow(low, 2400)).toBe(true);
    expect(isLowRow(findOne(tree, playRow('local', 'knightmate'))!, 2400)).toBe(false);
    const afterSwipe = [node({ id: 'play-local-knightmate', bounds: at(1500) })];
    expect(findOne(afterSwipe, playRow('local', 'knightmate'))?.bounds?.cy).toBe(1500);
  });
});
