import { ExternalLookupStatus } from '../common/enums';
import { ExternalLookup, ExternalLookupResult } from '../database/entities';

/**
 * Whether a job is stale for its lookup: the address changed since the job was enqueued,
 * so the job's generation no longer matches the current lookup generation (spec §7 stage 3).
 * @param lookup the current lookup row
 * @param jobGeneration the generation carried by the job
 * @returns true when the job should be dropped
 */
export function isStaleJob(lookup: ExternalLookup, jobGeneration: number): boolean {
  return jobGeneration !== lookup.generation;
}

/**
 * Whether the lookup has already reached a terminal SUCCESS/permanent state, so a duplicate
 * or late job (at-least-once delivery) must NOT re-run and overwrite it (spec §7). A `failed`
 * lookup is not terminal here — a manual retry re-runs it under the same generation.
 * @param lookup the current lookup row
 * @returns true when the lookup is `completed` or `permanently_failed`
 */
export function isAlreadyResolved(lookup: ExternalLookup): boolean {
  return (
    lookup.status === ExternalLookupStatus.Completed ||
    lookup.status === ExternalLookupStatus.PermanentlyFailed
  );
}

/**
 * Whether this lookup has exhausted its manual-trigger budget (spec §7 stage 4). Once true,
 * a terminal failure becomes `permanently_failed` with a fallback rather than plain `failed`.
 * @param lookup the current lookup row
 * @returns true when `triggers >= max_triggers`
 */
export function isTriggerBudgetExhausted(lookup: ExternalLookup): boolean {
  return lookup.triggers >= lookup.maxTriggers;
}

/**
 * The fallback record written on permanent failure, unblocking completion (spec §7 stage 4).
 * @param reason the last failure reason
 * @returns the fallback result payload
 */
export function buildFallbackResult(reason: string): ExternalLookupResult {
  return {
    fallback: true,
    dataSource: 'fallback',
    reason,
  };
}

/**
 * Applies a terminal failure to a lookup: `permanently_failed` + fallback when the trigger
 * budget is exhausted, otherwise plain `failed` (a manual retry may still be attempted).
 * Pure — mutates and returns the passed row, no I/O (spec §7 stage 4).
 * @param lookup the lookup row to transition
 * @param reason the last failure reason
 * @returns the mutated lookup row
 */
export function applyTerminalFailure(lookup: ExternalLookup, reason: string): ExternalLookup {
  lookup.error = reason;
  if (isTriggerBudgetExhausted(lookup)) {
    lookup.status = ExternalLookupStatus.PermanentlyFailed;
    lookup.result = buildFallbackResult(reason);
  } else {
    lookup.status = ExternalLookupStatus.Failed;
  }
  return lookup;
}
