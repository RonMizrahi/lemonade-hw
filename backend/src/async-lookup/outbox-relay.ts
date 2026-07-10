import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource, EntityManager } from 'typeorm';
import { AppConfig } from '../config/configuration';
import { OutboxStatus } from '../common/enums';
import { OutboxEvent } from '../database/entities';
import { OutboxEventRepository } from '../onboarding/repositories/outbox-event.repository';
import {
  EXTERNAL_LOOKUP_JOB,
  EXTERNAL_LOOKUP_QUEUE,
  ExternalLookupJobData,
} from './queue.constants';

/** Maximum outbox rows claimed per poll tick. */
const BATCH_SIZE = 20;

/**
 * The OutboxRelay (worker, spec §7 stage 2): polls `outbox_event` for `pending` rows
 * (`FOR UPDATE SKIP LOCKED` so multiple workers never double-publish), publishes each to
 * the BullMQ `external-lookup` queue, and marks the row `published`. At-least-once delivery;
 * the processor's generation guard makes a duplicate publish harmless.
 */
@Injectable()
export class OutboxRelay implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly pollIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly outboxEvents: OutboxEventRepository,
    @InjectQueue(EXTERNAL_LOOKUP_QUEUE) private readonly queue: Queue<ExternalLookupJobData>,
    config: ConfigService<AppConfig, true>,
  ) {
    this.pollIntervalMs = config.get('lookup', { infer: true }).outboxPollIntervalMs;
  }

  /**
   * Starts the relay poll loop. Idempotent — a second call is a no-op.
   */
  start(): void {
    if (this.timer) {
      return;
    }
    this.logger.log(`OutboxRelay started (poll every ${this.pollIntervalMs}ms)`);
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  /**
   * Stops the relay poll loop.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.log('OutboxRelay stopped');
    }
  }

  /**
   * Ensures the poll loop is torn down when the module is destroyed.
   */
  onModuleDestroy(): void {
    this.stop();
  }

  /**
   * Runs one poll cycle: claims pending rows, publishes them, marks them published.
   * Overlapping ticks are skipped so a slow cycle can't stack. Errors are logged, not thrown.
   * @returns the number of events published this cycle
   */
  async tick(): Promise<number> {
    if (this.running) {
      return 0;
    }
    this.running = true;
    try {
      return await this.dataSource.transaction((manager) => this.publishBatch(manager));
    } catch (error) {
      this.logger.error(`OutboxRelay tick failed: ${this.describe(error)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  /**
   * Claims and publishes a batch of pending events within the caller's transaction.
   * @param manager the transactional EntityManager holding the row locks
   * @returns the number of events published
   */
  private async publishBatch(manager: EntityManager): Promise<number> {
    const pending = await this.outboxEvents.claimPendingForUpdate(BATCH_SIZE, manager);
    for (const event of pending) {
      await this.publish(event);
      event.status = OutboxStatus.Published;
      event.publishedAt = new Date();
      event.publishAttempts += 1;
      await this.outboxEvents.save(event, manager);
    }
    if (pending.length > 0) {
      this.logger.log(`OutboxRelay published ${pending.length} event(s)`);
    }
    return pending.length;
  }

  /**
   * Publishes a single outbox event to the BullMQ queue.
   * @param event the pending outbox row to publish
   * @returns resolves once the job is enqueued
   */
  private async publish(event: OutboxEvent): Promise<void> {
    const data: ExternalLookupJobData = {
      lookupId: event.payload.lookupId,
      generation: event.payload.generation,
    };
    await this.queue.add(EXTERNAL_LOOKUP_JOB, data);
  }

  /**
   * @param error an unknown thrown value
   * @returns a safe message string for logging
   */
  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
