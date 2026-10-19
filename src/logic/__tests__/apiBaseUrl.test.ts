import { describe, expect, it } from 'vitest';
import { parseApiUrlOverride, resolveApiBaseUrl, type ApiBaseUrlInputs } from '../../api/apiBaseUrl';

/**
 * Which backend the app talks to (src/api/apiBaseUrl.ts). The new EXPO_PUBLIC_API_URL override (Chaturaji W4: the browser end-to-end tests need the web build to reach a
 * private backend) must change NOTHING when it is not set: that is pinned against a verbatim copy of the function as it was before, over every input combination.
 */
const RENDER = 'https://render.example';

/** The decision exactly as it was written before the override existed (client.ts of W3), with its inputs passed in. */
function before(i: Omit<ApiBaseUrlInputs, 'apiUrlOverride'>): string {
  if (!i.dev) return i.renderUrl;
  if (i.useOnlineBackend) return i.renderUrl;
  if (i.platform === 'web') return `http://localhost:${i.localPort}`;
  const host = i.lanHost ?? i.manualLanIp;
  if (!host) return `http://localhost:${i.localPort}`;
  return `http://${host}:${i.localPort}`;
}

const base: ApiBaseUrlInputs = { dev: true, useOnlineBackend: false, apiUrlOverride: undefined, platform: 'web', lanHost: null, manualLanIp: null, localPort: 3000, renderUrl: RENDER };

describe('with no override the answer is what it always was', () => {
  it('over every combination of dev / online / platform / LAN host / manual IP, the new function equals the old one', () => {
    let checked = 0;
    for (const dev of [true, false]) {
      for (const useOnlineBackend of [true, false]) {
        for (const platform of ['web', 'ios', 'android']) {
          for (const lanHost of [null, '192.168.1.42']) {
            for (const manualLanIp of [null, '10.0.0.7']) {
              for (const apiUrlOverride of [undefined, '', '   ', 'not a url', 'ftp://x', 'http://u:p@h:1', 'http://h/path', 'http://h?x=1']) {
                const inputs: ApiBaseUrlInputs = { dev, useOnlineBackend, apiUrlOverride, platform, lanHost, manualLanIp, localPort: 3000, renderUrl: RENDER };
                expect(resolveApiBaseUrl(inputs), JSON.stringify(inputs)).toBe(before(inputs));
                checked++;
              }
            }
          }
        }
      }
    }
    expect(checked).toBe(2 * 2 * 3 * 2 * 2 * 8);
  });

  it('spot checks: Render for a release build or the online switch, localhost:3000 on the web, the LAN address on a phone', () => {
    expect(resolveApiBaseUrl({ ...base, dev: false })).toBe(RENDER);
    expect(resolveApiBaseUrl({ ...base, useOnlineBackend: true })).toBe(RENDER);
    expect(resolveApiBaseUrl(base)).toBe('http://localhost:3000');
    expect(resolveApiBaseUrl({ ...base, platform: 'ios', lanHost: '192.168.1.42' })).toBe('http://192.168.1.42:3000');
    expect(resolveApiBaseUrl({ ...base, platform: 'android' })).toBe('http://localhost:3000');
  });
});

describe('the override', () => {
  it('points a dev build at the given origin, whatever else is set (the online switch included), and nothing changes in a release build', () => {
    expect(resolveApiBaseUrl({ ...base, apiUrlOverride: 'http://localhost:3191' })).toBe('http://localhost:3191');
    expect(resolveApiBaseUrl({ ...base, apiUrlOverride: 'http://localhost:3191', useOnlineBackend: true })).toBe('http://localhost:3191');
    expect(resolveApiBaseUrl({ ...base, apiUrlOverride: 'http://localhost:3191', platform: 'ios', lanHost: '192.168.1.42' })).toBe('http://localhost:3191');
    expect(resolveApiBaseUrl({ ...base, apiUrlOverride: 'http://localhost:3191', dev: false })).toBe(RENDER); // a release build never takes it
  });

  it('accepts a plain http(s) origin and tidies it; refuses everything else', () => {
    expect(parseApiUrlOverride('http://localhost:3191')).toBe('http://localhost:3191');
    expect(parseApiUrlOverride('  http://localhost:3191/ ')).toBe('http://localhost:3191');
    expect(parseApiUrlOverride('https://backend.example')).toBe('https://backend.example');
    expect(parseApiUrlOverride('HTTP://LocalHost:3191')).toBe('http://localhost:3191');
    for (const bad of [undefined, '', '   ', 'localhost:3191', 'ws://localhost:3191', 'ftp://h', 'file:///x', 'http://user:secret@host:1', 'http://:secret@host:1', 'http://host:1/api', 'http://host:1?x=1', 'http://host:1#top', 'javascript:alert(1)', 'http://']) {
      expect(parseApiUrlOverride(bad), String(bad)).toBeNull();
    }
  });

  it('an invalid override is ignored: the answer is the default for that environment', () => {
    for (const bad of ['http://user:secret@host:1', 'http://host:1/api', 'nonsense']) expect(resolveApiBaseUrl({ ...base, apiUrlOverride: bad })).toBe('http://localhost:3000');
  });
});
