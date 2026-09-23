export type BotCategory =
  | 'absoluteBeginner'
  | 'beginner'
  | 'intermediate'
  | 'advanced'
  | 'expert'
  | 'strong'
  | 'grandmaster'
  /** Synthetic category for a "play against my custom engine" card in BotSelectScreen — never
   * appears in BOT_CATEGORIES/getBotsByCategory, since these cards render in their own section. */
  | 'custom';

export interface BotPersonality {
  id: string;
  name: string;
  elo: number;
  category: BotCategory;
  /** Overrides the normal ELO->engine mapping (see getEngineIdForElo) — set only for the
   * synthetic "custom engine" bot cards, so they play against that exact engine regardless
   * of the placeholder `elo` given to them. */
  engineId?: string;
}
