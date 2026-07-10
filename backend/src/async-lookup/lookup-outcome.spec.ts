import { randomUUID } from 'node:crypto';
import { ExternalLookupStatus } from '../common/enums';
import { ExternalLookup } from '../database/entities';
import {
  applyTerminalFailure,
  buildFallbackResult,
  isAlreadyResolved,
  isStaleJob,
  isTriggerBudgetExhausted,
} from './lookup-outcome';

/**
 * Builds an ExternalLookup with overridable fields for the pure-logic tests.
 */
function buildLookup(overrides: Partial<ExternalLookup> = {}): ExternalLookup {
  const lookup = new ExternalLookup();
  lookup.id = randomUUID();
  lookup.sessionId = randomUUID();
  lookup.status = ExternalLookupStatus.Loading;
  lookup.generation = 1;
  lookup.triggers = 1;
  lookup.maxTriggers = 3;
  lookup.jobAttempts = 1;
  lookup.result = null;
  lookup.error = null;
  return Object.assign(lookup, overrides);
}

describe('lookup-outcome', () => {
  describe('isStaleJob', () => {
    it('is stale when the job generation differs from the lookup generation', () => {
      const lookup = buildLookup({ generation: 2 });
      expect(isStaleJob(lookup, 1)).toBe(true);
    });

    it('is not stale when generations match', () => {
      const lookup = buildLookup({ generation: 2 });
      expect(isStaleJob(lookup, 2)).toBe(false);
    });
  });

  describe('isAlreadyResolved', () => {
    it('is resolved when completed', () => {
      expect(isAlreadyResolved(buildLookup({ status: ExternalLookupStatus.Completed }))).toBe(true);
    });

    it('is resolved when permanently_failed', () => {
      expect(
        isAlreadyResolved(buildLookup({ status: ExternalLookupStatus.PermanentlyFailed })),
      ).toBe(true);
    });

    it('is NOT resolved when failed (a retry may re-run it) or loading', () => {
      expect(isAlreadyResolved(buildLookup({ status: ExternalLookupStatus.Failed }))).toBe(false);
      expect(isAlreadyResolved(buildLookup({ status: ExternalLookupStatus.Loading }))).toBe(false);
    });
  });

  describe('isTriggerBudgetExhausted', () => {
    it('is exhausted once triggers reach max_triggers', () => {
      expect(isTriggerBudgetExhausted(buildLookup({ triggers: 3, maxTriggers: 3 }))).toBe(true);
    });

    it('is not exhausted while triggers remain below max', () => {
      expect(isTriggerBudgetExhausted(buildLookup({ triggers: 1, maxTriggers: 3 }))).toBe(false);
    });
  });

  describe('buildFallbackResult', () => {
    it('flags the result as a fallback with the fallback data source', () => {
      const result = buildFallbackResult('boom');
      expect(result).toEqual({ fallback: true, dataSource: 'fallback', reason: 'boom' });
    });
  });

  describe('applyTerminalFailure', () => {
    it('sets failed (no fallback) while budget remains', () => {
      const lookup = buildLookup({ triggers: 1, maxTriggers: 3 });

      applyTerminalFailure(lookup, 'transient error');

      expect(lookup.status).toBe(ExternalLookupStatus.Failed);
      expect(lookup.result).toBeNull();
      expect(lookup.error).toBe('transient error');
    });

    it('sets permanently_failed with a fallback once budget is exhausted', () => {
      const lookup = buildLookup({ triggers: 3, maxTriggers: 3 });

      applyTerminalFailure(lookup, 'final error');

      expect(lookup.status).toBe(ExternalLookupStatus.PermanentlyFailed);
      expect(lookup.result).toEqual({
        fallback: true,
        dataSource: 'fallback',
        reason: 'final error',
      });
      expect(lookup.error).toBe('final error');
    });
  });
});
