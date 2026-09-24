import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { appAlert } from '../components/AppAlert';
import ScreenHeader from '../components/ScreenHeader';
import { buildCustomEngineHtml } from '../engine/customEngineHtml';
import StockfishBridge, { type StockfishBridgeHandle } from '../engine/StockfishBridge';
import { StockfishEngineAdapter } from '../engine/StockfishEngineAdapter';
import { deleteCustomEngine, saveCustomEngine } from '../logic/customEngines';
import { AVAILABLE_ENGINES } from '../logic/engines';
import type { EngineOption } from '../types/engine';

interface EngineSelectScreenProps {
  onBack: () => void;
}

type Phase = 'idle' | 'validating' | 'naming';

// Generous but bounded — a real UCI engine answers "uci"/"isready" almost instantly, so 10s is
// already a lot of slack; past that, treat it as "this isn't going to respond" rather than
// leaving the user staring at a spinner indefinitely.
const VALIDATION_TIMEOUT_MS = 10000;

const CUSTOM_ENGINE_DESCRIPTION = 'Your own custom engine (.wasm) that you added.';

// Temporary diagnostic helper (see the console.warn calls in handlePickFile below) — a bare
// `catch {}` swallows exactly the detail (native error code/message) needed to tell a genuine
// invalid-file failure apart from an environment/permission/module problem. Native Expo errors
// often carry a `.code` alongside `.message`, which a plain String(err) drops.
function describeError(err: unknown): unknown {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, code: (err as { code?: unknown }).code, stack: err.stack };
  }
  return err;
}

/**
 * Reads a picked file's bytes as base64, given its uri (a `file://` path on native, a `blob:`
 * URL on web). Deliberately goes through `fetch` + `Blob` + `FileReader` — React Native's own
 * built-in local-file-reading support — rather than expo-file-system: that module's File class
 * gates every read behind a FilePermissionService check, and Expo Go replaces that service with
 * a stricter, per-project-scoped implementation that does not recognize paths written by other
 * native modules (e.g. expo-document-picker's own cache subdirectory) as readable, even though
 * the file is perfectly real and belongs to the same app. `fetch`/`FileReader` never go through
 * that permission service at all, so this works the same in Expo Go and in a custom dev build.
 */
async function readAsBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Unexpected FileReader result type'));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
  // readAsDataURL always yields "data:<mime>;base64,<data>" — strip the prefix.
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

export default function EngineSelectScreen({ onBack }: EngineSelectScreenProps) {
  const [engines, setEngines] = useState<EngineOption[]>(() => [...AVAILABLE_ENGINES]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [pendingWasmBase64, setPendingWasmBase64] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');

  const refreshEngines = useCallback(() => setEngines([...AVAILABLE_ENGINES]), []);

  const resetPending = useCallback(() => {
    setPhase('idle');
    setPendingWasmBase64(null);
    setNameInput('');
  }, []);

  const handlePickFile = async () => {
    console.log('[EngineSelectScreen] handlePickFile: opening picker...');
    let result: DocumentPicker.DocumentPickerResult;
    try {
      result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      console.log('[EngineSelectScreen] getDocumentAsync resolved:', result);
    } catch (err) {
      console.warn('[EngineSelectScreen] getDocumentAsync threw:', describeError(err));
      appAlert('Error', 'Could not pick a file.');
      return;
    }
    if (result.canceled || result.assets.length === 0) {
      console.log('[EngineSelectScreen] picker returned canceled/empty — stopping here.', {
        canceled: result.canceled,
        assetCount: result.canceled ? 'n/a' : result.assets.length,
      });
      return;
    }

    const asset = result.assets[0];
    console.log('[EngineSelectScreen] picked asset:', {
      name: asset.name,
      uri: asset.uri,
      mimeType: asset.mimeType,
      size: asset.size,
    });

    if (!asset.name.toLowerCase().endsWith('.wasm')) {
      console.warn('[EngineSelectScreen] rejected: name does not end in .wasm ->', JSON.stringify(asset.name));
      appAlert('Invalid file', 'This file is not a valid chess engine — pick a file with a .wasm extension.');
      return;
    }

    try {
      const base64 = await readAsBase64(asset.uri);
      console.log('[EngineSelectScreen] read base64, length =', base64.length, '-> entering validating phase');
      setNameInput(asset.name.replace(/\.wasm$/i, ''));
      setPendingWasmBase64(base64);
      setPhase('validating');
    } catch (err) {
      console.warn('[EngineSelectScreen] reading picked file failed:', describeError(err));
      appAlert('Failed to load', 'Could not read the file.');
    }
  };

  // A scratch UciChessEngine + bridge, mounted only for the duration of validation — reuses
  // the exact same generic UCI wiring the real engines use (see CustomEngineAdapter.ts), just
  // thrown away afterwards instead of being registered.
  const scratchEngine = useMemo(
    () => (phase === 'validating' && pendingWasmBase64 ? new StockfishEngineAdapter() : null),
    [phase, pendingWasmBase64]
  );

  // Set by the effect below while validation is in flight, so the raw-line handler can report
  // a BRIDGE_ERROR (e.g. an invalid .wasm file) immediately instead of only finding out once
  // the 10s timeout elapses — StockfishEngineAdapter itself only reacts to BRIDGE_READY, so a
  // failing bridge would otherwise just sit there until the timeout fires.
  const reportBridgeErrorRef = useRef<((message: string) => void) | null>(null);

  const handleScratchBridgeRef = useCallback(
    (handle: StockfishBridgeHandle | null) => scratchEngine?.attachBridge(handle),
    [scratchEngine]
  );
  const handleScratchBridgeLine = useCallback(
    (line: string) => {
      if (line.startsWith('BRIDGE_ERROR')) {
        reportBridgeErrorRef.current?.(line);
        return;
      }
      scratchEngine?.handleLine(line);
    },
    [scratchEngine]
  );

  useEffect(() => {
    if (!scratchEngine) return;
    let settled = false;

    console.log('[EngineSelectScreen] validating: scratch engine mounted, calling initEngine()...');

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      console.error('[EngineSelectScreen] validation failed:', message);
      resetPending();
      appAlert('This file is not a valid chess engine', message);
    };

    reportBridgeErrorRef.current = () =>
      fail('The engine reported itself as invalid or failed during initialization — the file is probably not a compatible chess engine.');

    const timeoutHandle = setTimeout(() => {
      fail('The engine did not respond within 10 seconds — it probably does not support the UCI protocol.');
    }, VALIDATION_TIMEOUT_MS);

    scratchEngine
      .initEngine()
      .then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        console.log('[EngineSelectScreen] validation succeeded -> naming phase');
        setPhase('naming');
      })
      .catch((err) => {
        console.warn('[EngineSelectScreen] scratchEngine.initEngine() rejected:', describeError(err));
        fail('Could not initialize — the file may not be valid WebAssembly, or it may not support the UCI protocol.');
      });

    return () => {
      settled = true;
      reportBridgeErrorRef.current = null;
      clearTimeout(timeoutHandle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scratchEngine]);

  const handleConfirmName = async () => {
    const name = nameInput.trim();
    if (!name || !pendingWasmBase64) return;
    try {
      await saveCustomEngine(name, pendingWasmBase64);
      refreshEngines();
      resetPending();
      appAlert('Engine added', `"${name}" was added — you can now pick it as a bot opponent.`);
    } catch {
      appAlert('Save failed', 'Could not save the engine on this device.');
    }
  };

  const handleRemove = (option: EngineOption) => {
    if (engines.length <= 1) {
      appAlert('Cannot remove', 'At least one engine must remain available.');
      return;
    }
    appAlert('Remove engine', `Are you sure you want to remove "${option.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await deleteCustomEngine(option.id);
          refreshEngines();
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Engines" onBack={onBack} backLabel="‹ Menu" />

      {phase === 'validating' && pendingWasmBase64 && (
        <StockfishBridge ref={handleScratchBridgeRef} onLine={handleScratchBridgeLine} html={buildCustomEngineHtml(pendingWasmBase64)} />
      )}

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {engines.map((engine) => (
          <View key={engine.id} style={styles.engineRow}>
            <View style={styles.engineInfo}>
              <Text style={styles.engineName}>{engine.name}</Text>
              <Text style={styles.engineDescription}>{engine.description}</Text>
            </View>
            {engine.isCustom && (
              <Pressable style={styles.removeButton} onPress={() => handleRemove(engine)}>
                <Text style={styles.removeButtonText}>Remove</Text>
              </Pressable>
            )}
          </View>
        ))}

        {phase === 'validating' ? (
          <View style={styles.validatingBox}>
            <ActivityIndicator size="small" color="#3a2618" />
            <Text style={styles.validatingText}>Checking engine (up to 10 seconds)...</Text>
          </View>
        ) : phase === 'naming' ? (
          <View style={styles.namingBox}>
            <Text style={styles.namingLabel}>The engine loaded! Give it a name:</Text>
            <TextInput
              style={styles.namingInput}
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="e.g. My Engine"
              autoFocus
            />
            <View style={styles.namingButtons}>
              <Pressable style={styles.cancelButton} onPress={resetPending}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.saveButton, !nameInput.trim() && styles.saveButtonDisabled]}
                onPress={handleConfirmName}
                disabled={!nameInput.trim()}
              >
                <Text style={styles.saveButtonText}>Save</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={styles.addButton} onPress={handlePickFile}>
            <Text style={styles.addButtonText}>+ Add my own engine (.wasm)</Text>
          </Pressable>
        )}

        <Text style={styles.hint}>
          Note: not every .wasm file will work — it needs to speak the UCI protocol without requiring
          accompanying JS code. If it doesn't respond within 10 seconds, it's considered incompatible.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  engineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#f0d9b5',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#b58863',
    gap: 10,
  },
  engineInfo: {
    flex: 1,
    gap: 2,
  },
  engineName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#3a2618',
  },
  engineDescription: {
    fontSize: 12,
    color: '#5c4a35',
  },
  removeButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#b00020',
    borderRadius: 6,
  },
  removeButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  addButton: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: '#3a2618',
    borderRadius: 10,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  validatingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
  },
  validatingText: {
    fontSize: 14,
    color: '#555',
  },
  namingBox: {
    gap: 10,
    padding: 14,
    backgroundColor: '#f7f2ea',
    borderRadius: 10,
  },
  namingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3a2618',
  },
  namingInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    backgroundColor: '#fff',
  },
  namingButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#ddd',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  saveButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#2e6f4f',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  hint: {
    fontSize: 11,
    color: '#999',
    lineHeight: 15,
  },
});

// Only exported for documentation purposes elsewhere; not otherwise used outside this file.
export { CUSTOM_ENGINE_DESCRIPTION };
