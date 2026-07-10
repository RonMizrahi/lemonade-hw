import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { expectErrorShape } from './setup/error-shape';
import { bootTestApp, httpServer } from './setup/test-app';
import { runMigrations, startPostgres, StartedPostgres } from './setup/postgres-container';

const NOT_IMPLEMENTED = 501;
const BAD_REQUEST = 400;

describe('Onboarding routes (Testcontainers Postgres)', () => {
  let coords: StartedPostgres;
  let app: INestApplication;

  beforeAll(async () => {
    coords = await startPostgres();
    await runMigrations(coords);
    app = await bootTestApp();
  }, 120000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await coords.container.stop();
  });

  it('boots the application', () => {
    expect(app).toBeDefined();
    expect(app.getHttpServer()).toBeDefined();
  });

  it('POST /onboarding/sessions is wired (501 stub, error shape)', async () => {
    const res = await request(httpServer(app)).post('/onboarding/sessions');

    expect(res.status).toBe(NOT_IMPLEMENTED);
    expectErrorShape(res.body, NOT_IMPLEMENTED);
  });

  it('GET /onboarding/sessions/:id is wired (501 stub, error shape)', async () => {
    const res = await request(httpServer(app)).get(`/onboarding/sessions/${randomUUID()}`);

    expect(res.status).toBe(NOT_IMPLEMENTED);
    expectErrorShape(res.body, NOT_IMPLEMENTED);
  });

  it('POST /onboarding/sessions/:id/answers is wired (501 stub, error shape)', async () => {
    const res = await request(httpServer(app))
      .post(`/onboarding/sessions/${randomUUID()}/answers`)
      .set('Idempotency-Key', randomUUID())
      .send({ questionId: 'full_name', value: 'Jane Doe', expectedVersion: 1 });

    expect(res.status).toBe(NOT_IMPLEMENTED);
    expectErrorShape(res.body, NOT_IMPLEMENTED);
  });

  it('PUT /onboarding/sessions/:id/answers/:questionId is wired (501 stub, error shape)', async () => {
    const res = await request(httpServer(app))
      .put(`/onboarding/sessions/${randomUUID()}/answers/full_name`)
      .send({ value: 'Jane Doe', expectedVersion: 1 });

    expect(res.status).toBe(NOT_IMPLEMENTED);
    expectErrorShape(res.body, NOT_IMPLEMENTED);
  });

  it('POST /onboarding/sessions/:id/external-lookup/retry is wired (501 stub, error shape)', async () => {
    const res = await request(httpServer(app))
      .post(`/onboarding/sessions/${randomUUID()}/external-lookup/retry`)
      .set('Idempotency-Key', randomUUID());

    expect(res.status).toBe(NOT_IMPLEMENTED);
    expectErrorShape(res.body, NOT_IMPLEMENTED);
  });

  it('POST /onboarding/sessions/:id/complete is wired (501 stub, error shape)', async () => {
    const res = await request(httpServer(app))
      .post(`/onboarding/sessions/${randomUUID()}/complete`)
      .send({ expectedVersion: 1 });

    expect(res.status).toBe(NOT_IMPLEMENTED);
    expectErrorShape(res.body, NOT_IMPLEMENTED);
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
