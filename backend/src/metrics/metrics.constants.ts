/**
 * Metric series names (spec §11). Injection tokens are derived from these via the
 * `@willsoto/nestjs-prometheus` naming convention, so `@InjectMetric(<NAME>)` resolves each.
 */
export const HTTP_REQUEST_DURATION_SECONDS = 'http_request_duration_seconds';
export const ANSWERS_SUBMITTED_TOTAL = 'answers_submitted_total';
export const EXTERNAL_LOOKUP_DURATION_SECONDS = 'external_lookup_duration_seconds';
export const EXTERNAL_LOOKUP_TOTAL = 'external_lookup_total';
export const EXTERNAL_LOOKUP_TRIGGERS_TOTAL = 'external_lookup_triggers_total';
export const OUTBOX_EVENTS_PUBLISHED_TOTAL = 'outbox_events_published_total';
export const BULLMQ_QUEUE_DEPTH = 'bullmq_queue_depth';

/**
 * Histogram buckets (seconds) for HTTP request durations — sub-millisecond to multi-second.
 */
export const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * Histogram buckets (seconds) for the simulated external lookup (spec §7: 3–8s + retries).
 */
export const EXTERNAL_LOOKUP_DURATION_BUCKETS = [0.5, 1, 2, 3, 5, 8, 13, 21, 34];
