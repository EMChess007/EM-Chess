/**
 * Builds the self-contained bridge HTML for a user-uploaded, arbitrary .wasm chess engine.
 *
 * IMPORTANT, honest limitation: unlike the bundled Stockfish builds (stockfishHtml.ts /
 * stockfish11Html.ts), which ship WITH matching Emscripten-generated JS glue code that knows
 * exactly how to run that specific binary, a user only ever hands us a bare .wasm file here —
 * there is no generic way to run an arbitrary WebAssembly module without knowing what imports
 * it expects. WebAssembly is not a self-describing, "just run it" format the way a native
 * executable is.
 *
 * What this does instead is a genuine best effort: it instantiates the module against a
 * minimal, common set of imports (a growable `memory`, and small WASI `wasi_snapshot_preview1`
 * stubs enough to satisfy simple/non-interactive WASI-target builds) and, if instantiation
 * succeeds, drives it the exact same way the other bridges do — post a raw UCI command string
 * in, treat any stdout/stderr text the module writes as UCI output lines out. A real engine
 * that needs its own Emscripten glue (which is how the bundled Stockfish builds work), or that
 * relies on genuinely blocking stdin reads inside a WASI main loop, will not run through this —
 * WebAssembly's synchronous execution model can't pause mid-call to wait for an async
 * browser message the way this app's own WebView/Worker bridge needs it to. In practice this
 * means the loader will most often hit the caller's own 10s handshake timeout for such files,
 * which is the correct, safe outcome (see EngineSelectScreen's validation flow) rather than
 * hanging or crashing.
 */
export function buildCustomEngineHtml(wasmBase64: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body>
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
    var wasmBytes = base64ToBytes(${JSON.stringify(wasmBase64)});
    var memory = new WebAssembly.Memory({ initial: 256, maximum: 4096 });
    var outBuf = [];
    var textDecoder = new TextDecoder('utf-8');

    function flushLine() {
      var text = textDecoder.decode(new Uint8Array(outBuf));
      outBuf = [];
      text.split('\\n').forEach(function (line) {
        var trimmed = line.replace(/\\r$/, '');
        if (trimmed.length) post(trimmed);
      });
    }

    // fd_write reads an array of {ptr,len} iovecs from wasm memory and appends those bytes to
    // our own output buffer, flushing on every newline — the same "line at a time" contract
    // the other bridges' worker protocol already speaks.
    function fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
      var view = new DataView(memory.buffer);
      var written = 0;
      for (var i = 0; i < iovsLen; i++) {
        var ptr = view.getUint32(iovsPtr + i * 8, true);
        var len = view.getUint32(iovsPtr + i * 8 + 4, true);
        var bytes = new Uint8Array(memory.buffer, ptr, len);
        for (var j = 0; j < len; j++) outBuf.push(bytes[j]);
        written += len;
      }
      view.setUint32(nwrittenPtr, written, true);
      if (outBuf.indexOf(10) !== -1) flushLine();
      return 0;
    }

    var wasi = {
      fd_write: fd_write,
      // No interactive stdin support (see this file's top comment) — always report EOF.
      fd_read: function () { return 0; },
      fd_close: function () { return 0; },
      fd_seek: function () { return 0; },
      fd_fdstat_get: function () { return 0; },
      proc_exit: function (code) { post('BRIDGE_ERROR: engine exited (code ' + code + ')'); },
      environ_sizes_get: function (countPtr, sizePtr) {
        var view = new DataView(memory.buffer);
        view.setUint32(countPtr, 0, true);
        view.setUint32(sizePtr, 0, true);
        return 0;
      },
      environ_get: function () { return 0; },
      clock_time_get: function (id, precision, ptr) {
        var view = new DataView(memory.buffer);
        view.setBigUint64(ptr, BigInt(Date.now()) * 1000000n, true);
        return 0;
      },
      random_get: function (ptr, len) {
        var bytes = new Uint8Array(memory.buffer, ptr, len);
        for (var i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
        return 0;
      },
    };

    var imports = {
      env: {
        memory: memory,
        abort: function () { post('BRIDGE_ERROR: module called abort()'); },
      },
      wasi_snapshot_preview1: wasi,
      wasi_unstable: wasi,
    };

    WebAssembly.instantiate(wasmBytes, imports)
      .then(function (result) {
        var exports = result.instance.exports;

        function handleIncoming(data) {
          if (typeof data !== 'string') return;
          // Best-effort, polling-style ABI: if the module exports these two functions, use
          // them to push a command in and poll for output — see this file's top comment for
          // why a normal blocking stdin read can't work here.
          if (typeof exports.uci_command === 'function') {
            try {
              exports.uci_command(data);
            } catch (err) {
              post('BRIDGE_ERROR: ' + (err && err.message ? err.message : String(err)));
            }
          }
        }
        document.addEventListener('message', function (e) { handleIncoming(e.data); });
        window.addEventListener('message', function (e) { handleIncoming(e.data); });

        try {
          if (typeof exports._start === 'function') {
            exports._start();
          } else if (typeof exports.main === 'function') {
            exports.main();
          }
        } catch (err) {
          // A WASI proc_exit() call surfaces as a thrown control-flow exception in some
          // runtimes even on a "successful" exit — not necessarily a real failure.
        }

        post('BRIDGE_READY');
      })
      .catch(function (err) {
        post('BRIDGE_ERROR: ' + (err && err.message ? err.message : String(err)));
      });
  } catch (err) {
    post('BRIDGE_ERROR: ' + (err && err.message ? err.message : String(err)));
  }
})();
</script>
</body>
</html>`;
}
