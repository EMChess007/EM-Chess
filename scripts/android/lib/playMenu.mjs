/**
 * PLAY-MENU ROWS BY TESTID (command #66, item 0). PR #49 run 44883195830 (attempt 2, large-touch): `{ text: 'Knightmate', below: 'Local' }` failed because `Device.find`'s OWN scrolling
 * pushed the heading "Local" off the window (the screen showed "‹ Menu | Play | Knightmate | 4 Player Variations"); #62b had fixed only the extra swipe AFTER the find. A row is now found by the
 * testID the app gives it (`src/logic/playMenuIds.ts`: `play-<card>-<variant>`), which needs no heading on screen. These strings mirror that function (the harness cannot import TypeScript);
 * `playMenuIds.dom.test.tsx` pins the two equal for every 2-player variant.
 */

/** The step that names a Play-menu row: card `bots` | `local` | `engine`, variant a `GameVariant` id (`racingKings`, `knightmate`, ...). */
export const playRow = (card, variant) => ({ id: `play-${card}-${variant}` });

/** The Board Editor card's "From Position" entry. */
export const FROM_POSITION_ROW = { id: 'play-editor-from-position' };

/**
 * A row whose centre is in the bottom quarter of the window is scrolled one more swipe before the tap (the zone of the navigation bar; command #42), and then RE-FOUND BY ITS TESTID in the new
 * tree (never by a heading, never by measuring a shift).
 */
export const isLowRow = (node, displayH) => node.bounds.cy > displayH * 0.75;
