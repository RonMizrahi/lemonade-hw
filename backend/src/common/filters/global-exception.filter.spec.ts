import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ErrorResponseDto } from './error-response.dto';
import { GlobalExceptionFilter } from './global-exception.filter';

interface CapturedResponse {
  statusCode: number;
  body: ErrorResponseDto;
}

/**
 * Builds a minimal ArgumentsHost whose response captures the status + JSON body.
 */
function buildHost(captured: CapturedResponse): ArgumentsHost {
  const response = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(payload: ErrorResponseDto) {
      captured.body = payload;
      return this;
    },
  };
  const request = { method: 'POST', url: '/onboarding/sessions' };
  const host = {
    switchToHttp: () => ({
      getResponse: <T>() => response as unknown as T,
      getRequest: <T>() => request as unknown as T,
    }),
  };
  return host as unknown as ArgumentsHost;
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let captured: CapturedResponse;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    captured = { statusCode: 0, body: { statusCode: 0, error: '', message: '' } };
  });

  it('maps a NotFoundException to the error envelope', () => {
    filter.catch(new NotFoundException('Session not found'), buildHost(captured));

    expect(captured.statusCode).toBe(HttpStatus.NOT_FOUND);
    expect(captured.body).toEqual({
      statusCode: HttpStatus.NOT_FOUND,
      error: 'Not Found',
      message: 'Session not found',
    });
  });

  it('maps a ConflictException to the error envelope', () => {
    filter.catch(new ConflictException('expectedVersion is stale'), buildHost(captured));

    expect(captured.statusCode).toBe(HttpStatus.CONFLICT);
    expect(captured.body.error).toBe('Conflict');
    expect(captured.body.message).toBe('expectedVersion is stale');
    expect(captured.body.details).toBeUndefined();
  });

  it('surfaces validation-error arrays as details', () => {
    filter.catch(
      new BadRequestException(['questionId should not be empty', 'value must be defined']),
      buildHost(captured),
    );

    expect(captured.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(captured.body.message).toBe('Validation failed');
    expect(captured.body.details).toEqual([
      'questionId should not be empty',
      'value must be defined',
    ]);
  });

  it('maps an unknown thrown value to a 500 envelope', () => {
    filter.catch(new Error('boom'), buildHost(captured));

    expect(captured.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body).toEqual({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Internal server error',
    });
  });

  it('handles a string-payload HttpException', () => {
    filter.catch(new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT), buildHost(captured));

    expect(captured.statusCode).toBe(HttpStatus.I_AM_A_TEAPOT);
    expect(captured.body.message).toBe('teapot');
  });
});
