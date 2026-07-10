import { Inject, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ExternalLookupStatus } from '../common/enums';
import { ExternalLookup } from '../database/entities';
import { AnswerRepository } from '../onboarding/repositories/answer.repository';
import { ExternalLookupRepository } from '../onboarding/repositories/external-lookup.repository';
import { EXTERNAL_LOOKUP_QUEUE, ExternalLookupJobData } from './queue.constants';
import { applyTerminalFailure, isAlreadyResolved, isStaleJob } from './lookup-outcome';
import {
  PropertyLookupInput,
  SIMULATED_PROPERTY_SERVICE,
  SimulatedPropertyService,
} from './simulated-property.service';

/** Question id of the address answer that seeds the property lookup input (spec §3). */
const ADDRESS_QUESTION_ID = 'property_address';

/**
 * The LookupProcessor (worker, spec §7 stage 3): the BullMQ consumer for the
 * `external-lookup` queue. Applies the generation guard (drops stale jobs after an address
 * change), advances status `loading → completed`, and relies on BullMQ `attempts`+`backoff`
 * for automatic retries. On the final exhausted attempt the `failed` event transitions the
 * lookup to `failed`, or to `permanently_failed` with a fallback once the trigger budget is
 * spent (spec §7 stage 4).
 */
@Processor(EXTERNAL_LOOKUP_QUEUE)
export class LookupProcessor extends WorkerHost {
  private readonly logger = new Logger(LookupProcessor.name);

  constructor(
    private readonly lookups: ExternalLookupRepository,
    private readonly answers: AnswerRepository,
    @Inject(SIMULATED_PROPERTY_SERVICE)
    private readonly propertyService: SimulatedPropertyService,
  ) {
    super();
  }

  /**
   * Processes one external-lookup job: guard, mark loading, run the sim, mark completed.
   * A thrown error triggers BullMQ's retry/backoff; the `failed` handler owns the terminal
   * transition once attempts are exhausted.
   * @param job the BullMQ job carrying `{ lookupId, generation }`
   * @returns resolves once the lookup is completed (or the job is dropped as stale)
   * @throws Error to signal a failed attempt so BullMQ retries
   */
  async process(job: Job<ExternalLookupJobData>): Promise<void> {
    const { lookupId, generation } = job.data;
    const lookup = await this.lookups.findById(lookupId);
    if (!lookup) {
      this.logger.warn(`Dropping job for unknown lookup ${lookupId}`);
      return;
    }
    if (isStaleJob(lookup, generation)) {
      this.logger.log(
        `Dropping stale job for lookup ${lookupId} (job gen ${generation} != ${lookup.generation})`,
      );
      return;
    }
    if (isAlreadyResolved(lookup)) {
      this.logger.log(`Dropping duplicate job for already-resolved lookup ${lookupId}`);
      return;
    }

    await this.markLoading(lookup);
    const result = await this.propertyService.lookup(await this.buildInput(lookup));

    lookup.status = ExternalLookupStatus.Completed;
    lookup.result = { ...result };
    lookup.error = null;
    await this.lookups.save(lookup);
    this.logger.log(`Lookup ${lookupId} completed`);
  }

  /**
   * Terminal-failure handler: fires after BullMQ exhausts the job's attempts. Re-reads the
   * lookup (the address may have changed mid-retry) and, if the job is still current, applies
   * the `failed` / `permanently_failed`+fallback transition (spec §7 stage 4).
   * @param job the failed job
   * @param error the last failure reason
   * @returns resolves once the terminal status is persisted
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<ExternalLookupJobData>, error: Error): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) {
      return;
    }

    const { lookupId, generation } = job.data;
    const lookup = await this.lookups.findById(lookupId);
    if (!lookup || isStaleJob(lookup, generation) || isAlreadyResolved(lookup)) {
      return;
    }

    applyTerminalFailure(lookup, error.message);
    await this.lookups.save(lookup);
    this.logger.warn(`Lookup ${lookupId} → ${lookup.status}: ${error.message}`);
  }

  /**
   * Marks the lookup `loading`, records the attempt time, and counts the BullMQ attempt.
   * @param lookup the lookup row to advance
   * @returns resolves once persisted
   */
  private async markLoading(lookup: ExternalLookup): Promise<void> {
    lookup.status = ExternalLookupStatus.Loading;
    lookup.lastAttemptAt = new Date();
    lookup.jobAttempts += 1;
    await this.lookups.save(lookup);
  }

  /**
   * Builds the sim input, resolving the session's address answer when present.
   * @param lookup the lookup row being processed
   * @returns the property-lookup input for the sim
   */
  private async buildInput(lookup: ExternalLookup): Promise<PropertyLookupInput> {
    const addressAnswer = await this.answers.findByQuestion(lookup.sessionId, ADDRESS_QUESTION_ID);
    return { sessionId: lookup.sessionId, address: addressAnswer?.value ?? null };
  }
}
