import type { BotPersonality } from '../types/bot';
import { BOT_PERSONALITIES } from './bots';
import type { SeatController } from './fourPlayer';

/**
 * The glue between 4 Player Chess and the app's one bot roster. The engine (`src/logic/fourPlayer/`) only knows a number, the bot's ELO;
 * the NAMED bots ("Kiddo 400" … "The Unbeatable 3000") live in bots.ts's BOT_PERSONALITIES and are what the player actually picks (the
 * same roster, and the same BotSelectScreen, as Classic chess and the other variants). This file turns one into the other and back, and
 * stays outside the engine folder so that folder keeps importing nothing from the rest of the app.
 */

/** The seat controller for a bot picked from the roster. */
export function controllerForBot(bot: BotPersonality): SeatController {
  return { kind: 'bot', elo: bot.elo };
}

/** The roster bot with exactly this ELO, if any. */
export function rosterBotForElo(elo: number): BotPersonality | undefined {
  return BOT_PERSONALITIES.find((bot) => bot.elo === elo);
}

/** "The Neighbor" for 1400; falls back to "ELO n" for a number that is not on the roster. */
export function botDisplayName(elo: number): string {
  return rosterBotForElo(elo)?.name ?? `ELO ${elo}`;
}

/** What to show for a seat: "Human" or the roster bot's name. */
export function controllerName(controller: SeatController): string {
  return controller.kind === 'human' ? 'Human' : botDisplayName(controller.elo);
}
