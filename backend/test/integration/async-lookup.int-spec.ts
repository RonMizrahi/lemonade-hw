import './setup/enable-worker';
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { WorkerModule } from '../../src/worker.module';
import { ExternalLookupStatus, OutboxStatus, SessionStatus } from '../../src/common/enums';
import {
  ExternalLookup,
  FlowVersion,
  OnboardingSession,
  OutboxEvent,
} from '../../src/database/entities';
import { OutboxWriter } from '../../src/onboarding/outbox/outbox-writer';
import { OutboxRelay } from '../../src/async-lookup/outbox-relay';
import { OnboardingService } from '../../src/onboarding/onboarding.service';
import { SIMULATED_PROPERTY_SERVICE } from '../../src/async-lookup/simulated-property.service';
import { runMigrations, startPostgres, StartedPostgres } from './setup/postgres-container';
import { startRedis, StartedRedis } from './setup/redis-container';
import { ControllableSimulatedPropertyService } from './setup/lookup-fake';

const POLL_MS = 100;
const SETTLE_MS = 4000;
const STEP_MS = 50;

/**
 * Polls a lookup row until the predicate holds or the timeout elapses.
 */
async function waitForLookup(
  dataSource: DataSource,
  lookupId: string,
  predicate: (lookup: ExternalLookup) => boolean,
): Promise<ExternalLookup> {
  const repo = dataSource.getRepository(ExternalLookup);
  const deadline = Date.now() + SETTLE_MS;
  for (;;) {
    const lookup = await repo.findOneByOrFail({ id: lookupId });
    if (predicate(lookup)) {
      return lookup;
    }
    if (Date.now() > deadline) {
      throw new Error(`Lookup ${lookupId} did not settle; last status=${lookup.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, STEP_MS));
  }
}

/**
 * Seeds a flow version + session and an external_lookup row, returning their ids.
 */
async function seedSessionWithLookup(
  dataSource: DataSource,
  lookupOverrides: Partial<ExternalLookup> = {},
): Promise<{ sessionId: string; lookupId: string; generation: number }> {
  const flowVersion = await dataSource.getRepository(FlowVersion).save(
    dataSource.getRepository(FlowVersion).create({
      version: Math.floor(Math.random() * 1_000_000),
      definition: { version: 1, questionIds: [] },
    }),
  );
  const session = await dataSource.getRepository(OnboardingSession).save(
    dataSource.getRepository(OnboardingSession).create({
      status: SessionStatus.InProgress,
      flowVersionId: flowVersion.id,
    }),
  );
  const lookup = await dataSource.getRepository(ExternalLookup).save(
    dataSource.getRepository(ExternalLookup).create({
      sessionId: session.id,
      status: ExternalLookupStatus.NotStarted,
      generation: 1,
      triggers: 1,
      maxTriggers: 3,
      jobAttempts: 0,
      ...lookupOverrides,
    }),
  );
  return { sessionId: session.id, lookupId: lookup.id, generation: lookup.generation };
}

describe('Async external-lookup pipeline (Testcontainers Postgres + Redis)', () => {
  let pg: StartedPostgres;
  let redis: StartedRedis;
  let app: TestingModule;
  let dataSource: DataSource;
  let sim: ControllableSimulatedPropertyService;
  let relay: OutboxRelay;
  let service: OnboardingService;

  beforeAll(async () => {
    pg = await startPostgres();
    redis = await startRedis();
    await runMigrations(pg);

    process.env.LOG_LEVEL = 'silent';
    process.env.OUTBOX_POLL_INTERVAL_MS = String(POLL_MS);
    process.env.LOOKUP_JOB_ATTEMPTS = '1';
    process.env.LOOKUP_DELAY_MIN_MS = '0';
    process.env.LOOKUP_DELAY_MAX_MS = '0';

    sim = new ControllableSimulatedPropertyService();
    app = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(SIMULATED_PROPERTY_SERVICE)
      .useValue(sim)
      .compile();

    app.enableShutdownHooks();
    await app.init();

    dataSource = app.get(DataSource);
    relay = app.get(OutboxRelay);
    service = app.get(OnboardingService);
    relay.start();
  }, 180000);

  afterAll(async () => {
    relay?.stop();
    if (app) {
      await app.close();
    }
    await redis?.container.stop();
    await pg?.container.stop();
    delete process.env.LOOKUP_WORKER;
  });

  beforeEach(() => {
    sim.shouldFail = false;
  });

  it('relay publishes a seeded outbox event and the processor completes the lookup', async () => {
    const { sessionId, lookupId, generation } = await seedSessionWithLookup(dataSource);
    await dataSource.transaction((manager) =>
      new OutboxWriter().writeLookupRequested(manager, { lookupId, sessionId, generation }),
    );

    const settled = await waitForLookup(
      dataSource,
      lookupId,
      (l) => l.status === ExternalLookupStatus.Completed,
    );

    expect(settled.status).toBe(ExternalLookupStatus.Completed);
    expect(settled.result).toMatchObject({ dataSource: 'external' });

    const events = await dataSource
      .getRepository(OutboxEvent)
      .find({ where: { aggregateId: lookupId } });
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe(OutboxStatus.Published);
  });

  it('a forced failure drives the lookup to failed (budget remaining)', async () => {
    sim.shouldFail = true;
    const { sessionId, lookupId, generation } = await seedSessionWithLookup(dataSource, {
      triggers: 1,
      maxTriggers: 3,
    });
    await dataSource.transaction((manager) =>
      new OutboxWriter().writeLookupRequested(manager, { lookupId, sessionId, generation }),
    );

    const settled = await waitForLookup(
      dataSource,
      lookupId,
      (l) => l.status === ExternalLookupStatus.Failed,
    );

    expect(settled.status).toBe(ExternalLookupStatus.Failed);
    expect(settled.result).toBeNull();
  });

  it('a forced failure at the trigger budget drives permanently_failed + fallback', async () => {
    sim.shouldFail = true;
    const { sessionId, lookupId, generation } = await seedSessionWithLookup(dataSource, {
      triggers: 3,
      maxTriggers: 3,
    });
    await dataSource.transaction((manager) =>
      new OutboxWriter().writeLookupRequested(manager, { lookupId, sessionId, generation }),
    );

    const settled = await waitForLookup(
      dataSource,
      lookupId,
      (l) => l.status === ExternalLookupStatus.PermanentlyFailed,
    );

    expect(settled.status).toBe(ExternalLookupStatus.PermanentlyFailed);
    expect(settled.result).toMatchObject({ fallback: true, dataSource: 'fallback' });
  });

  it('drops a stale-generation job without advancing status', async () => {
    const { sessionId, lookupId } = await seedSessionWithLookup(dataSource, { generation: 5 });
    // publish a job carrying an OLD generation (2) — must be dropped by the guard
    await dataSource.transaction((manager) =>
      new OutboxWriter().writeLookupRequested(manager, {
        lookupId,
        sessionId,
        generation: 2,
      }),
    );

    // give the relay + processor time to pick it up and drop it
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 6));

    const lookup = await dataSource.getRepository(ExternalLookup).findOneByOrFail({ id: lookupId });
    expect(lookup.status).toBe(ExternalLookupStatus.NotStarted);
    expect(lookup.result).toBeNull();
  });

  it('retryLookup re-enqueues a failed lookup (new outbox event, same generation)', async () => {
    const { sessionId, lookupId } = await seedSessionWithLookup(dataSource, {
      status: ExternalLookupStatus.Failed,
      generation: 2,
      triggers: 1,
      maxTriggers: 3,
    });

    sim.shouldFail = false;
    await service.retryLookup(sessionId, { idempotencyKey: randomUUID() });

    const lookup = await waitForLookup(
      dataSource,
      lookupId,
      (l) => l.status === ExternalLookupStatus.Completed,
    );
    expect(lookup.generation).toBe(2); // retry keeps the same generation
    expect(lookup.triggers).toBe(2);
  });

  it('retryLookup replays the same state for a repeated idempotency key', async () => {
    const { sessionId } = await seedSessionWithLookup(dataSource, {
      status: ExternalLookupStatus.Failed,
      triggers: 1,
      maxTriggers: 3,
    });
    const key = randomUUID();

    const first = await service.retryLookup(sessionId, { idempotencyKey: key });
    const replay = await service.retryLookup(sessionId, { idempotencyKey: key });

    expect(replay).toEqual(first);
  });

  it('retryLookup rejects with 409 when the lookup is not failed', async () => {
    const { sessionId } = await seedSessionWithLookup(dataSource, {
      status: ExternalLookupStatus.Loading,
    });

    await expect(
      service.retryLookup(sessionId, { idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('retryLookup rejects with 409 when max triggers is reached', async () => {
    const { sessionId } = await seedSessionWithLookup(dataSource, {
      status: ExternalLookupStatus.Failed,
      triggers: 3,
      maxTriggers: 3,
    });

    await expect(
      service.retryLookup(sessionId, { idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
