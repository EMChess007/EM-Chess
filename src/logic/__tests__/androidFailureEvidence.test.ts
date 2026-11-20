import { describe, expect, it } from 'vitest';
import { classifyEvidence, filterFailureLogcat, parsePid } from '../../../scripts/android/lib/failureEvidence.mjs';

/** Command #59: the classification of an android-e2e failure, with fake inputs. */
const L = (tag: string, message: string) => `11-19 10:07:12.345  1234  1235 E ${tag.padEnd(12)}: ${message}`;

describe('filterFailureLogcat', () => {
  it('keeps the wanted tags and ActivityManager ANR lines only, the last 80', () => {
    const kept = filterFailureLogcat([L('ReactNativeJS', 'a'), L('ActivityManager', 'ANR in com.emchess.app'), L('ActivityManager', 'Start proc'), L('SurfaceFlinger', 'x')].join('\n'));
    expect(kept).toHaveLength(2);
    const many = Array.from({ length: 200 }, (_, i) => L('chromium', `n${i}`)).join('\n');
    const last = filterFailureLogcat(many);
    expect(last).toHaveLength(80);
    expect(last[79]).toContain('n199');
  });
});

describe('parsePid', () => {
  it('reads the first pid or null', () => {
    expect(parsePid('4321\n')).toBe(4321);
    expect(parsePid('no process')).toBeNull();
  });
});

describe('classifyEvidence', () => {
  it('crash: a fatal exception, or the process gone', () => {
    expect(classifyEvidence({ startPid: 10, pid: 10, logcat: [L('AndroidRuntime', 'FATAL EXCEPTION: main')] })).toBe('crash');
    expect(classifyEvidence({ startPid: 10, pid: null })).toBe('crash');
  });
  it('ANR beats restart', () => {
    expect(classifyEvidence({ startPid: 10, pid: 11, logcat: [L('ActivityManager', 'ANR in com.emchess.app')] })).toBe('ANR');
  });
  it('app restarted: the pid changed with no crash line', () => {
    expect(classifyEvidence({ startPid: 10, pid: 11 })).toBe('app restarted');
  });
  it('probe silent: a Diagnostics check failed and the log is empty', () => {
    expect(classifyEvidence({ startPid: 10, pid: 10, issues: ['text-fit probe wrote nothing'] })).toBe('probe silent');
    expect(classifyEvidence({ startPid: 10, pid: 10, issues: ['piece gallery: 0 of 576 cells judged'] })).toBe('probe silent');
  });
  it('screen unchanged after tap', () => {
    expect(classifyEvidence({ startPid: 10, pid: 10, issues: ['the Classic choice did not appear after the tap'] })).toBe('screen unchanged after tap');
  });
  it('unknown otherwise', () => {
    expect(classifyEvidence({ startPid: 10, pid: 10, issues: ['something else'] })).toBe('unknown');
    expect(classifyEvidence()).toBe('unknown');
  });
});
