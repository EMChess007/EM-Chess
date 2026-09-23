export interface EngineOption {
  id: string;
  name: string;
  description: string;
  /** True for a user-uploaded engine (see EngineSelectScreen) — lets the UI show a "remove"
   * affordance only for these, never for the built-in engines. */
  isCustom?: boolean;
}
