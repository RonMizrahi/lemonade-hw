import { Provider } from '@nestjs/common';
import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import {
  ANSWERS_SUBMITTED_TOTAL,
  BULLMQ_QUEUE_DEPTH,
  EXTERNAL_LOOKUP_DURATION_BUCKETS,
  EXTERNAL_LOOKUP_DURATION_SECONDS,
  EXTERNAL_LOOKUP_TOTAL,
  EXTERNAL_LOOKUP_TRIGGERS_TOTAL,
  HTTP_DURATION_BUCKETS,
  HTTP_REQUEST_DURATION_SECONDS,
  OUTBOX_EVENTS_PUBLISHED_TOTAL,
} from './metrics.constants';

/**
 * The Prometheus metric series defined by spec §11. Each provider registers its metric on the
 * shared `prom-client` default registry (served at `/metrics`) and can be injected elsewhere via
 * `@InjectMetric(<name>)`. Later milestones inject and increment these; M6 only defines/exports.
 */
export const metricProviders: Provider[] = [
  makeHistogramProvider({
    name: HTTP_REQUEST_DURATION_SECONDS,
    help: 'Duration of HTTP requests in seconds, by method, route, and status code',
    labelNames: ['method', 'route', 'status_code'],
    buckets: HTTP_DURATION_BUCKETS,
  }),
  makeCounterProvider({
    name: ANSWERS_SUBMITTED_TOTAL,
    help: 'Total number of answers submitted across all sessions',
  }),
  makeHistogramProvider({
    name: EXTERNAL_LOOKUP_DURATION_SECONDS,
    help: 'Duration of a single external property lookup attempt in seconds',
    buckets: EXTERNAL_LOOKUP_DURATION_BUCKETS,
  }),
  makeCounterProvider({
    name: EXTERNAL_LOOKUP_TOTAL,
    help: 'Total number of external lookups by terminal status',
    labelNames: ['status'],
  }),
  makeCounterProvider({
    name: EXTERNAL_LOOKUP_TRIGGERS_TOTAL,
    help: 'Total number of external-lookup enqueue triggers (initial + manual retries)',
  }),
  makeCounterProvider({
    name: OUTBOX_EVENTS_PUBLISHED_TOTAL,
    help: 'Total number of outbox events published to the queue by the relay',
  }),
  makeGaugeProvider({
    name: BULLMQ_QUEUE_DEPTH,
    help: 'Current number of jobs waiting in the external-lookup BullMQ queue',
  }),
];
