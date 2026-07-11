import '../integration/setup/enable-worker';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { applyGlobalMiddleware } from '../../src/common/bootstrap';
import { ExternalLookupStatus, SessionStatus } from '../../src/common/enums';
import { FlowVersion } from '../../src/database/entities';
import { ACTIVE_FLOW_VERSION } from '../../src/flow-engine/flow-definition';
import { OutboxRelay } from '../../src/async-lookup/outbox-relay';
import { SIMULATED_PROPERTY_SERVICE } from '../../src/async-lookup/simulated-property.service';
import {
  runMigrations,
  startPostgres,
  StartedPostgres,
} from '../integration/setup/postgres-container';
import { startRedis, StartedRedis } from '../integration/setup/redis-container';
import { ControllableSimulatedPropertyService } from '../integration/setup/lookup-fake';

const OK = 200;
const CREATED = 201;
const ACCEPTED = 202;

/** Fast, deterministic pipeline settings for the in-process worker. */
const POLL_MS = 100;
/** Cap on how long a poll-until-terminal loop waits for the lookup to settle. */
const SETTLE_TIMEOUT_MS = 15000;
/** Delay between poll ticks when waiting on the lookup. */
const POLL_STEP_MS = 100;
/** A future coverage-start date so the coverage business rule passes regardless of run date. */
const FUTURE_START_DATE = '2099-01-01';
/** A valid address answer value; answering it fires the external lookup (spec §7). */
const VALID_ADDRESS = { street: '1 Main St', city: 'Springfield' };

/** The homeowner-branch answer sequence up to (but excluding) the address (spec §3). */
const PRE_ADDRESS: [string, unknown][] = [
  ['full_name', 'Jane Doe'],
  ['date_of_birth', '1990-06-15'],
  ['residence_type', 'own'],
];

/** The remaining homeowner-branch answers submitted while the lookup runs (spec §3). */
const POST_ADDRESS: [string, unknown][] = [
  ['year_built', 1990],
  ['construction_type', 'brick'],
  ['has_security_system', false],
  ['coverage_start_date', FUTURE_START_DATE],
  ['wants_earthquake_coverage', false],
];

/** A session-state response body, narrowed to the fields the journeys assert on. */
interface StateBody {
  sessionId: string;
  status: string;
  version: number;
  externalLookup: { status: ExternalLookupStatus; result: Record<string, unknown> | null };
  completion: { canComplete: boolean; missingRequired: string[] };
  summary: Record<string, unknown> | null;
}

describe('Onboarding full-journey e2e (Testcontainers Postgres + Redis, in-process worker)', () => {
  let pg: StartedPostgres;
  let redis: StartedRedis;
  let app: INestApplication;
  let dataSource: DataSource;
  let relay: OutboxRelay;
  let sim: ControllableSimulatedPropertyService;

  beforeAll(async () => {
    pg = await startPostgres();
    redis = await startRedis();
    await runMigrations(pg);

    process.env.LOG_LEVEL = 'silent';
    process.env.OUTBOX_POLL_INTERVAL_MS = String(POLL_MS);
    process.env.LOOKUP_JOB_ATTEMPTS = '1';
    process.env.LOOKUP_DELAY_MIN_MS = '0';
    process.env.LOOKUP_DELAY_MAX_MS = '0';
    // Small budget so the failure journey exhausts triggers quickly (initial + one retry).
    process.env.EXTERNAL_LOOKUP_MAX_TRIGGERS = '2';

    sim = new ControllableSimulatedPropertyService();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SIMULATED_PROPERTY_SERVICE)
      .useValue(sim)
      .compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(Logger));
    applyGlobalMiddleware(app);
    app.enableShutdownHooks();
    await app.init();

    dataSource = app.get(DataSource);
    relay = app.get(OutboxRelay);
    await dataSource.getRepository(FlowVersion).save(
      dataSource.getRepository(FlowVersion).create({
        version: ACTIVE_FLOW_VERSION,
        definition: { version: ACTIVE_FLOW_VERSION, questionIds: [] },
      }),
    );
    relay.start();
  }, 180000);

  afterAll(async () => {
    relay?.stop();
    if (app) {
      await app.close();
    }
    await redis?.container.stop();
    await pg?.container.stop();
    for (const key of [
      'LOOKUP_WORKER',
      'OUTBOX_POLL_INTERVAL_MS',
      'LOOKUP_JOB_ATTEMPTS',
      'LOOKUP_DELAY_MIN_MS',
      'LOOKUP_DELAY_MAX_MS',
      'EXTERNAL_LOOKUP_MAX_TRIGGERS',
    ]) {
      delete process.env[key];
    }
  });

  beforeEach(() => {
    sim.shouldFail = false;
  });

  /** The app's HTTP server, typed for supertest. */
  function server(): Server {
    return app.getHttpServer() as Server;
  }

  /** Starts a session and returns its id and initial version. */
  async function startSession(): Promise<{ id: string; version: number }> {
    const res = await request(server()).post('/onboarding/sessions');
    expect(res.status).toBe(CREATED);
    const body = res.body as StateBody;
    return { id: body.sessionId, version: body.version };
  }

  /** Submits one answer for the current question, asserting success, and returns the new state. */
  async function submit(
    id: string,
    questionId: string,
    value: unknown,
    version: number,
  ): Promise<StateBody> {
    const res = await request(server())
      .post(`/onboarding/sessions/${id}/answers`)
      .set('Idempotency-Key', randomUUID())
      .send({ questionId, value, expectedVersion: version });
    expect(res.status).toBe(OK);
    return res.body as StateBody;
  }

  /** Answers a sequence of questions, threading the version, and returns the final version. */
  async function answerAll(id: string, seq: [string, unknown][], version: number): Promise<number> {
    let v = version;
    for (const [questionId, value] of seq) {
      const state = await submit(id, questionId, value, v);
      v = state.version;
    }
    return v;
  }

  /** Polls GET /sessions/:id until the external lookup reaches the given status (or times out). */
  async function pollUntilLookup(id: string, target: ExternalLookupStatus): Promise<StateBody> {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    for (;;) {
      const res = await request(server()).get(`/onboarding/sessions/${id}`);
      expect(res.status).toBe(OK);
      const body = res.body as StateBody;
      if (body.externalLookup.status === target) {
        return body;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Lookup for ${id} did not reach ${target}; last=${body.externalLookup.status}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_STEP_MS));
    }
  }

  it('happy path: start → answer branch → address triggers lookup → poll → complete', async () => {
    const { id, version } = await startSession();

    // Answer up to the address; answering the address triggers the async lookup and returns now.
    let v = await answerAll(id, PRE_ADDRESS, version);
    const afterAddress = await submit(id, 'property_address', VALID_ADDRESS, v);
    v = afterAddress.version;
    // The trigger returns immediately without blocking on the lookup (spec §7 stage 1).
    expect(
      [ExternalLookupStatus.NotStarted, ExternalLookupStatus.Loading].includes(
        afterAddress.externalLookup.status,
      ),
    ).toBe(true);

    // Keep answering the remaining questions while the lookup runs in the background.
    v = await answerAll(id, POST_ADDRESS, v);

    // Poll until the lookup completes (forced fast success via the injected sim).
    const settled = await pollUntilLookup(id, ExternalLookupStatus.Completed);
    expect(settled.externalLookup.result).toMatchObject({ dataSource: 'external' });
    expect(settled.completion.canComplete).toBe(true);
    v = settled.version;

    const done = await request(server())
      .post(`/onboarding/sessions/${id}/complete`)
      .send({ expectedVersion: v });

    expect(done.status).toBe(OK);
    const body = done.body as StateBody;
    expect(body.status).toBe(SessionStatus.Completed);
    expect(body.summary).toMatchObject({
      personalDetails: { full_name: 'Jane Doe', date_of_birth: '1990-06-15' },
      residenceType: 'own',
      address: VALID_ADDRESS,
      branchDetails: { year_built: 1990, construction_type: 'brick' },
      propertyData: { dataSource: 'external' },
      coverage: { coverage_start_date: FUTURE_START_DATE, wants_earthquake_coverage: false },
    });
  }, 60000);

  it('failure/fallback path: lookup fails → retry until permanent → complete with fallback', async () => {
    sim.shouldFail = true;
    const { id, version } = await startSession();

    let v = await answerAll(id, PRE_ADDRESS, version);
    const afterAddress = await submit(id, 'property_address', VALID_ADDRESS, v);
    v = afterAddress.version;
    v = await answerAll(id, POST_ADDRESS, v);

    // The first (initial) trigger fails: budget is 2 (initial + one retry), so this is `failed`.
    await pollUntilLookup(id, ExternalLookupStatus.Failed);

    // Manual retry consumes the last trigger; it also fails → permanently_failed + fallback.
    const retry = await request(server())
      .post(`/onboarding/sessions/${id}/external-lookup/retry`)
      .set('Idempotency-Key', randomUUID());
    expect(retry.status).toBe(ACCEPTED);

    const settled = await pollUntilLookup(id, ExternalLookupStatus.PermanentlyFailed);
    expect(settled.externalLookup.result).toMatchObject({ fallback: true, dataSource: 'fallback' });
    expect(settled.completion.canComplete).toBe(true);
    v = settled.version;

    const done = await request(server())
      .post(`/onboarding/sessions/${id}/complete`)
      .send({ expectedVersion: v });

    expect(done.status).toBe(OK);
    const body = done.body as StateBody;
    expect(body.status).toBe(SessionStatus.Completed);
    expect(body.summary).toMatchObject({ propertyData: { dataSource: 'fallback' } });
  }, 60000);
});
