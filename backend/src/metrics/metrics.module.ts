import { Module } from '@nestjs/common';

/**
 * Observability module (spec §11). Empty in M1 — M6 registers the Prometheus module,
 * the `/metrics` endpoint, and the metric series (histograms + counters).
 */
@Module({})
export class MetricsModule {}
