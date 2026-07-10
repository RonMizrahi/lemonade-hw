import { INestApplication, ValidationPipe } from '@nestjs/common';
import { GlobalExceptionFilter } from './filters/global-exception.filter';

/**
 * Applies the cross-cutting HTTP concerns every entrypoint shares: the global
 * `ValidationPipe({ whitelist, transform })` and the global exception filter (spec §6).
 * @param app the Nest application instance
 */
export function applyGlobalMiddleware(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
}
