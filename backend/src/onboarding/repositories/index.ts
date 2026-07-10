import { AnswerRepository } from './answer.repository';
import { ExternalLookupRepository } from './external-lookup.repository';
import { FlowVersionRepository } from './flow-version.repository';
import { IdempotencyKeyRepository } from './idempotency-key.repository';
import { OnboardingSessionRepository } from './onboarding-session.repository';
import { OutboxEventRepository } from './outbox-event.repository';

export { AnswerRepository } from './answer.repository';
export { ExternalLookupRepository } from './external-lookup.repository';
export { FlowVersionRepository } from './flow-version.repository';
export { IdempotencyKeyRepository } from './idempotency-key.repository';
export { OnboardingSessionRepository } from './onboarding-session.repository';
export { OutboxEventRepository } from './outbox-event.repository';

/**
 * All six aggregate repositories, registered as providers in one place.
 */
export const ALL_REPOSITORIES = [
  OnboardingSessionRepository,
  AnswerRepository,
  FlowVersionRepository,
  ExternalLookupRepository,
  OutboxEventRepository,
  IdempotencyKeyRepository,
];
