import { Module } from '@nestjs/common';
import { FLOW_ENGINE } from './flow-engine.interface';
import { StubFlowEngine } from './flow-engine.stub';

/**
 * Provides the FlowEngine implementation under the {@link FLOW_ENGINE} token. M1 binds the
 * trivial stub; M2 swaps in the real predicate engine by replacing `useClass` here.
 */
@Module({
  providers: [{ provide: FLOW_ENGINE, useClass: StubFlowEngine }],
  exports: [FLOW_ENGINE],
})
export class FlowEngineModule {}
