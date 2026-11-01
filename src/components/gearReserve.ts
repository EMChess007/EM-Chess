/**
 * The floating gear button's corner (command #34). On the phone (Expo Go) the host draws a round settings button over the app's TOP RIGHT corner. Our code cannot see it, and a release
 * build has none - so a screen simply never puts a control under that corner: a header row that holds controls on its right (the Home streak chip, the Bughouse bar with Rules / Resign)
 * keeps `GEAR_RESERVE` dp of its right side free. The Android device matrix (check `gear`, scripts/browser/android-matrix-def.mjs GEAR_ZONE) and the Android end-to-end run (`gearIssues`)
 * fail when a tappable element reaches into the corner, on every screen.
 *
 * 72 dp is the zone's width in the checks; 8 dp more is the row's own gutter, so the reserve is a literal here (pinned by gearReserve.test.ts against the checks' zone).
 */
export const GEAR_RESERVE = 80;
