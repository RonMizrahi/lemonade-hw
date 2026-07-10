import { Injectable, Logger } from '@nestjs/common';
import { ExternalLookupJobData } from './queue.constants';

/**
 * The LookupProcessor (worker, spec §7): the BullMQ consumer for the `external-lookup`
 * queue. Applies the generation guard, advances status `loading → completed/failed`, relies
 * on BullMQ retry/backoff, and applies the fallback on permanent failure.
 *
 * M1 provides a stub (no BullMQ `@Processor` binding yet) so the module wires cleanly;
 * M4 turns this into a real `WorkerHost` and implements the pipeline.
 */
@Injectable()
export class LookupProcessor {
  private readonly logger = new Logger(LookupProcessor.name);

  /**
   * Processes a single external-lookup job. No-op in the M1 stub.
   * @param data the job payload (lookup id + generation)
   */
  async process(data: ExternalLookupJobData): Promise<void> {
    this.logger.log(
      `LookupProcessor stub received job for lookup ${data.lookupId} (no-op until M4)`,
    );
  }
}
