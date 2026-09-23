import { STOCKFISH_JS_SOURCE, STOCKFISH_WASM_BASE64 } from './generated/stockfishAssets';

/**
 * Builds a self-contained HTML page that runs a UCI engine (WASM) inside a real Web Worker,
 * using Blob URLs so no network/filesystem access is needed at all — everything is inlined.
 *
 * Generic across any nmrugg/stockfish.js-shaped build (confirmed true for both the current
 * Stockfish 19 NNUE build and the Stockfish 11 classical build — see
 * scripts/generate-stockfish11-assets.mjs): its worker bootstrap expects the WASM file's
 * location to be passed via the worker script URL's hash fragment (`#<wasmUrl>`), which is
 * exactly what this does with a Blob URL for the WASM binary.
 *
 * Communication with the host (React Native WebView, or a plain iframe on web) happens via
 * postMessage: raw UCI command strings in, raw UCI output lines out.
 */
export function buildEngineHtml(jsSource: string, wasmBase64: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body>
<script id="stockfish-src" type="application/javascript">
${jsSource}
</script>
<script>
(function () {
  function post(line) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(line);
    }
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(line, '*');
    }
  }

  function base64ToBytes(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  try {
    var jsSource = document.getElementById('stockfish-src').textContent;
    var jsBlobUrl = URL.createObjectURL(new Blob([jsSource], { type: 'application/javascript' }));

    var wasmBytes = base64ToBytes(${JSON.stringify(wasmBase64)});
    var wasmBlobUrl = URL.createObjectURL(new Blob([wasmBytes], { type: 'application/wasm' }));

    // Deliberately NOT URI-encoded. blob: URLs only ever contain URL-safe characters (an
    // origin + a UUID), so passing the raw URL is safe either way — but it matters which:
    // the current Stockfish 19 build calls decodeURIComponent() on this hash fragment before
    // using it (a no-op on an already-unencoded value), while Stockfish 11's build uses it
    // as-is, straight into fetch(), with no decoding step at all — an encoded value there
    // silently produces an invalid fetch URL and the engine never responds. The raw,
    // unencoded form is the one value that works correctly for both builds.
    var worker = new Worker(jsBlobUrl + '#' + wasmBlobUrl);

    worker.onmessage = function (e) {
      post(typeof e.data === 'string' ? e.data : JSON.stringify(e.data));
    };
    worker.onerror = function (e) {
      post('ENGINE_ERROR: ' + (e.message || String(e)));
    };

    function handleIncoming(data) {
      if (typeof data === 'string') {
        worker.postMessage(data);
      }
    }

    document.addEventListener('message', function (e) { handleIncoming(e.data); });
    window.addEventListener('message', function (e) { handleIncoming(e.data); });

    post('BRIDGE_READY');
  } catch (err) {
    post('BRIDGE_ERROR: ' + (err && err.message ? err.message : String(err)));
  }
})();
</script>
</body>
</html>`;
}

/** The current default engine (Stockfish, NNUE evaluation). */
export function buildStockfishHtml(): string {
  return buildEngineHtml(STOCKFISH_JS_SOURCE, STOCKFISH_WASM_BASE64);
}
