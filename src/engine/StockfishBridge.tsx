import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import { logDiagnostic } from '../logic/diagnosticLog';
import { createBridgeSupervisor, type BridgeSupervisor } from './bridgeSupervisor';
import { buildStockfishHtml } from './stockfishHtml';

export interface StockfishBridgeHandle {
  postCommand: (command: string) => void;
}

interface StockfishBridgeProps {
  onLine: (line: string) => void;
  /** The self-contained engine HTML to load (see stockfishHtml.ts / stockfish11Html.ts).
   * Defaults to the current Stockfish build so existing single-engine callers are unaffected. */
  html?: string;
}

const StockfishBridge = forwardRef<StockfishBridgeHandle, StockfishBridgeProps>(function StockfishBridge(
  { onLine, html },
  ref
) {
  const webviewRef = useRef<WebView<object>>(null);
  // Remount key: a dead renderer is replaced by a fresh WebView (once; see bridgeSupervisor.ts).
  const [generation, setGeneration] = useState(0);
  const onLineRef = useRef(onLine);
  onLineRef.current = onLine;
  const supervisorRef = useRef<BridgeSupervisor | null>(null);
  if (supervisorRef.current === null) {
    supervisorRef.current = createBridgeSupervisor({
      remount: () => setGeneration((g) => g + 1),
      emit: (line) => onLineRef.current(line),
      log: logDiagnostic,
    });
  }
  const supervisor = supervisorRef.current;

  // Empty deps: the handle's behavior never changes (it always forwards through the ref), so
  // without this array React would recreate it — and re-invoke the parent's ref callback with
  // detach(null)+reattach — on every single render of this component.
  useImperativeHandle(
    ref,
    () => ({
      postCommand: (command: string) => {
        webviewRef.current?.postMessage(command);
      },
    }),
    []
  );

  const handleMessage = (event: WebViewMessageEvent) => {
    onLine(event.nativeEvent.data);
  };

  return (
    <View style={styles.hidden} pointerEvents="none">
      {/* react-native-webview 14 declares `class WebView<P = undefined>` whose props are `WebViewProps & undefined` (= never): name the extra props `object`. */}
      <WebView<object>
        key={generation}
        ref={webviewRef}
        originWhitelist={['*']}
        source={{ html: html ?? buildStockfishHtml() }}
        onMessage={handleMessage}
        // Android: the renderer crashed or was killed by the OS. iOS: the content process was terminated.
        onRenderProcessGone={(e) => supervisor.fail(`WebView render process gone (didCrash=${e.nativeEvent.didCrash})`)}
        onContentProcessDidTerminate={() => supervisor.fail('WebView content process terminated')}
        onError={(e) => supervisor.fail(`WebView load error ${e.nativeEvent.code}: ${e.nativeEvent.description}`)}
        javaScriptEnabled
        domStorageEnabled={false}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  hidden: {
    width: 1,
    height: 1,
    opacity: 0,
  },
});

export default StockfishBridge;
