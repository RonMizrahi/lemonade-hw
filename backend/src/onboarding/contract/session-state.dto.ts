import { ApiProperty } from '@nestjs/swagger';
import { AnswerStatus, ExternalLookupStatus, SessionStatus } from '../../common/enums';
import { QuestionDto } from './question.dto';

/**
 * One answered question in the session state (spec §6). Only `active` answers count
 * toward completion and the summary; `irrelevant` ones are retained for audit.
 */
export class AnsweredQuestionDto {
  @ApiProperty({ description: 'Question identifier', example: 'full_name' })
  questionId!: string;

  @ApiProperty({ description: 'The normalized answer value', example: 'Jane Doe' })
  value!: unknown;

  @ApiProperty({ description: 'Whether the answer is active or superseded', enum: AnswerStatus })
  status!: AnswerStatus;
}

/**
 * The external-lookup projection surfaced to the client for polling (spec §6, §7).
 */
export class ExternalLookupStateDto {
  @ApiProperty({ description: 'Current lookup status', enum: ExternalLookupStatus })
  status!: ExternalLookupStatus;

  @ApiProperty({ description: 'Number of processing attempts so far', example: 1 })
  attempts!: number;

  @ApiProperty({
    description: 'Resolved property data (or fallback record), null until terminal',
    required: false,
    nullable: true,
    additionalProperties: true,
  })
  result!: Record<string, unknown> | null;
}

/**
 * Completion readiness for the session (spec §6).
 */
export class CompletionStateDto {
  @ApiProperty({ description: 'Whether the session can be completed now', example: false })
  canComplete!: boolean;

  @ApiProperty({
    description: 'Required, visible questions still missing an active answer',
    type: [String],
    example: ['coverage_start_date'],
  })
  missingRequired!: string[];
}

/**
 * The full session state returned by GET and every write (spec §6). The frontend never
 * guesses — it renders directly from this shape and echoes `version` as `expectedVersion`.
 */
export class SessionStateDto {
  @ApiProperty({ description: 'Session identifier (also the bearer token)', format: 'uuid' })
  sessionId!: string;

  @ApiProperty({ description: 'Session lifecycle status', enum: SessionStatus })
  status!: SessionStatus;

  @ApiProperty({
    description: 'Optimistic-lock version; send back as expectedVersion on the next write',
    example: 7,
  })
  version!: number;

  @ApiProperty({
    description: 'The current question to answer, or null when none remain',
    type: QuestionDto,
    nullable: true,
  })
  currentQuestion!: QuestionDto | null;

  @ApiProperty({ description: 'All answers recorded on the session', type: [AnsweredQuestionDto] })
  answeredQuestions!: AnsweredQuestionDto[];

  @ApiProperty({ description: 'External property-lookup projection', type: ExternalLookupStateDto })
  externalLookup!: ExternalLookupStateDto;

  @ApiProperty({ description: 'Completion readiness', type: CompletionStateDto })
  completion!: CompletionStateDto;

  @ApiProperty({
    description: 'Normalized summary, populated on completion',
    required: false,
    nullable: true,
    additionalProperties: true,
  })
  summary!: Record<string, unknown> | null;
}
