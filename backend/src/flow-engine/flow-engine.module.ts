import { Module } from '@nestjs/common';
import { FLOW_DEFINITION } from './flow-definition';
import { FLOW_ENGINE } from './flow-engine.interface';
import { FlowEngineService } from './flow-engine.service';
import { validateFlowDefinition } from './validate-flow-definition';

/**
 * Provides the pure predicate FlowEngine under the {@link FLOW_ENGINE} token and fails fast at
 * boot if the flow definition is structurally invalid (spec §4).
 */
@Module({
  providers: [{ provide: FLOW_ENGINE, useClass: FlowEngineService }],
  exports: [FLOW_ENGINE],
})
export class FlowEngineModule {
  /** Validates the active flow definition on boot; a bad definition throws and stops startup. */
  onModuleInit(): void {
    validateFlowDefinition(FLOW_DEFINITION);
  }
}
