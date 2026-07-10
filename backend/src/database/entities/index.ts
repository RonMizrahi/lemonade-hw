import { Answer } from './answer.entity';
import { ExternalLookup } from './external-lookup.entity';
import { FlowVersion } from './flow-version.entity';
import { IdempotencyKey } from './idempotency-key.entity';
import { OnboardingSession } from './onboarding-session.entity';
import { OutboxEvent } from './outbox-event.entity';

export { Answer } from './answer.entity';
export { ExternalLookup } from './external-lookup.entity';
export { FlowVersion } from './flow-version.entity';
export { IdempotencyKey } from './idempotency-key.entity';
export { OnboardingSession } from './onboarding-session.entity';
export { OutboxEvent } from './outbox-event.entity';
export type { SessionSummary } from './onboarding-session.entity';
export type { OutboxEventPayload } from './outbox-event.entity';
export type { ExternalLookupResult } from './external-lookup.entity';
export type { FlowDefinitionSnapshot } from './flow-version.entity';

/**
 * The complete set of persisted entities, registered with TypeORM in one place.
 */
export const ALL_ENTITIES = [
  OnboardingSession,
  Answer,
  FlowVersion,
  ExternalLookup,
  OutboxEvent,
  IdempotencyKey,
];
