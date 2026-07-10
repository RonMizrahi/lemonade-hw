import { ApiProperty } from '@nestjs/swagger';

/**
 * The consistent error envelope returned by the global exception filter (spec §6).
 */
export class ErrorResponseDto {
  @ApiProperty({ description: 'HTTP status code', example: 409 })
  statusCode!: number;

  @ApiProperty({ description: 'Short error label (HTTP reason phrase)', example: 'Conflict' })
  error!: string;

  @ApiProperty({
    description: 'Human-readable error message',
    example: 'expectedVersion is stale',
  })
  message!: string;

  @ApiProperty({
    description: 'Optional structured detail (e.g. validation errors)',
    required: false,
    type: 'array',
    items: { type: 'string' },
  })
  details?: unknown;
}
