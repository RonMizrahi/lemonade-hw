import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Histogram } from 'prom-client';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { HTTP_REQUEST_DURATION_SECONDS } from './metrics.constants';

/**
 * Label used for the route when the matched Express route pattern is unavailable.
 */
const UNMATCHED_ROUTE = 'unmatched';

/**
 * Records the `http_request_duration_seconds` histogram for every HTTP request (spec §11).
 * Registered as an `APP_INTERCEPTOR` inside `MetricsModule` so it applies app-wide without
 * editing `AppModule`. Labels by method, matched route pattern (not raw URL, to bound
 * cardinality), and response status code.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(
    @InjectMetric(HTTP_REQUEST_DURATION_SECONDS)
    private readonly histogram: Histogram<string>,
  ) {}

  /**
   * Times the request and observes the histogram when the response finishes, so the recorded
   * status code is the final one the exception filter set (not the pre-error default).
   * @param context the execution context (HTTP only)
   * @param next the downstream handler
   * @returns the untouched response stream
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const endTimer = this.histogram.startTimer();

    // `finish` fires after the response (including any error mapped by the exception filter)
    // is fully written, so `statusCode` reflects the real outcome for both success and error.
    response.once('finish', () => {
      endTimer({
        method: request.method,
        route: this.resolveRoute(request),
        status_code: response.statusCode,
      });
    });

    return next.handle();
  }

  /**
   * Resolves the matched Express route pattern (e.g. `/onboarding/sessions/:id`) so path
   * parameters don't explode label cardinality.
   * @param request the incoming request
   * @returns the route pattern, or `unmatched` when no route matched
   */
  private resolveRoute(request: Request): string {
    const route: unknown = Reflect.get(request, 'route');
    const routePath: unknown =
      route && typeof route === 'object' ? Reflect.get(route, 'path') : undefined;
    if (typeof routePath !== 'string') {
      return UNMATCHED_ROUTE;
    }
    const base = request.baseUrl || '';
    return `${base}${routePath}` || UNMATCHED_ROUTE;
  }
}
