import AsyncStorage from '@react-native-async-storage/async-storage';

export interface CustomEngineRecord {
  id: string;
  name: string;
  /** The engine's .wasm content, base64-encoded, stored directly rather than as a copied file
   * on disk — expo-file-system's File/Directory class API has no web implementation at all
   * (it warns and no-ops), and this app is used and tested on web as well as native, so
   * storage needs to work the same way on both. */
  base64: string;
}

const STORAGE_KEY = 'customEngines:v1';

async function loadRecords(): Promise<CustomEngineRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveRecords(records: CustomEngineRecord[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Non-critical: worst case the user has to re-add their custom engine(s) next time.
  }
}

/** All custom engines the user has previously added, in insertion order. */
export async function listCustomEngines(): Promise<CustomEngineRecord[]> {
  return loadRecords();
}

/** Persists a newly-validated custom engine's metadata + content and appends it to the list. */
export async function addCustomEngine(name: string, base64: string): Promise<CustomEngineRecord> {
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record: CustomEngineRecord = { id, name, base64 };
  const records = await loadRecords();
  records.push(record);
  await saveRecords(records);
  return record;
}

/** Removes a custom engine's persisted record by id — a no-op if it isn't found. */
export async function removeCustomEngine(id: string): Promise<void> {
  const records = await loadRecords();
  await saveRecords(records.filter((r) => r.id !== id));
}
