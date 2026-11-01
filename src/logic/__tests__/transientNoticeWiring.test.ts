import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Command #34: every screen that can show a one-off premove / refusal message wires it to the shared lifetime (logic/useTransientNotice.ts: the next move or five
 * seconds). A scan, because a NEW premove screen that keeps its own `useState` notice would bring the phone bug back (the 2-player line stayed for dozens of moves).
 */
const screensDir = path.resolve(__dirname, '../../screens');
const read = (name: string) => readFileSync(path.join(screensDir, name), 'utf8');

describe('transient notices are wired in every screen that shows one', () => {
  it('BotGameScreen: the cancelled premove goes at the next FEN or after the time to live', () => {
    expect(read('BotGameScreen.tsx')).toMatch(/useTransientNotice\(premoveInvalid, fen, \(\) => setPremoveInvalid\(false\)\)/);
  });

  it('OnlineGameScreen: the cancelled premove, a refused move and the draw notice', () => {
    const source = read('OnlineGameScreen.tsx');
    expect(source).toMatch(/useTransientNotice\(premoveInvalidNotice, fen, \(\) => setPremoveInvalidNotice\(false\)\)/);
    expect(source).toMatch(/useTransientNotice\(moveError, fen, \(\) => setMoveError\(null\)\)/);
    expect(source).toMatch(/useTransientNotice\(drawNotice, fen, \(\) => setDrawNotice\(null\)\)/);
  });

  it('the 4-seat screens hand usePremove their ply epoch; the online one also expires a refused move and a failed action', () => {
    expect(read('FourPlayerGameScreen.tsx')).toMatch(/epoch: positionEpoch\(game\)/);
    const online = read('FourPlayerOnlineGameScreen.tsx');
    expect(online).toMatch(/epoch: view \? positionEpoch\(view\.state\) : 0/);
    expect(online).toMatch(/useExpiringNotice\(view\?\.moveError \?\? null, noticeEpoch\)/);
    expect(online).toMatch(/useTransientNotice\(actionError, noticeEpoch, \(\) => setActionError\(null\)\)/);
    expect(online).not.toMatch(/\{view\.moveError &&/);
  });

  it('BughouseGameScreen: the premove sentence, a refused action and a refused resignation, on the pair of FENs', () => {
    const source = read('BughouseGameScreen.tsx');
    expect(source).toMatch(/useTransientNotice\(premoveNotice, noticeEpoch, \(\) => setPremoveNotice\(null\)\)/);
    expect(source).toMatch(/useExpiringNotice\(online\?\.view\.actionError \?\? null, noticeEpoch\)/);
    expect(source).toMatch(/useExpiringNotice\(online\?\.resignError \?\? null, noticeEpoch\)/);
    expect(source).not.toMatch(/online\.view\.actionError !== null/);
    expect(source).not.toMatch(/online\.resignError !== null/);
  });

  it('no screen draws the cancelled-premove sentence without one of the hooks', () => {
    const offenders = readdirSync(screensDir)
      .filter((name) => name.endsWith('.tsx'))
      .filter((name) => /Premove was no longer legal|describePremoveCancel|premoveNotice/.test(read(name)))
      .filter((name) => !/useTransientNotice|usePremove\(|usePremove</.test(read(name)));
    expect(offenders).toEqual([]);
  });
});
