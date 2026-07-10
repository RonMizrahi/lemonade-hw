/**
 * DI token for the random-number source used by the simulated property service.
 * Bound to `Math.random` in production; overridden with a seeded/fixed source in tests
 * so delay and failure outcomes are deterministic (spec §7, §10).
 */
export const RANDOM_SOURCE = Symbol('RANDOM_SOURCE');

/**
 * A source of floats in `[0, 1)`, matching `Math.random`'s contract.
 */
export type RandomSource = () => number;

/**
 * DI token for the async delay function used by the simulated property service.
 * Bound to a real `setTimeout` sleep in production; a no-op in tests to keep them fast.
 */
export const DELAY_FN = Symbol('DELAY_FN');

/**
 * Sleeps for the given number of milliseconds.
 */
export type DelayFn = (ms: number) => Promise<void>;

/**
 * Real delay: resolves after `ms` milliseconds via `setTimeout`.
 * @param ms milliseconds to wait
 * @returns a promise resolving once the delay elapses
 */
export function realDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
