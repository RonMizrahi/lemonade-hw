import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { applyGlobalMiddleware } from '../../src/common/bootstrap';
import { setupSwagger } from '../../src/common/swagger/setup-swagger';
import { httpServer } from './setup/test-app';
import { runMigrations, startPostgres, StartedPostgres } from './setup/postgres-container';

const OK = 200;

/**
 * Boots the full API with Swagger mounted (as `main.ts` does), so `/docs-json` and `/metrics`
 * are both exercised against the real module graph.
 * @returns the initialized Nest application
 */
async function bootAppWithSwagger(): Promise<INestApplication> {
  process.env.LOG_LEVEL = 'silent';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  app.useLogger(app.get(Logger));
  applyGlobalMiddleware(app);
  setupSwagger(app);
  await app.init();
  return app;
}

describe('Observability: Swagger + Metrics (Testcontainers Postgres)', () => {
  let coords: StartedPostgres;
  let app: INestApplication;

  beforeAll(async () => {
    coords = await startPostgres();
    await runMigrations(coords);
    app = await bootAppWithSwagger();
  }, 120000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await coords.container.stop();
  });

  describe('GET /docs-json', () => {
    it('serves the OpenAPI JSON document', async () => {
      const res = await request(httpServer(app)).get('/docs-json');

      expect(res.status).toBe(OK);
      expect(res.body.openapi).toMatch(/^3\./);
      expect(res.body.info.title).toBe('Onboarding API');
      // The onboarding routes are documented (contract is discoverable via Swagger).
      expect(res.body.paths['/onboarding/sessions']).toBeDefined();
    });
  });

  describe('GET /metrics', () => {
    it('returns Prometheus text exposing every spec §11 series', async () => {
      const res = await request(httpServer(app)).get('/metrics');

      expect(res.status).toBe(OK);
      expect(res.headers['content-type']).toContain('text/plain');

      const body: string = res.text;
      for (const series of [
        'answers_submitted_total',
        'external_lookup_duration_seconds',
        'external_lookup_total',
        'external_lookup_triggers_total',
        'outbox_events_published_total',
        'bullmq_queue_depth',
      ]) {
        expect(body).toContain(series);
      }
    });

    it('records the http_request_duration_seconds histogram after an HTTP request', async () => {
      // A bad-uuid GET is rejected by ParseUUIDPipe → 400, exercising the error path.
      const errored = await request(httpServer(app)).get('/onboarding/sessions/not-a-uuid');
      expect(errored.status).toBe(400);

      const res = await request(httpServer(app)).get('/metrics');

      expect(res.status).toBe(OK);
      expect(res.text).toContain('http_request_duration_seconds_bucket');
      // The matched route pattern is used as the label, not the raw URL (bounded cardinality).
      expect(res.text).toContain('route="/onboarding/sessions/:id"');
      // The label carries the final status set by the exception filter (400), not the
      // pre-error default (200) — recorded on the response `finish` event.
      const countLine = res.text
        .split('\n')
        .find(
          (line) =>
            line.startsWith('http_request_duration_seconds_count') &&
            line.includes('route="/onboarding/sessions/:id"'),
        );
      expect(countLine).toContain('status_code="400"');
    });
  });
});
