import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ALL_ENTITIES } from '../database/entities';
import { FlowEngineModule } from '../flow-engine/flow-engine.module';
import { AsyncLookupModule } from '../async-lookup/async-lookup.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { OutboxWriter } from './outbox/outbox-writer';
import { SessionStateAssembler } from './session-state.assembler';
import { SummaryBuilder } from './summary-builder';
import { ALL_REPOSITORIES } from './repositories';

/**
 * The onboarding feature module (spec §2). Wires the controller, service, all six
 * repositories, the state assembler, and the outbox writer; imports the FlowEngine and
 * async-lookup pipeline. The service methods are M1 stubs filled by M3/M4/M5.
 */
@Module({
  imports: [TypeOrmModule.forFeature(ALL_ENTITIES), FlowEngineModule, AsyncLookupModule],
  controllers: [OnboardingController],
  providers: [
    OnboardingService,
    SessionStateAssembler,
    SummaryBuilder,
    OutboxWriter,
    ...ALL_REPOSITORIES,
  ],
  exports: [OnboardingService, SessionStateAssembler, OutboxWriter, ...ALL_REPOSITORIES],
})
export class OnboardingModule {}
