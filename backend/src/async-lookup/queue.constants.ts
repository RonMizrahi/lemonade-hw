/**
 * Name of the BullMQ queue carrying external-lookup jobs (spec §7).
 */
export const EXTERNAL_LOOKUP_QUEUE = 'external-lookup';

/**
 * Job name for a single external-lookup processing job.
 */
export const EXTERNAL_LOOKUP_JOB = 'process-external-lookup';

/**
 * Payload of an external-lookup job (spec §7). Carries the generation for the stale-job guard.
 */
export interface ExternalLookupJobData {
  lookupId: string;
  generation: number;
  correlationId?: string;
}
