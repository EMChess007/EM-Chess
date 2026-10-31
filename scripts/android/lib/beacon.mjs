/**
 * The driver's end of the app's state beacon (command #30; the app's end is src/dev/e2eBeacon.ts). The development build POSTs `{ channel, state }` to http://10.0.2.2:<port>/state whenever
 * a board changes (the position, the side to move, the selected square, the board's rectangle in screen pixels) and whenever its gesture layer sees a touch (counts of grant / release / tap).
 * The driver keeps the LATEST state of each channel and waits for it by a condition. This is how the run reads a game screen whose accessibility tree is not fresh: the app says what it
 * shows, and the tree and the photograph only confirm it.
 */
import { createServer } from 'node:http';

export const BEACON_PORT = 8765;

export class Beacon {
  constructor() {
    /** channel -> { state, seq, at } */
    this.channels = new Map();
    this.seq = 0;
    this.server = null;
  }

  start(port = BEACON_PORT) {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        if (req.method !== 'POST' || req.url !== '/state') {
          res.writeHead(404).end();
          return;
        }
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 1 << 16) req.destroy();
        });
        req.on('end', () => {
          try {
            const { channel, state } = JSON.parse(body);
            if (typeof channel === 'string' && state && typeof state === 'object') this.channels.set(channel, { state: this.withKnownRect(channel, state), seq: ++this.seq, at: Date.now() });
            res.writeHead(204).end();
          } catch {
            res.writeHead(400).end();
          }
        });
      });
      this.server.once('error', reject);
      this.server.listen(port, '0.0.0.0', () => resolve(this));
    });
  }

  /**
   * A state that arrives without the board's rectangle (the probe sends the state at once and the measured rectangle a moment later; two POSTs can also overtake each other) keeps the
   * rectangle the same mounted board reported last: the rectangle is geometry, and the probe re-measures it every 1.5 s, so a board that moved is corrected by its next report.
   */
  withKnownRect(channel, state) {
    const previous = this.channels.get(channel)?.state;
    if (state.rect || !previous?.rect || previous.mount !== state.mount) return state;
    return { ...state, rect: previous.rect };
  }

  stop() {
    this.server?.close();
    this.server = null;
  }

  /** The latest state of a channel, or null. */
  get(channel) {
    return this.channels.get(channel)?.state ?? null;
  }

  /** Forgets a channel (before a screen is opened, so the next state is that screen's own). */
  forget(channel) {
    this.channels.delete(channel);
  }

  forgetAll() {
    this.channels.clear();
  }

  /**
   * Waits until none of the channels has reported anything for `quietMs`. The probe re-measures a board every 1.5 s and reports only a CHANGED rectangle, so a board whose layout is still
   * settling (the first run that touched the second board of the phone frame tapped a rank low: the board had shrunk from 819 to 777 px after its rectangle was read) keeps reporting,
   * and a board that has been quiet for several seconds stands where its last rectangle says. Returns false when a channel never reported or the bound ran out.
   */
  async settled(channels, quietMs = 4000, timeoutMs = 30_000) {
    const t0 = Date.now();
    for (;;) {
      const ages = channels.map((c) => (this.channels.has(c) ? Date.now() - this.channels.get(c).at : -1));
      if (ages.every((a) => a >= quietMs)) return true;
      if (Date.now() - t0 > timeoutMs) return false;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  /** Waits until `test(state)` is truthy for the channel's latest state; returns that state. The bound only turns a hang into a failure (null). */
  async waitFor(channel, test = () => true, timeoutMs = 20_000) {
    const t0 = Date.now();
    for (;;) {
      const state = this.get(channel);
      if (state !== null && test(state)) return state;
      if (Date.now() - t0 > timeoutMs) return null;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}
