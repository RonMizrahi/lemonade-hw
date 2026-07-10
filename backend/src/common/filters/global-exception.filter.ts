import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { Request, Response } from 'express';
import type { ErrorResponseDto } from './error-response.dto';

/**
 * Shape of a Nest `HttpException` response body when it's an object (not a plain string).
 */
interface HttpExceptionBody {
  statusCode?: number;
  error?: string;
  message?: string | string[];
}

/** Status codes at or above this threshold are server errors and get logged with a stack. */
const SERVER_ERROR_THRESHOLD = 500;

/**
 * Global exception filter: maps every thrown error to the uniform
 * `{ statusCode, error, message, details? }` envelope (spec §6). Validation errors
 * (string arrays) surface as `details`.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  /**
   * Handles any exception and writes the uniform error envelope.
   * @param exception the thrown error (HttpException or unknown)
   * @param host the arguments host providing the HTTP context
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const body = this.buildErrorBody(exception);

    if (body.statusCode >= SERVER_ERROR_THRESHOLD) {
      this.logger.error(
        `${request.method} ${request.url} → ${body.statusCode}: ${body.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(body.statusCode).json(body);
  }

  /**
   * Normalizes any thrown value into the error envelope.
   * @param exception the thrown value
   * @returns the fully-populated error response body
   */
  private buildErrorBody(exception: unknown): ErrorResponseDto {
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: STATUS_CODES[HttpStatus.INTERNAL_SERVER_ERROR] ?? 'Internal Server Error',
      message: 'Internal server error',
    };
  }

  /**
   * Maps a Nest `HttpException` to the error envelope, pulling out validation `details`.
   * @param exception the HttpException instance
   * @returns the populated error response body
   */
  private fromHttpException(exception: HttpException): ErrorResponseDto {
    const statusCode = exception.getStatus();
    const errorLabel = STATUS_CODES[statusCode] ?? 'Error';
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return { statusCode, error: errorLabel, message: payload };
    }

    const objectPayload = toExceptionBody(payload);
    const rawMessage = objectPayload.message;

    if (Array.isArray(rawMessage)) {
      return {
        statusCode,
        error: objectPayload.error ?? errorLabel,
        message: 'Validation failed',
        details: rawMessage,
      };
    }

    return {
      statusCode,
      error: objectPayload.error ?? errorLabel,
      message: rawMessage ?? errorLabel,
    };
  }
}

/**
 * Extracts the recognized fields from a Nest HttpException object response without casting.
 * @param payload the object response body of an HttpException
 * @returns a typed view exposing `error` and `message`
 */
function toExceptionBody(payload: object): HttpExceptionBody {
  const error: unknown = Reflect.get(payload, 'error');
  const message: unknown = Reflect.get(payload, 'message');
  return {
    error: typeof error === 'string' ? error : undefined,
    message: normalizeMessage(message),
  };
}

/**
 * Narrows an unknown exception `message` field to the supported string / string[] shape.
 * @param message the raw message value from the exception body
 * @returns a string, a string array, or undefined
 */
function normalizeMessage(message: unknown): string | string[] | undefined {
  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
    return message;
  }
  return undefined;
}
