import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { metricProviders } from './metrics.providers';

/**
 * Observability module (spec §11). Registers the Prometheus registry + `/metrics` endpoint,
 * defines every metric series, and wires the HTTP-duration histogram via an app-wide
 * interceptor — provided here (not in `AppModule`) so the whole API is timed without touching
 * `AppModule`. Imported by both the API and worker; each process exposes its own `/metrics`.
 *
 * The metric providers are exported so later milestones can `@InjectMetric(...)` and increment
 * them (answer submissions, lookup outcomes, outbox publishes, queue depth).
 */
@Module({
  imports: [PrometheusModule.register()],
  providers: [...metricProviders, { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor }],
  exports: [...metricProviders],
})
export class MetricsModule {}
