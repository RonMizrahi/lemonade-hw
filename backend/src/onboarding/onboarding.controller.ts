import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ErrorResponseDto } from '../common/filters/error-response.dto';
import { CompleteSessionDto, EditAnswerDto, SessionStateDto, SubmitAnswerDto } from './contract';
import { OnboardingService } from './onboarding.service';

const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/**
 * HTTP surface for the onboarding flow (spec §6). Pure dispatch: validate input, extract
 * headers, delegate to {@link OnboardingService}, return its result. No business logic here.
 */
@ApiTags('onboarding')
@Controller('onboarding/sessions')
export class OnboardingController {
  constructor(private readonly service: OnboardingService) {}

  /**
   * Starts a new onboarding session.
   * @returns the initial session state (first question)
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start a session', description: 'Creates a new onboarding session.' })
  @ApiResponse({ status: 201, description: 'Session created', type: SessionStateDto })
  startSession(): Promise<SessionStateDto> {
    return this.service.startSession();
  }

  /**
   * Fetches a session's current state (the polling target).
   * @param id the session id
   * @returns the full session state
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get session state', description: 'Polling target for the client.' })
  @ApiParam({ name: 'id', description: 'Session id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Current session state', type: SessionStateDto })
  @ApiResponse({ status: 404, description: 'Session not found', type: ErrorResponseDto })
  getState(@Param('id', ParseUUIDPipe) id: string): Promise<SessionStateDto> {
    return this.service.getState(id);
  }

  /**
   * Submits an answer to the current question.
   * @param id the session id
   * @param idempotencyKey the required `Idempotency-Key` header
   * @param dto the answer body
   * @returns the recalculated session state
   */
  @Post(':id/answers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit an answer',
    description: 'Submits the current answer. Idempotent via the Idempotency-Key header.',
  })
  @ApiParam({ name: 'id', description: 'Session id', format: 'uuid' })
  @ApiHeader({ name: IDEMPOTENCY_HEADER, description: 'Idempotency key', required: true })
  @ApiBody({ type: SubmitAnswerDto })
  @ApiResponse({ status: 200, description: 'Answer recorded', type: SessionStateDto })
  @ApiResponse({ status: 400, description: 'Validation error', type: ErrorResponseDto })
  @ApiResponse({
    status: 409,
    description: 'Stale version / not current question',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 422,
    description: 'Idempotency-Key reuse with different body',
    type: ErrorResponseDto,
  })
  submitAnswer(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey: string | undefined,
    @Body() dto: SubmitAnswerDto,
  ): Promise<SessionStateDto> {
    const key = this.requireIdempotencyKey(idempotencyKey);
    return this.service.submitAnswer(id, dto.questionId, dto.value, dto.expectedVersion, {
      idempotencyKey: key,
    });
  }

  /**
   * Edits a previously-answered question, recalculating the flow.
   * @param id the session id
   * @param questionId the question being edited
   * @param dto the edit body
   * @returns the recalculated session state
   */
  @Put(':id/answers/:questionId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Edit a prior answer',
    description: 'Edits an answer and recalculates the flow (branch/skip/irrelevant).',
  })
  @ApiParam({ name: 'id', description: 'Session id', format: 'uuid' })
  @ApiParam({ name: 'questionId', description: 'Question id being edited' })
  @ApiBody({ type: EditAnswerDto })
  @ApiResponse({ status: 200, description: 'Answer edited', type: SessionStateDto })
  @ApiResponse({ status: 400, description: 'Validation error', type: ErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Question not answered', type: ErrorResponseDto })
  @ApiResponse({ status: 409, description: 'Stale version', type: ErrorResponseDto })
  editAnswer(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('questionId') questionId: string,
    @Body() dto: EditAnswerDto,
  ): Promise<SessionStateDto> {
    return this.service.editAnswer(id, questionId, dto.value, dto.expectedVersion);
  }

  /**
   * Retries a failed external lookup.
   * @param id the session id
   * @param idempotencyKey the required `Idempotency-Key` header
   * @returns the session state with the re-enqueued lookup
   */
  @Post(':id/external-lookup/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Retry a failed lookup',
    description: 'Re-enqueues a failed external lookup. Idempotent via the Idempotency-Key header.',
  })
  @ApiParam({ name: 'id', description: 'Session id', format: 'uuid' })
  @ApiHeader({ name: IDEMPOTENCY_HEADER, description: 'Idempotency key', required: true })
  @ApiResponse({ status: 202, description: 'Lookup re-enqueued', type: SessionStateDto })
  @ApiResponse({
    status: 409,
    description: 'Not in failed state / max triggers reached',
    type: ErrorResponseDto,
  })
  retryLookup(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers(IDEMPOTENCY_HEADER) idempotencyKey: string | undefined,
  ): Promise<SessionStateDto> {
    const key = this.requireIdempotencyKey(idempotencyKey);
    return this.service.retryLookup(id, { idempotencyKey: key });
  }

  /**
   * Completes a session.
   * @param id the session id
   * @param dto the complete body
   * @returns the completed session state with summary
   */
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete a session',
    description: 'Completes the session once all requirements and the lookup are terminal.',
  })
  @ApiParam({ name: 'id', description: 'Session id', format: 'uuid' })
  @ApiBody({ type: CompleteSessionDto })
  @ApiResponse({ status: 200, description: 'Session completed', type: SessionStateDto })
  @ApiResponse({
    status: 409,
    description: 'Requirements unmet / lookup not terminal / stale',
    type: ErrorResponseDto,
  })
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteSessionDto,
  ): Promise<SessionStateDto> {
    return this.service.complete(id, dto.expectedVersion);
  }

  /**
   * Ensures the `Idempotency-Key` header is present.
   * @param key the raw header value
   * @returns the non-empty key
   * @throws BadRequestException when the header is missing or blank
   */
  private requireIdempotencyKey(key: string | undefined): string {
    if (!key || key.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return key;
  }
}
