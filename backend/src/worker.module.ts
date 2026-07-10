import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/config.module';
import { AppConfig } from './config/configuration';
import { buildLoggerParams } from './common/logging/logger.config';
import { DatabaseModule } from './database/database.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { AsyncLookupModule } from './async-lookup/async-lookup.module';
import { MetricsModule } from './metrics/metrics.module';

/**
 * The worker application module (spec §2, §7). Shares config, logging, and the database with
 * the API, and hosts the async-lookup pipeline (OutboxRelay + BullMQ consumer). M4 registers
 * the BullMQ queue and the relay poll loop here; M1 wires the stubs so the process boots.
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
    AsyncLookupModule,
    MetricsModule,
  ],
})
export class WorkerModule {}
