import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AuthCallOptions } from '../../api/client';
import { useSignInRequest } from '../../logic/useSignInRequest';

/** The hook behind the Login and Register screens, on its own (command #27b): the notice it reports and the Cancel it owns. */
describe('useSignInRequest', () => {
  it('reports "waking" while the run waits, and not any more once the run has ended (answer or failure)', async () => {
    const { result } = renderHook(() => useSignInRequest());
    let finish: (value: string) => void = () => {};
    let call: AuthCallOptions = {};
    let promise: Promise<string> = Promise.resolve('');
    act(() => {
      promise = result.current.start(
        (given) =>
          new Promise<string>((resolve) => {
            call = given;
            finish = resolve;
          }),
      );
    });
    expect(result.current.waking).toBe(false);
    act(() => call.onWaking?.());
    expect(result.current.waking).toBe(true);
    await act(async () => {
      finish('done');
      await promise;
    });
    expect(result.current.waking).toBe(false);

    // a failure clears it as well
    let failing: Promise<string> = Promise.resolve('');
    let fail: (error: Error) => void = () => {};
    act(() => {
      failing = result.current.start(
        (given) =>
          new Promise<string>((_, reject) => {
            fail = reject;
            call = given;
          }),
      );
    });
    act(() => call.onWaking?.());
    expect(result.current.waking).toBe(true);
    await act(async () => {
      fail(new Error('no'));
      await failing.catch(() => {});
    });
    expect(result.current.waking).toBe(false);
  });

  it('hands the run a signal that Cancel aborts and that leaving the screen aborts', async () => {
    const { result, unmount } = renderHook(() => useSignInRequest());
    let signal: AbortSignal | undefined;
    act(() => {
      void result.current.start((given) => {
        signal = given.signal;
        return new Promise<string>(() => {});
      });
    });
    expect(signal?.aborted).toBe(false);
    act(() => result.current.cancel());
    expect(signal?.aborted).toBe(true);

    let second: AbortSignal | undefined;
    act(() => {
      void result.current.start((given) => {
        second = given.signal;
        return new Promise<string>(() => {});
      });
    });
    expect(second?.aborted).toBe(false);
    unmount();
    expect(second?.aborted).toBe(true);
  });

  it('Cancel with nothing running does nothing', () => {
    const { result } = renderHook(() => useSignInRequest());
    expect(() => act(() => result.current.cancel())).not.toThrow();
  });
});
