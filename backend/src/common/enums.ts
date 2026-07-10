/**
 * Lifecycle status of an onboarding session.
 */
export enum SessionStatus {
  InProgress = 'in_progress',
  Completed = 'completed',
}

/**
 * Whether a stored answer is currently active or has been superseded by a branch change.
 */
export enum AnswerStatus {
  Active = 'active',
  Irrelevant = 'irrelevant',
}

/**
 * Status of the asynchronous external property lookup.
 * `permanently_failed` renders as "failed — fallback applied" and unblocks completion.
 */
export enum ExternalLookupStatus {
  NotStarted = 'not_started',
  Loading = 'loading',
  Completed = 'completed',
  Failed = 'failed',
  PermanentlyFailed = 'permanently_failed',
}

/**
 * Delivery status of an outbox event awaiting relay to the queue.
 */
export enum OutboxStatus {
  Pending = 'pending',
  Published = 'published',
}

/**
 * The supported question value types in the flow definition.
 */
export enum QuestionType {
  Text = 'text',
  Number = 'number',
  Boolean = 'boolean',
  Date = 'date',
  Choice = 'choice',
  Address = 'address',
}
