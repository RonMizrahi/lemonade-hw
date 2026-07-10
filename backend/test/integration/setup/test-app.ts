import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { AppModule } from '../../../src/app.module';
import { applyGlobalMiddleware } from '../../../src/common/bootstrap';

/**
 * Boots the full API app (AppModule) against the already-configured test database and
 * applies the same global pipe + filter as production, so route wiring and the error shape
 * are exercised for real.
 * @returns the initialized Nest application
 */
export async function bootTestApp(): Promise<INestApplication> {
  process.env.LOG_LEVEL = 'silent';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  app.useLogger(app.get(Logger));
  applyGlobalMiddleware(app);
  await app.init();
  return app;
}

/**
 * Returns the app's underlying HTTP server typed for supertest, avoiding `any` propagation.
 * @param app the initialized Nest application
 * @returns the Node HTTP server instance
 */
export function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}
