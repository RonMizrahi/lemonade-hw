import { ApiProperty } from '@nestjs/swagger';
import { QuestionType } from '../../common/enums';

/**
 * A single question presented to the customer (spec §6). `choices` is present only for
 * `choice`-typed questions.
 */
export class QuestionDto {
  @ApiProperty({ description: 'Stable question identifier', example: 'residence_type' })
  id!: string;

  @ApiProperty({
    description: 'The value type this question expects',
    enum: QuestionType,
    example: QuestionType.Choice,
  })
  type!: QuestionType;

  @ApiProperty({
    description: 'Allowed values for a choice-typed question',
    required: false,
    type: [String],
    example: ['own', 'rent'],
  })
  choices?: string[];
}
