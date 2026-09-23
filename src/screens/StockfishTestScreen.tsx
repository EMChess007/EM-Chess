import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import StockfishBridge, { type StockfishBridgeHandle } from '../engine/StockfishBridge';
import { stockfishEngine } from '../engine/StockfishEngineAdapter';
import { START_FEN } from '../types/chess';

interface StockfishTestScreenProps {
  onExit: () => void;
}

export default function StockfishTestScreen({ onExit }: StockfishTestScreenProps) {
  const insets = useSafeAreaInsets();
  const bridgeRef = useRef<StockfishBridgeHandle>(null);
  const [log, setLog] = useState<string[]>([]);
  const [bestMove, setBestMove] = useState<string | null>(null);
  const [status, setStatus] = useState('Not started');
  const [busy, setBusy] = useState(false);

  const handleLine = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-40), line]);
    stockfishEngine.handleLine(line);
  }, []);

  const handleBridgeRef = useCallback((handle: StockfishBridgeHandle | null) => {
    bridgeRef.current = handle;
    stockfishEngine.attachBridge(handle);
  }, []);

  const runTest = async () => {
    setBusy(true);
    setBestMove(null);
    setStatus('Initializing engine...');
    try {
      await stockfishEngine.initEngine();
      setStatus('Sending starting position...');
      stockfishEngine.setPosition(START_FEN);
      setStatus('Calculating best move...');
      const move = await stockfishEngine.getBestMove({ depth: 12 });
      console.log('[StockfishTest] bestmove:', move);
      setBestMove(move);
      setStatus('Ready');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log('[StockfishTest] error:', message);
      setStatus(`Error: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <StockfishBridge ref={handleBridgeRef} onLine={handleLine} />
      <Pressable style={styles.backButton} onPress={onExit}>
        <Text style={styles.backButtonText}>‹ Menu</Text>
      </Pressable>
      <Text style={styles.title}>Stockfish Engine Test</Text>
      <Text style={styles.status}>{status}</Text>
      {bestMove && <Text style={styles.bestMove}>Best move: {bestMove}</Text>}
      <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={runTest} disabled={busy}>
        <Text style={styles.buttonText}>{busy ? 'Running...' : 'Test Engine (starting position)'}</Text>
      </Pressable>
      <Text style={styles.logTitle}>Engine log:</Text>
      <ScrollView style={styles.log}>
        {log.map((line, i) => (
          <Text key={i} style={styles.logLine}>
            {line}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 10,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  backButtonText: {
    fontSize: 16,
    color: '#3a2618',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  status: {
    fontSize: 15,
    color: '#555',
  },
  bestMove: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a7a1a',
  },
  button: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#3a2618',
    borderRadius: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  logTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#777',
    marginTop: 8,
  },
  log: {
    flex: 1,
    backgroundColor: '#f4f4f4',
    borderRadius: 8,
    padding: 8,
  },
  logLine: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#333',
  },
});
