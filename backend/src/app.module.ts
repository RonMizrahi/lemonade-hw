import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/config.module';
import { AppConfig } from './config/configuration';
import { buildLoggerParams } from './common/logging/logger.config';
import { DatabaseModule } from './database/database.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { MetricsModule } from './metrics/metrics.module';

/**
 * The API application module (HTTP entrypoint). Composes config, structured logging,
 * the database connection, the onboarding feature, and the (M6-filled) metrics module.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) =>
        buildLoggerParams(config.get('logLevel', { infer: true })),
    }),
    DatabaseModule,
    OnboardingModule,
    MetricsModule,
  ],
})
export class AppModule {}
