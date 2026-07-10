import type { IncomingMessage } from 'node:http';
import { CORRELATION_ID_HEADER } from '../logging/logger.config';

/**
 * Extracts the per-request correlation id so it can be propagated into queue job data
 * (spec §7, §11: worker logs correlate back to the originating HTTP request). Reads the id
 * pino assigned to `req.id` (via `genReqId`), falling back to the incoming header.
 *
 * The actual enqueue lives in M4; passing the returned value into `ExternalLookupJobData`
 * is what carries the correlation id to the worker.
 * @param req the incoming HTTP request
 * @returns the correlation id, or undefined if none is present
 */
export function getCorrelationId(req: IncomingMessage): string | undefined {
  const assigned: unknown = Reflect.get(req, 'id');
  if (typeof assigned === 'string' && assigned.length > 0) {
    return assigned;
  }
  const header = req.headers[CORRELATION_ID_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
