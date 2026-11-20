import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diagnosticTail, engineDiagnosticLines, EVIDENCE_MAX_LINES, filterEngineLogcat } from '../../../scripts/android/lib/engineEvidence.mjs';

/**
 * The evidence the Android harness prints when "the bot did not answer" (command #51; scripts/android/lib/engineEvidence.mjs). Pure, so the filter is proved here and not on the
 * first red emulator run. The line limit (80) is a literal: it is the user's number.
 */
const L = (tag: string, message: string, pid = 1234) => `11-19 10:07:12.345  ${pid}  ${pid + 1} E ${tag.padEnd(12)}: ${message}`;

describe('filterEngineLogcat', () => {
  it('keeps the wanted tags and the emulator GPU failure, drops everything else', () => {
    const log = [
      L('chromium', 'render process gone'),
      L('cr_AwContents', 'onRenderProcessGone'),
      L('WebViewFactory', 'loading provider'),
      L('ReactNativeJS', "'[Engine] think: requested=100ms'"),
      L('AndroidRuntime', 'FATAL EXCEPTION: main'),
      L('libc', 'Fatal signal 11 (SIGSEGV)'),
      L('EGL_emulation', 'Failed to find ColorBuffer 7'),
      L('emuglGLESv2_enc', 'Failed to bind to texture 3'),
      L('ActivityManager', 'Start proc something'),
      L('SurfaceFlinger', 'unrelated'),
      L('chromiumish', 'a tag that only starts like a wanted one'),
      'garbage that is not a logcat line',
    ].join('\n');
    const kept = filterEngineLogcat(log);
    expect(kept.map((l) => /\d+ [VDIWEF] ([^\s:]+)/.exec(l)?.[1] ?? l)).toEqual(['chromium', 'cr_AwContents', 'WebViewFactory', 'ReactNativeJS', 'AndroidRuntime', 'libc', 'EGL_emulation', 'emuglGLESv2_enc']);
  });

  it('keeps at most 80 lines, the LAST ones', () => {
    const log = Array.from({ length: 200 }, (_, i) => L('chromium', `line ${i}`)).join('\n');
    const kept = filterEngineLogcat(log);
    expect(EVIDENCE_MAX_LINES).toBe(80);
    expect(kept).toHaveLength(80);
    expect(kept[0]).toContain('line 120');
    expect(kept[79]).toContain('line 199');
  });

  it('truncates a very long line and copes with an empty dump', () => {
    expect(filterEngineLogcat(L('chromium', 'x'.repeat(1000)))[0]).toHaveLength(300);
    expect(filterEngineLogcat('')).toEqual([]);
  });
});

describe('engineDiagnosticLines', () => {
  it('takes only the [Engine] / [EngineBridge] lines of the Diagnostics log, once each, in order', () => {
    const words = [
      'Diagnostics',
      '2026-11-19T10:00:00.000Z [Engine] Stockfish think: requested=500ms actual=612ms -> e2e4',
      '2026-11-19T10:00:01.000Z [EngineBridge] WebView render process gone (didCrash=true) - remounting the engine WebView (restart 1/1)\n2026-11-19T10:00:02.000Z [TextFit] app font: ok',
      '2026-11-19T10:00:00.000Z [Engine] Stockfish think: requested=500ms actual=612ms -> e2e4',
    ];
    expect(engineDiagnosticLines(words)).toEqual([
      '2026-11-19T10:00:00.000Z [Engine] Stockfish think: requested=500ms actual=612ms -> e2e4',
      '2026-11-19T10:00:01.000Z [EngineBridge] WebView render process gone (didCrash=true) - remounting the engine WebView (restart 1/1)',
    ]);
  });
});

describe('diagnosticTail (command #58)', () => {
  it('takes every timestamped entry of the Diagnostics log whatever its tag, once each, in order, and ignores the screen\'s other words', () => {
    const words = [
      'Diagnostic Log',
      'Run text-fit check',
      '2026-11-20T10:00:00.000Z [Boot] app started',
      '2026-11-20T10:00:01.000Z [TextFit] android 34, pixel ratio 2.6\n2026-11-20T10:00:02.000Z [Render] Piece threw: boom',
      '2026-11-20T10:00:00.000Z [Boot] app started',
      'Piece gallery',
    ];
    expect(diagnosticTail(words)).toEqual([
      '2026-11-20T10:00:00.000Z [Boot] app started',
      '2026-11-20T10:00:01.000Z [TextFit] android 34, pixel ratio 2.6',
      '2026-11-20T10:00:02.000Z [Render] Piece threw: boom',
    ]);
  });

  it('keeps the LAST max entries and copes with no words', () => {
    const words = Array.from({ length: 60 }, (_, i) => `2026-11-20T10:00:${String(i).padStart(2, '0')}.000Z [Boot] entry ${i}`);
    const kept = diagnosticTail(words);
    expect(kept).toHaveLength(40);
    expect(kept[0]).toContain('entry 20');
    expect(kept[39]).toContain('entry 59');
    expect(diagnosticTail([])).toEqual([]);
  });
});

describe('the harness wiring', () => {
  const e2e = readFileSync(join(__dirname, '../../../scripts/android/e2e.mjs'), 'utf8');

  it('prints the Diagnostics-screen evidence when the text-fit probe or the Piece gallery check fails (command #58)', () => {
    expect(e2e).toMatch(/record\('text-fit probe', \['the probe never wrote its lines to the diagnostic log'\]\);\s*return diagnosticsCheckEvidence\(dev, 'text-fit probe'\);/);
    expect(e2e).toMatch(/if \(incomplete\) await diagnosticsCheckEvidence\(dev, 'piece gallery pixels'\);\s*record\('piece gallery pixels'/);
    expect(e2e).toContain('diagnosticTail(');
  });

  it('prints the evidence at the moment "the bot did not answer in 30 s" is noted', () => {
    expect(e2e).toMatch(/notes\.push\(`the bot did not answer in 30 s before ply \$\{ply \+ 1\}`\);\s*await botSilenceEvidence\(dev, `before ply \$\{ply \+ 1\}`\);\s*break;/);
  });

  it('reads logcat through the filter and the Diagnostics screen through the engine-line parser', () => {
    expect(e2e).toContain("filterEngineLogcat(dev.adb(['logcat', '-d', '-t', '4000']");
    expect(e2e).toContain('engineDiagnosticLines(');
  });
});
