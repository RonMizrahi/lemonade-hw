import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { register } from 'prom-client';
import { WorkerModule } from './worker.module';
import { AppConfig } from './config/configuration';
import { OutboxRelay } from './async-lookup/outbox-relay';

/**
 * Path the worker serves its Prometheus metrics under (spec §11).
 */
const METRICS_PATH = '/metrics';

/**
 * HTTP status codes used by the worker metrics endpoint.
 */
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;

/**
 * Starts a minimal HTTP server exposing the shared `prom-client` registry at `/metrics`
 * (spec §11). The worker has no Nest HTTP adapter, so this standalone listener is what makes
 * the worker process scrapable — the metric series are populated by `MetricsModule` (imported
 * in `WorkerModule`), which registers them on the same default registry.
 * @param port the port to listen on (from validated config: `WORKER_METRICS_PORT`)
 * @param logger the application logger for reporting listen failures
 * @returns the started HTTP server
 */
function startMetricsServer(port: number, logger: Logger): Server {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET' || req.url !== METRICS_PATH) {
      res.writeHead(HTTP_NOT_FOUND).end();
      return;
    }
    register
      .metrics()
      .then((body) => {
        res.writeHead(HTTP_OK, { 'Content-Type': register.contentType }).end(body);
      })
      .catch(() => {
        res.writeHead(HTTP_SERVER_ERROR).end();
      });
  });
  // A metrics-endpoint failure (e.g. the port is busy) must not crash the core worker: log and
  // degrade to "no metrics" rather than letting the unhandled 'error' escalate to a fatal throw.
  server.on('error', (err: Error) => {
    logger.error(`Worker metrics server failed on port ${port}: ${err.message}`);
  });
  server.listen(port);
  // Don't let the metrics listener keep the process alive during shutdown; Nest's shutdown
  // hooks own the graceful stop of the relay/consumer.
  server.unref();
  return server;
}

/**
 * Worker entrypoint (spec §2, §7, §11). Bootstraps a Nest application context (no HTTP server)
 * hosting the OutboxRelay + BullMQ consumer, starts the relay, and exposes `/metrics` on the
 * configured `WORKER_METRICS_PORT` so the worker is independently scrapable.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();

  const config = app.get(ConfigService<AppConfig, true>);
  const metricsPort = config.get('workerMetricsPort', { infer: true });
  startMetricsServer(metricsPort, logger);

  const relay = app.get(OutboxRelay);
  relay.start();

  logger.log(
    `Worker started (OutboxRelay + BullMQ consumer); metrics on port ${metricsPort} at /metrics`,
  );
}

void bootstrap();
