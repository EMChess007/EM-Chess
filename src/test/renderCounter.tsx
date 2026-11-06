import { createElement, memo, type ComponentType } from 'react';

/**
 * RENDER COUNTERS for the rendered tests (command #33, the lag): a component is wrapped so that every execution of its RENDER FUNCTION is counted. A `memo` component keeps its comparison, so
 * "rendered" means "its parent re-rendered AND its props changed" - exactly what costs JavaScript-thread time on a phone. The test says how many renders an interaction may cost; nothing
 * here reads a clock.
 *
 * Use it from a `vi.mock` factory (hoisted, so the import is dynamic):
 *   vi.mock('../../components/Square', async (importOriginal) => (await import('../../test/renderCounter')).countModule('Square', await importOriginal()));
 */
const counts = new Map<string, number>();

export const renderCount = (name: string): number => counts.get(name) ?? 0;
export const resetRenderCounts = (): void => counts.clear();
export const allRenderCounts = (): Record<string, number> => Object.fromEntries([...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));

/** Wraps the default export of a module; `memo` components keep their comparison. */
export function countModule<M extends { default: unknown }>(name: string, mod: M): M {
  return { ...mod, default: countComponent(name, mod.default as ComponentType<never>) } as M;
}

type MemoLike = { $$typeof: symbol; type: ComponentType<never>; compare: ((a: unknown, b: unknown) => boolean) | null };

export function countComponent(name: string, Real: ComponentType<never>): ComponentType<never> {
  const bump = () => counts.set(name, (counts.get(name) ?? 0) + 1);
  const asMemo = Real as unknown as MemoLike;
  if (typeof Real === 'object' && asMemo.type !== undefined && String(asMemo.$$typeof).includes('memo')) {
    const Counted = (props: object) => {
      bump();
      return createElement(asMemo.type as ComponentType<object>, props);
    };
    return memo(Counted, asMemo.compare ?? undefined) as unknown as ComponentType<never>;
  }
  const Counted = (props: object) => {
    bump();
    return createElement(Real as ComponentType<object>, props);
  };
  return Counted as unknown as ComponentType<never>;
}
