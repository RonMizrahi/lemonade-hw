import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { ExternalLookupStatus } from '../common/enums';
import { AppConfig } from '../config/configuration';
import { ExternalLookup } from '../database/entities';
import { ExternalLookupRepository } from '../onboarding/repositories/external-lookup.repository';
import { OutboxWriter } from '../onboarding/outbox/outbox-writer';

/**
 * The result of a trigger: the upserted lookup row (with its bumped generation).
 */
export interface TriggerResult {
  lookup: ExternalLookup;
}

/**
 * Reusable external-lookup trigger machinery (spec §7, stage 1 & 4). In one transaction
 * it upserts the session's `external_lookup` (status `not_started`, `triggers += 1`) and
 * writes an `external_lookup.requested` outbox event via {@link OutboxWriter}.
 *
 * Callable for both the initial address trigger (M3 reuses it) and a manual retry (M4).
 * The `bumpGeneration` flag distinguishes them: an address change bumps the generation so
 * in-flight jobs for the old address are dropped by the processor's guard; a retry keeps
 * the same generation (spec §7 stage 4).
 */
@Injectable()
export class LookupTriggerService {
  private readonly maxTriggers: number;

  constructor(
    private readonly lookups: ExternalLookupRepository,
    private readonly outboxWriter: OutboxWriter,
    config: ConfigService<AppConfig, true>,
  ) {
    this.maxTriggers = config.get('lookup', { infer: true }).maxTriggers;
  }

  /**
   * Upserts the lookup and enqueues its outbox event within the caller's transaction.
   * @param manager the enclosing transaction's EntityManager
   * @param sessionId the owning session id
   * @param bumpGeneration whether to bump the generation (address changed) or keep it (retry)
   * @returns the upserted lookup row
   */
  async trigger(
    manager: EntityManager,
    sessionId: string,
    bumpGeneration: boolean,
  ): Promise<TriggerResult> {
    const existing = await this.lookups.findBySession(sessionId, manager);
    const generation = this.nextGeneration(existing, bumpGeneration);

    const lookup = existing
      ? await this.lookups.save(this.applyTrigger(existing, generation), manager)
      : await this.lookups.create(
          {
            sessionId,
            status: ExternalLookupStatus.NotStarted,
            generation,
            triggers: 1,
            maxTriggers: this.maxTriggers,
            jobAttempts: 0,
            result: null,
            error: null,
          },
          manager,
        );

    await this.outboxWriter.writeLookupRequested(manager, {
      lookupId: lookup.id,
      sessionId,
      generation: lookup.generation,
    });

    return { lookup };
  }

  /**
   * Computes the generation for this trigger: bump on address change, keep on retry.
   * @param existing the current lookup row, if any
   * @param bumpGeneration whether the address changed
   * @returns the generation to persist
   */
  private nextGeneration(existing: ExternalLookup | null, bumpGeneration: boolean): number {
    if (!existing) {
      return 1;
    }
    return bumpGeneration ? existing.generation + 1 : existing.generation;
  }

  /**
   * Applies a re-trigger to an existing lookup: reset for a fresh run, count the trigger.
   * @param lookup the existing lookup row
   * @param generation the generation to set
   * @returns the mutated lookup ready to save
   */
  private applyTrigger(lookup: ExternalLookup, generation: number): ExternalLookup {
    lookup.status = ExternalLookupStatus.NotStarted;
    lookup.generation = generation;
    lookup.triggers += 1;
    lookup.jobAttempts = 0;
    lookup.error = null;
    return lookup;
  }
}
