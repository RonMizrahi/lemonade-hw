import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AnswerStatus, ExternalLookupStatus, SessionStatus } from '../../src/common/enums';
import { Answer, ExternalLookup, FlowVersion, OutboxEvent } from '../../src/database/entities';
import { ACTIVE_FLOW_VERSION } from '../../src/flow-engine/flow-definition';
import { expectErrorShape } from './setup/error-shape';
import { bootTestApp, httpServer } from './setup/test-app';
import { runMigrations, startPostgres, StartedPostgres } from './setup/postgres-container';

const OK = 200;
const CREATED = 201;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const CONFLICT = 409;
const UNPROCESSABLE = 422;

/** A valid address answer value; answering it fires the external lookup (spec §7). */
const VALID_ADDRESS = { street: '1 Main St', city: 'Springfield' };

/**
 * Asserts a response body has the full session-state contract shape (spec §6). Catches
 * contract drift cheaply without pinning exact values.
 */
function expectSessionStateShape(body: unknown): void {
  expect(body).toBeDefined();
  const state = body as Record<string, unknown>;
  expect(typeof state.sessionId).toBe('string');
  expect(typeof state.status).toBe('string');
  expect(typeof state.version).toBe('number');
  expect('currentQuestion' in state).toBe(true);
  expect(Array.isArray(state.answeredQuestions)).toBe(true);
  expect(typeof state.externalLookup).toBe('object');
  expect(typeof state.completion).toBe('object');
  expect('summary' in state).toBe(true);
}

/** One answered-question projection in a session-state response body. */
interface AnsweredQuestionBody {
  questionId: string;
  value: unknown;
  status: AnswerStatus;
}

/** Reads the numeric `version` from a session-state response body. */
function versionOf(body: unknown): number {
  return (body as { version: number }).version;
}

/** Reads the typed `answeredQuestions` array from a session-state response body. */
function answersOf(body: unknown): AnsweredQuestionBody[] {
  return (body as { answeredQuestions: AnsweredQuestionBody[] }).answeredQuestions;
}

describe('Onboarding answer flow (Testcontainers Postgres)', () => {
  let coords: StartedPostgres;
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    coords = await startPostgres();
    await runMigrations(coords);
    app = await bootTestApp();
    dataSource = app.get(DataSource);
    // Register the active flow version so startSession can pin it.
    await dataSource.getRepository(FlowVersion).save(
      dataSource.getRepository(FlowVersion).create({
        version: ACTIVE_FLOW_VERSION,
        definition: { version: ACTIVE_FLOW_VERSION, questionIds: [] },
      }),
    );
  }, 120000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await coords.container.stop();
  });

  /**
   * Starts a session and returns its id and current version.
   */
  async function startSession(): Promise<{ id: string; version: number }> {
    const res = await request(httpServer(app)).post('/onboarding/sessions');
    expect(res.status).toBe(CREATED);
    return { id: res.body.sessionId, version: res.body.version };
  }

  /**
   * Submits an answer for the current question and returns the response.
   */
  function submit(
    id: string,
    questionId: string,
    value: unknown,
    expectedVersion: number,
    key = randomUUID(),
  ): request.Test {
    return request(httpServer(app))
      .post(`/onboarding/sessions/${id}/answers`)
      .set('Idempotency-Key', key)
      .send({ questionId, value, expectedVersion });
  }

  describe('POST /onboarding/sessions', () => {
    it('creates a session and returns the initial state (201, first question)', async () => {
      const res = await request(httpServer(app)).post('/onboarding/sessions');

      expect(res.status).toBe(CREATED);
      expectSessionStateShape(res.body);
      expect(res.body.status).toBe(SessionStatus.InProgress);
      // TypeORM's @VersionColumn starts at 1 on the first persisted row.
      expect(res.body.version).toBe(1);
      expect(res.body.currentQuestion.id).toBe('full_name');
      expect(res.body.answeredQuestions).toEqual([]);
    });
  });

  describe('GET /onboarding/sessions/:id', () => {
    it('returns the current state for a known session (200)', async () => {
      const { id } = await startSession();

      const res = await request(httpServer(app)).get(`/onboarding/sessions/${id}`);

      expect(res.status).toBe(OK);
      expectSessionStateShape(res.body);
      expect(res.body.sessionId).toBe(id);
    });

    it('returns 404 for an unknown session (error shape)', async () => {
      const res = await request(httpServer(app)).get(`/onboarding/sessions/${randomUUID()}`);

      expect(res.status).toBe(NOT_FOUND);
      expectErrorShape(res.body, NOT_FOUND);
    });
  });

  describe('POST /onboarding/sessions/:id/answers', () => {
    it('records a valid answer and advances the current question (200)', async () => {
      const { id, version } = await startSession();

      const res = await submit(id, 'full_name', 'Jane Doe', version);

      expect(res.status).toBe(OK);
      expectSessionStateShape(res.body);
      expect(res.body.version).toBe(version + 1);
      expect(res.body.currentQuestion.id).toBe('date_of_birth');
      expect(res.body.answeredQuestions).toEqual([
        { questionId: 'full_name', value: 'Jane Doe', status: AnswerStatus.Active },
      ]);
    });

    it('rejects an invalid value via the FlowEngine (400)', async () => {
      const { id, version } = await startSession();

      const res = await submit(id, 'full_name', '', version);

      expect(res.status).toBe(BAD_REQUEST);
      expectErrorShape(res.body, BAD_REQUEST);
    });

    it('rejects a non-current question (409)', async () => {
      const { id, version } = await startSession();

      const res = await submit(id, 'date_of_birth', '1990-01-01', version);

      expect(res.status).toBe(CONFLICT);
      expectErrorShape(res.body, CONFLICT);
    });

    it('rejects a stale expectedVersion (409)', async () => {
      const { id } = await startSession();

      const res = await submit(id, 'full_name', 'Jane Doe', 99);

      expect(res.status).toBe(CONFLICT);
      expectErrorShape(res.body, CONFLICT);
    });

    it('replays the stored response for the same key + same body (one write)', async () => {
      const { id, version } = await startSession();
      const key = randomUUID();

      const first = await submit(id, 'full_name', 'Jane Doe', version, key);
      const replay = await submit(id, 'full_name', 'Jane Doe', version, key);

      expect(first.status).toBe(OK);
      expect(replay.status).toBe(OK);
      expect(replay.body).toEqual(first.body);
      const answers = await dataSource.getRepository(Answer).find({ where: { sessionId: id } });
      expect(answers).toHaveLength(1);
    });

    it('rejects the same key + different body (422)', async () => {
      const { id, version } = await startSession();
      const key = randomUUID();

      await submit(id, 'full_name', 'Jane Doe', version, key);
      const res = await submit(id, 'full_name', 'Someone Else', version, key);

      expect(res.status).toBe(UNPROCESSABLE);
      expectErrorShape(res.body, UNPROCESSABLE);
    });

    it('handles two concurrent submits with the same key + body (no 500; one write)', async () => {
      // Regression for QA finding S2: a concurrent duplicate that loses the idempotency-key /
      // answer unique-constraint race must replay the winner's response, not surface a 500 (§6).
      const { id, version } = await startSession();
      const key = randomUUID();

      const [a, b] = await Promise.all([
        submit(id, 'full_name', 'Jane Doe', version, key),
        submit(id, 'full_name', 'Jane Doe', version, key),
      ]);

      expect([a.status, b.status]).toEqual([OK, OK]);
      expect(a.body).toEqual(b.body);
      const answers = await dataSource.getRepository(Answer).find({ where: { sessionId: id } });
      expect(answers).toHaveLength(1);
    });

    it('rejects a concurrent same-key request with a different body (422, never 500)', async () => {
      const { id, version } = await startSession();
      const key = randomUUID();

      const results = await Promise.all([
        submit(id, 'full_name', 'Jane Doe', version, key),
        submit(id, 'full_name', 'Someone Else', version, key),
      ]);

      const statuses = results.map((r) => r.status).sort((x, y) => x - y);
      expect(statuses).toEqual([OK, UNPROCESSABLE]);
    });

    it('answering property_address creates the external_lookup + outbox_event atomically', async () => {
      const { id, version } = await startSession();
      let v = version;
      const seq: [string, unknown][] = [
        ['full_name', 'Jane Doe'],
        ['date_of_birth', '1990-06-15'],
        ['residence_type', 'own'],
      ];
      for (const [q, value] of seq) {
        const res = await submit(id, q, value, v);
        expect(res.status).toBe(OK);
        v = versionOf(res.body);
      }

      const res = await submit(id, 'property_address', VALID_ADDRESS, v);

      expect(res.status).toBe(OK);
      expect(res.body.externalLookup.status).toBe(ExternalLookupStatus.NotStarted);

      const lookup = await dataSource
        .getRepository(ExternalLookup)
        .findOne({ where: { sessionId: id } });
      expect(lookup).not.toBeNull();
      expect(lookup?.generation).toBe(1);
      expect(lookup?.triggers).toBe(1);

      const events = await dataSource
        .getRepository(OutboxEvent)
        .find({ where: { aggregateId: lookup?.id } });
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('external_lookup.requested');
      expect(events[0].payload).toMatchObject({ sessionId: id, generation: 1 });
    });
  });

  describe('PUT /onboarding/sessions/:id/answers/:questionId', () => {
    /**
     * Starts a session and answers full_name → date_of_birth → residence_type=own,
     * returning the session id and its current version.
     */
    async function seedHomeownerStart(): Promise<{ id: string; version: number }> {
      const { id, version } = await startSession();
      let v = version;
      for (const [q, value] of [
        ['full_name', 'Jane Doe'],
        ['date_of_birth', '1990-06-15'],
        ['residence_type', 'own'],
      ] as [string, unknown][]) {
        const res = await submit(id, q, value, v);
        v = versionOf(res.body);
      }
      return { id, version: v };
    }

    it('edits a prior answer and returns recalculated state (200)', async () => {
      const { id, version } = await seedHomeownerStart();

      const res = await request(httpServer(app))
        .put(`/onboarding/sessions/${id}/answers/full_name`)
        .send({ value: 'Janet Doe', expectedVersion: version });

      expect(res.status).toBe(OK);
      expectSessionStateShape(res.body);
      const edited = answersOf(res.body).find((a) => a.questionId === 'full_name');
      expect(edited?.value).toBe('Janet Doe');
    });

    it('marks now-hidden answers irrelevant on a branch switch (own → rent), persisted', async () => {
      const { id, version } = await seedHomeownerStart();
      // answer property_address + a homeowner-only question, then switch to rent
      let v = version;
      for (const [q, value] of [
        ['property_address', VALID_ADDRESS],
        ['year_built', 1990],
      ] as [string, unknown][]) {
        const res = await submit(id, q, value, v);
        v = versionOf(res.body);
      }

      const res = await request(httpServer(app))
        .put(`/onboarding/sessions/${id}/answers/residence_type`)
        .send({ value: 'rent', expectedVersion: v });

      expect(res.status).toBe(OK);
      // year_built is homeowner-only → now irrelevant, excluded from active/current
      const yearBuilt = await dataSource
        .getRepository(Answer)
        .findOne({ where: { sessionId: id, questionId: 'year_built' } });
      expect(yearBuilt?.status).toBe(AnswerStatus.Irrelevant);
      const activeIds = answersOf(res.body)
        .filter((a) => a.status === AnswerStatus.Active)
        .map((a) => a.questionId);
      expect(activeIds).not.toContain('year_built');
    });

    it('rejects an invalid edited value (400)', async () => {
      const { id, version } = await seedHomeownerStart();

      const res = await request(httpServer(app))
        .put(`/onboarding/sessions/${id}/answers/full_name`)
        .send({ value: '', expectedVersion: version });

      expect(res.status).toBe(BAD_REQUEST);
      expectErrorShape(res.body, BAD_REQUEST);
    });

    it('rejects editing a never-answered question (404)', async () => {
      const { id, version } = await startSession();

      const res = await request(httpServer(app))
        .put(`/onboarding/sessions/${id}/answers/full_name`)
        .send({ value: 'Jane', expectedVersion: version });

      expect(res.status).toBe(NOT_FOUND);
      expectErrorShape(res.body, NOT_FOUND);
    });

    it('rejects a stale expectedVersion (409)', async () => {
      const { id } = await seedHomeownerStart();

      const res = await request(httpServer(app))
        .put(`/onboarding/sessions/${id}/answers/full_name`)
        .send({ value: 'Janet', expectedVersion: 99 });

      expect(res.status).toBe(CONFLICT);
      expectErrorShape(res.body, CONFLICT);
    });
  });

  describe('POST /onboarding/sessions/:id/complete', () => {
    /** A future coverage-start date so the coverage rule passes regardless of run date. */
    const FUTURE_START_DATE = '2099-01-01';

    /**
     * Answers the full homeowner branch (all required visible questions) over HTTP, then
     * forces the session's external_lookup to `completed` directly in the DB (this API-only
     * integration app runs no worker). Returns the session id and its current version.
     */
    async function seedCompletableSession(): Promise<{ id: string; version: number }> {
      const { id, version } = await startSession();
      let v = version;
      const seq: [string, unknown][] = [
        ['full_name', 'Jane Doe'],
        ['date_of_birth', '1990-06-15'],
        ['residence_type', 'own'],
        ['property_address', VALID_ADDRESS],
        ['year_built', 1990],
        ['construction_type', 'brick'],
        ['has_security_system', false],
        ['coverage_start_date', FUTURE_START_DATE],
        ['wants_earthquake_coverage', false],
      ];
      for (const [q, value] of seq) {
        const res = await submit(id, q, value, v);
        expect(res.status).toBe(OK);
        v = versionOf(res.body);
      }
      const repo = dataSource.getRepository(ExternalLookup);
      const lookup = await repo.findOneByOrFail({ sessionId: id });
      lookup.status = ExternalLookupStatus.Completed;
      lookup.result = { dataSource: 'external', estimatedValue: 500000 };
      await repo.save(lookup);
      return { id, version: v };
    }

    it('completes a fully-answered session with a completed lookup (200 + summary)', async () => {
      const { id, version } = await seedCompletableSession();

      const res = await request(httpServer(app))
        .post(`/onboarding/sessions/${id}/complete`)
        .send({ expectedVersion: version });

      expect(res.status).toBe(OK);
      expectSessionStateShape(res.body);
      expect(res.body.status).toBe(SessionStatus.Completed);
      expect(res.body.summary).toMatchObject({
        personalDetails: { full_name: 'Jane Doe' },
        residenceType: 'own',
        propertyData: { dataSource: 'external' },
      });
    });

    it('rejects completion when required questions are unmet (409)', async () => {
      const { id, version } = await startSession();
      const res1 = await submit(id, 'full_name', 'Jane Doe', version);
      const v = versionOf(res1.body);

      const res = await request(httpServer(app))
        .post(`/onboarding/sessions/${id}/complete`)
        .send({ expectedVersion: v });

      expect(res.status).toBe(CONFLICT);
      expectErrorShape(res.body, CONFLICT);
    });

    it('rejects a stale expectedVersion (409)', async () => {
      const { id } = await seedCompletableSession();

      const res = await request(httpServer(app))
        .post(`/onboarding/sessions/${id}/complete`)
        .send({ expectedVersion: 99 });

      expect(res.status).toBe(CONFLICT);
      expectErrorShape(res.body, CONFLICT);
    });
  });

  it('rejects a submit missing the Idempotency-Key header (400, error shape)', async () => {
    const res = await request(httpServer(app))
      .post(`/onboarding/sessions/${randomUUID()}/answers`)
      .send({ questionId: 'full_name', value: 'Jane Doe', expectedVersion: 1 });

    expect(res.status).toBe(BAD_REQUEST);
    expectErrorShape(res.body, BAD_REQUEST);
  });

  it('rejects a submit with an invalid body via ValidationPipe (400, details)', async () => {
    const res = await request(httpServer(app))
      .post(`/onboarding/sessions/${randomUUID()}/answers`)
      .set('Idempotency-Key', randomUUID())
      .send({ questionId: '', expectedVersion: 'not-a-number' });

    expect(res.status).toBe(BAD_REQUEST);
    expectErrorShape(res.body, BAD_REQUEST);
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it('rejects a non-uuid session id via ParseUUIDPipe (400, error shape)', async () => {
    const res = await request(httpServer(app)).get('/onboarding/sessions/not-a-uuid');

    expect(res.status).toBe(BAD_REQUEST);
    expectErrorShape(res.body, BAD_REQUEST);
  });
});
