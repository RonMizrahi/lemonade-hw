import { FlowDefinition } from './flow.types';

/**
 * Boot-time flow-definition validator (spec §4). M1 provides a minimal check (non-empty);
 * M2 expands it to enforce unique ids, choice presence, predicate references, and at least
 * one always-visible question — failing fast on a bad definition.
 * @param flow the flow definition to validate
 * @throws Error if the definition is structurally invalid
 */
export function validateFlowDefinition(flow: FlowDefinition): void {
  if (flow.questions.length === 0) {
    throw new Error('Flow definition must declare at least one question');
  }
}
