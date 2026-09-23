import { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
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
  const webviewRef = useRef<WebView>(null);

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
      <WebView
        ref={webviewRef}
        originWhitelist={['*']}
        source={{ html: html ?? buildStockfishHtml() }}
        onMessage={handleMessage}
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
