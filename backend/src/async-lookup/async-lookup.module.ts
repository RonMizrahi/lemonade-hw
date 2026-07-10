import { Module } from '@nestjs/common';
import { LookupProcessor } from './lookup.processor';
import { OutboxRelay } from './outbox-relay';
import { SIMULATED_PROPERTY_SERVICE } from './simulated-property.service';
import { StubSimulatedPropertyService } from './simulated-property.stub';

/**
 * The async external-lookup pipeline (spec §7). Provides the OutboxRelay, LookupProcessor,
 * and SimulatedPropertyService — all M1 stubs. M4 implements the poll loop, the BullMQ
 * consumer, and the simulation, and registers the BullMQ queue here.
 */
@Module({
  providers: [
    OutboxRelay,
    LookupProcessor,
    { provide: SIMULATED_PROPERTY_SERVICE, useClass: StubSimulatedPropertyService },
  ],
  exports: [OutboxRelay, LookupProcessor, SIMULATED_PROPERTY_SERVICE],
})
export class AsyncLookupModule {}
