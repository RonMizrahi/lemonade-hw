import { Injectable, Logger } from '@nestjs/common';

/**
 * The OutboxRelay (worker, spec §7): polls `outbox_event` for `pending` rows
 * (`FOR UPDATE SKIP LOCKED`), publishes each to the BullMQ `external-lookup` queue, and
 * marks the row `published`. At-least-once delivery.
 *
 * M1 provides a lifecycle-safe stub so the worker process boots cleanly; M4 implements
 * the poll loop and publishing.
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);

  /**
   * Starts the relay poll loop. No-op in the M1 stub.
   */
  start(): void {
    this.logger.log('OutboxRelay stub started (no-op until M4)');
  }

  /**
   * Stops the relay poll loop. No-op in the M1 stub.
   */
  stop(): void {
    this.logger.log('OutboxRelay stub stopped');
  }
}
