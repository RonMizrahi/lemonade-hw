import { DynamicModule, Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../config/configuration';
import { ALL_ENTITIES } from '../database/entities';
import { ExternalLookupRepository } from '../onboarding/repositories/external-lookup.repository';
import { OutboxEventRepository } from '../onboarding/repositories/outbox-event.repository';
import { AnswerRepository } from '../onboarding/repositories/answer.repository';
import { OutboxWriter } from '../onboarding/outbox/outbox-writer';
import { LookupProcessor } from './lookup.processor';
import { LookupTriggerService } from './lookup-trigger.service';
import { OutboxRelay } from './outbox-relay';
import { EXTERNAL_LOOKUP_QUEUE } from './queue.constants';
import { DELAY_FN, RANDOM_SOURCE, realDelay } from './random';
import { SIMULATED_PROPERTY_SERVICE } from './simulated-property.service';
import { RealSimulatedPropertyService } from './simulated-property.impl';
import { isLookupWorkerContext } from './worker-context';

/** Exponential-backoff base delay (ms) between BullMQ retry attempts. */
const BACKOFF_DELAY_MS = 1000;

/**
 * BullMQ imports (Redis connection + the external-lookup queue with retry/backoff), attached
 * only in the worker process (spec §7).
 * @returns the BullMQ dynamic modules, or an empty list on the API side
 */
function workerImports(): DynamicModule[] {
  return [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const redis = config.get('redis', { infer: true });
        return { connection: { host: redis.host, port: redis.port } };
      },
    }),
    BullModule.registerQueueAsync({
      name: EXTERNAL_LOOKUP_QUEUE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        defaultJobOptions: {
          attempts: config.get('lookup', { infer: true }).jobAttempts,
          backoff: { type: 'exponential', delay: BACKOFF_DELAY_MS },
          removeOnComplete: true,
          removeOnFail: false,
        },
      }),
    }),
  ];
}

/**
 * Worker-only providers: the BullMQ consumer (LookupProcessor), the OutboxRelay poll loop,
 * and the simulated property service with its injectable randomness/delay (spec §7).
 */
const WORKER_PROVIDERS: Provider[] = [
  OutboxRelay,
  LookupProcessor,
  { provide: RANDOM_SOURCE, useValue: () => Math.random() },
  { provide: DELAY_FN, useValue: realDelay },
  { provide: SIMULATED_PROPERTY_SERVICE, useClass: RealSimulatedPropertyService },
];

const IS_WORKER = isLookupWorkerContext();

/**
 * The async external-lookup pipeline (spec §7). The API and worker both import this module
 * statically, but only the WORKER process registers the BullMQ queue (Redis connection +
 * retry/backoff), the LookupProcessor consumer, and the OutboxRelay poll loop — the API only
 * produces lookups via the exported LookupTriggerService (outbox rows), so it needs no Redis.
 * The worker/API split is resolved once at module load per process (see isLookupWorkerContext).
 */
@Module({
  imports: [TypeOrmModule.forFeature(ALL_ENTITIES), ...(IS_WORKER ? workerImports() : [])],
  providers: [
    LookupTriggerService,
    ExternalLookupRepository,
    OutboxEventRepository,
    AnswerRepository,
    OutboxWriter,
    ...(IS_WORKER ? WORKER_PROVIDERS : []),
  ],
  exports: [
    LookupTriggerService,
    ...(IS_WORKER ? [OutboxRelay, LookupProcessor, SIMULATED_PROPERTY_SERVICE] : []),
  ],
})
export class AsyncLookupModule {}
