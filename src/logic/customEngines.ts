import { createCustomEngineAdapter } from '../engine/CustomEngineAdapter';
import { buildCustomEngineHtml } from '../engine/customEngineHtml';
import { registerEngineRuntime, unregisterEngineRuntime } from '../engine/engineRegistry';
import type { EngineOption } from '../types/engine';
import {
  addCustomEngine as persistCustomEngine,
  listCustomEngines,
  removeCustomEngine as deletePersistedCustomEngine,
  type CustomEngineRecord,
} from './customEngineStorage';
import { addCustomEngineOption, removeCustomEngineOption } from './engines';

const CUSTOM_ENGINE_DESCRIPTION = 'Your own custom engine (.wasm) that you added.';

function toEngineOption(record: CustomEngineRecord): EngineOption {
  return { id: record.id, name: record.name, description: CUSTOM_ENGINE_DESCRIPTION, isCustom: true };
}

function registerLoadedEngine(record: CustomEngineRecord): void {
  registerEngineRuntime(record.id, {
    engine: createCustomEngineAdapter(),
    buildHtml: () => buildCustomEngineHtml(record.base64),
  });
  addCustomEngineOption(toEngineOption(record));
}

/**
 * Re-registers every previously-saved custom engine into the shared registry + picker-facing
 * list — call once at app startup (see App.tsx).
 */
export async function restoreCustomEngines(): Promise<void> {
  const records = await listCustomEngines();
  for (const record of records) {
    try {
      registerLoadedEngine(record);
    } catch (err) {
      console.warn(`[customEngines] Could not restore "${record.name}".`, err);
    }
  }
}

/**
 * Persists a newly-validated custom engine and makes it available everywhere the shared
 * registry is used (bot gameplay, analysis). `wasmBase64` is whatever was already used during
 * validation (see EngineSelectScreen) — this never re-reads the file.
 */
export async function saveCustomEngine(name: string, wasmBase64: string): Promise<EngineOption> {
  const record = await persistCustomEngine(name, wasmBase64);
  registerLoadedEngine(record);
  return toEngineOption(record);
}

/** Removes a custom engine from the registry, the picker-facing list, and storage. */
export async function deleteCustomEngine(id: string): Promise<void> {
  unregisterEngineRuntime(id);
  removeCustomEngineOption(id);
  await deletePersistedCustomEngine(id);
}
