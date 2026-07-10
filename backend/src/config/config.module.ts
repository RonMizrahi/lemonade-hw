import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { loadConfiguration } from './configuration';
import { envValidationSchema } from './env.validation';

/**
 * Global configuration module: loads and validates env vars (Joi), then exposes
 * the typed {@link AppConfig} tree via `ConfigService`.
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [loadConfiguration],
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
  ],
})
export class AppConfigModule {}
