import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';
import { OutboxRelay } from './async-lookup/outbox-relay';

/**
 * Worker entrypoint (spec §2, §7). Bootstraps a Nest application context (no HTTP server)
 * hosting the OutboxRelay + BullMQ consumer, and starts the relay. In M1 these are stubs
 * that start cleanly; M4 fills in the real poll loop and processor.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const relay = app.get(OutboxRelay);
  relay.start();

  app.get(Logger).log('Worker started (OutboxRelay + BullMQ consumer)');
}

void bootstrap();
