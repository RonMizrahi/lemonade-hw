import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';

/**
 * HTTP header carrying the per-request correlation id (propagated into job payloads).
 */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Safely reads the pino-assigned request id off an incoming message.
 * @param req the incoming HTTP request (pino sets `.id` via `genReqId`)
 * @returns the correlation id string, or undefined if not yet assigned
 */
function extractRequestId(req: IncomingMessage): string | undefined {
  const candidate: unknown = Reflect.get(req, 'id');
  return typeof candidate === 'string' ? candidate : undefined;
}

/**
 * Builds the `nestjs-pino` params: structured JSON logs with a per-request correlation
 * id (from the incoming header, or freshly generated), echoed back on the response.
 * @param logLevel the pino log level (from validated config)
 * @returns the LoggerModule params
 */
export function buildLoggerParams(logLevel: string): Params {
  return {
    pinoHttp: {
      level: logLevel,
      genReqId: (req: IncomingMessage, res: ServerResponse): string => {
        const incoming = req.headers[CORRELATION_ID_HEADER];
        const correlationId = Array.isArray(incoming) ? incoming[0] : (incoming ?? randomUUID());
        res.setHeader(CORRELATION_ID_HEADER, correlationId);
        return correlationId;
      },
      customProps: (req: IncomingMessage): Record<string, string> => {
        const id = extractRequestId(req);
        return id ? { correlationId: id } : {};
      },
      autoLogging: true,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
  };
}
