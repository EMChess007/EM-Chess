Build the 2-player variant $ARGUMENTS following CLAUDE.md and CHECKLIST.md. One variant, one branch, two sessions. Closest models: Racing Kings (newest, full pattern) and Horde. Report per CLAUDE.md (Greek).

## BRANCHES (paired)
Name the branch `paired/<variant-slug>` in BOTH repos (app and backend), e.g. `paired/torpedo`. Backend CI then tests against the same-named frontend branch, so backend tests that import new client logic pass before merge. Merge order: the app PR first, then the backend PR.

## STEP 0 - RESEARCH (before any code)
Web-search the rules on Lichess, chess.com, pychess and chessvariants.org.
- If they agree: write the exact rules at the top of your work: start FEN, legal-move limits, win/draw conditions incl. stalemate, repetition, 50-move rule, insufficient material (differs per variant, e.g. Racing Kings has NO insufficient-material draw), plus the test list.
- If they disagree or anything is unclear: STOP and report the differences in Greek (<= 8 lines). No code.
- Always list the sources in the report.

## PART 1 (one session, < 1 h)
Rules engine (client `src/logic/` + server `backend/src/game/`, identical) + unit tests (copy from the closest variant) + Local + Bot. End with push + report.

## PART 2 (next session, SAME branch)
Online (matchmaking, challenges, all time controls) + tournaments + rules sheet EN/EL + `test-multiplayer.mjs` + nightly fuzz + Android scenario. End with push + report.

## BEFORE EVERY PUSH
- Run the FULL `npx vitest run --project logic` (source-scan pins break when a variant is added) + `npm run typecheck`; dom tests of the touched screens.
- Frontend tests never read `backend/` files (CI checks out the app only).
- If the variant touches shared types or app logic (e.g. widens `PieceType` in `src/types/chess.ts`, or edits any file a backend twin copies verbatim, such as `atomic.ts`), run ALL backend `test:*` scripts (plus `test-tournament.mjs`, `sync:* --check` and backend `npx tsc --noEmit`) against the paired app branch before pushing. Knightmate's `m` widening broke the Atomic twin check in CI (command #57) because only the Knightmate script had been run. A new piece type must be handled only where the variant can reach it: keep the shared twin blocks on the six FIDE pieces (local `FidePiece` type), never add a fake `m` mapping.

## ANDROID
Add a scenario in `scripts/android/e2e.mjs` modelled on `racingKings2p`: beacon board rect, `waitSelected`, tap -> press, re-find a low Play-menu row by its shift after the swipe. NEVER add variant steps to `smoke.mjs`.
