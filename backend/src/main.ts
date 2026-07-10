import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { applyGlobalMiddleware } from './common/bootstrap';
import { setupSwagger } from './common/swagger/setup-swagger';

/**
 * HTTP API entrypoint (spec §2). Bootstraps Nest, wires structured logging, the global
 * validation pipe and exception filter, and Swagger, then listens on the configured port.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  applyGlobalMiddleware(app);
  setupSwagger(app);
  app.enableCors();
  app.enableShutdownHooks();

  const config = app.get(ConfigService<AppConfig, true>);
  const port = config.get('httpPort', { infer: true });
  await app.listen(port);

  app.get(Logger).log(`API listening on port ${port} (docs at /docs)`);
}

void bootstrap();
