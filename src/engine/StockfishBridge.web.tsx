import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
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

/**
 * Web build of the bridge: `react-native-webview` doesn't support react-native-web, so on
 * web we host the same self-contained HTML bridge in a plain hidden iframe instead, using
 * window.postMessage. The HTML payload and wire protocol are identical to the native path.
 */
const StockfishBridge = forwardRef<StockfishBridgeHandle, StockfishBridgeProps>(function StockfishBridge(
  { onLine, html },
  ref
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Empty deps: the handle's behavior never changes (it always forwards through the ref), so
  // without this array React would recreate it — and re-invoke the parent's ref callback with
  // detach(null)+reattach — on every single render of this component.
  useImperativeHandle(
    ref,
    () => ({
      postCommand: (command: string) => {
        iframeRef.current?.contentWindow?.postMessage(command, '*');
      },
    }),
    []
  );

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source === iframeRef.current?.contentWindow && typeof event.data === 'string') {
        onLine(event.data);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onLine]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={html ?? buildStockfishHtml()}
      sandbox="allow-scripts"
      title="stockfish-engine"
      style={{ width: 1, height: 1, opacity: 0, border: 0, position: 'absolute' }}
    />
  );
});

export default StockfishBridge;
