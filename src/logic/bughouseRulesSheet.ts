/**
 * The Bughouse rules sheet (BUGHOUSE_SPEC.md section 1; our own words - nothing is copied from a site). The numbers that exist as constants in the engine are READ from it: the time controls
 * (`BUGHOUSE_TIME_CONTROLS`), the pocket's piece types (`RESERVE_PIECE_TYPES`) and the seat map (`seatPlace`), so the sheet cannot name a control the game does not offer or a team the seat
 * map does not have.
 */
import { BUGHOUSE_TIME_CONTROLS } from './bughouse';
import { bughouseControlLabel as engineControlLabel } from './bughouse/rules';
import { seatPlace } from './bughouse/types';
import { RESERVE_PIECE_TYPES } from './crazyhouse';
import type { RulesSection } from './chaturajiUi';
import type { BughouseTimeControl } from './bughouse/rules';

const PIECE_WORD = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' } as const;

/** The label of a control (the engine's own, bughouse/rules.ts): kept exported from here for the rules sheet's callers. */
export const bughouseControlLabel = (control: BughouseTimeControl): string => engineControlLabel(control);

export function bughouseRulesSheet(): RulesSection[] {
  const team1 = [0, 1, 2, 3].filter((s) => seatPlace(s as 0 | 1 | 2 | 3).team === 1).map((s) => seatPlace(s as 0 | 1 | 2 | 3));
  const pieces = RESERVE_PIECE_TYPES.map((p) => PIECE_WORD[p]).join(', ');
  return [
    {
      title: 'The idea',
      lines: [
        'Two teams of two play on two boards at the same time. Team-mates play opposite colours: when you are White, your partner is Black on the other board.',
        `Team 1 is Board ${team1[0].board} ${team1[0].color === 'w' ? 'White' : 'Black'} and Board ${team1[1].board} ${team1[1].color === 'w' ? 'White' : 'Black'}; Team 2 is the other two seats.`,
      ],
    },
    {
      title: 'Captures feed your partner',
      lines: [
        `Every piece you capture goes into your PARTNER's pocket (${pieces}), ready to drop on their very next turn.`,
        'A captured promoted piece goes into the pocket as a pawn. A king is never captured: the game ends first.',
      ],
    },
    {
      title: 'Drops',
      lines: [
        'On your turn you make ONE action: an ordinary move, or a drop of a piece from your own pocket onto any empty square.',
        'A pawn can never be dropped on the 1st or 8th rank; a dropped pawn can promote. A drop may give check or checkmate, and it may block a check.',
        'Tap a piece in your pocket, then tap one of the highlighted squares.',
      ],
    },
    {
      title: 'Waiting',
      lines: [
        'If you are in check and a piece from your pocket could block it, you are not mated - you wait for your partner to capture one. The same if you have nothing at all to do. Your clock keeps running.',
      ],
    },
    {
      title: 'Clocks and the end',
      lines: [
        `Every player has their own clock and all start together. Time controls: ${BUGHOUSE_TIME_CONTROLS.map(bughouseControlLabel).join(', ')}. With "No time limit" there are no clocks, so only a mate, a resignation or everyone leaving ends the match; a Daily match has a clock of days.`,
        'The whole match ends the moment ANY board ends - checkmate, resignation or a flag - and the team that won that board wins the match.',
        'There are no draws in Crazy Bughouse.',
      ],
    },
  ];
}
