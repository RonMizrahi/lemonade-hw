import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

const MIN_VERSION = 0;

/**
 * Body for submitting an answer to the current question (spec §6).
 * The `Idempotency-Key` header is required and validated in the handler.
 */
export class SubmitAnswerDto {
  @ApiProperty({ description: 'The question being answered', example: 'residence_type' })
  @IsString()
  @IsNotEmpty()
  questionId!: string;

  @ApiProperty({
    description: 'The answer value (type depends on the question)',
    example: 'own',
  })
  @IsDefined()
  value!: unknown;

  @ApiProperty({
    description: 'The version the client last observed (optimistic lock)',
    example: 3,
  })
  @IsInt()
  @Min(MIN_VERSION)
  expectedVersion!: number;
}

/**
 * Body for editing a previously-answered question (spec §6, §8). The question id comes
 * from the route; only the new value and expected version are in the body.
 */
export class EditAnswerDto {
  @ApiProperty({
    description: 'The new answer value (type depends on the question)',
    example: 'rent',
  })
  @IsDefined()
  value!: unknown;

  @ApiProperty({
    description: 'The version the client last observed (optimistic lock)',
    example: 4,
  })
  @IsInt()
  @Min(MIN_VERSION)
  expectedVersion!: number;
}

/**
 * Body for completing a session (spec §6, §9). Only the expected version is required.
 */
export class CompleteSessionDto {
  @ApiProperty({
    description: 'The version the client last observed (optimistic lock)',
    example: 9,
  })
  @IsInt()
  @Min(MIN_VERSION)
  expectedVersion!: number;
}
