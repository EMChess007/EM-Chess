/**
 * Which 2-player variants are played by a heuristic bot instead of a UCI engine (Stockfish or a custom "My Engines" engine), and the honest
 * label the bot picker shows for them (command #68, TODO "Giveaway bot picker still says Stockfish 11").
 *
 * Why it exists: `BotGameScreen` bypasses the UCI engine entirely for each of these variants (its `choose<Variant>BotMove` calls), so a bot
 * card that says "Stockfish 11 (Classical)" - or a "My Engines" card that would never be asked for a move - is a lie on the picker. ONE table
 * here drives both the label and the hiding of the custom-engine cards in `BotSelectScreen`; a variant is never special-cased in the screen.
 *
 * Gotcha: the list must follow `BotGameScreen`'s wiring, not a guess. `heuristicBots.test.ts` scans that screen for every
 * `choose<Variant>BotMove(moveEngine` call and fails when one is missing here (or listed here without a call there). Spell Chess is NOT in
 * the table: its move is Stockfish's, only the spell cast is a heuristic (`chooseSpellChessBotCast`).
 */

/** The variant flags (props of `BotSelectScreen` / `BotGameScreen`) whose bot is a heuristic. */
export type HeuristicBotVariant =
  | 'giveaway'
  | 'atomic'
  | 'duckChess'
  | 'horde'
  | 'racingKings'
  | 'torpedo'
  | 'knightmate'
  | 'crazyhouse';

export const HEURISTIC_BOT_LABELS: Readonly<Record<HeuristicBotVariant, string>> = {
  giveaway: 'Giveaway bot',
  atomic: 'Atomic search bot',
  duckChess: 'Duck Chess bot',
  horde: 'Horde bot',
  racingKings: 'Racing Kings bot',
  torpedo: 'Torpedo bot',
  knightmate: 'Knightmate bot',
  crazyhouse: 'Crazyhouse bot',
};

export type HeuristicBotFlags = Partial<Record<HeuristicBotVariant, boolean | undefined>>;

/** The label of the heuristic bot for these variant flags, or undefined when the variant's bot is a UCI engine (Classic and the rest). */
export function heuristicBotLabel(flags: HeuristicBotFlags): string | undefined {
  for (const variant of Object.keys(HEURISTIC_BOT_LABELS) as HeuristicBotVariant[]) {
    if (flags[variant]) return HEURISTIC_BOT_LABELS[variant];
  }
  return undefined;
}
