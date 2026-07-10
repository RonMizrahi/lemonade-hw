import { QuestionType } from '../common/enums';
import { FlowDefinition } from './flow.types';

/**
 * The active flow version number. M2 owns the full 13-question definition (spec §3);
 * this M1 placeholder carries a single always-visible question so the engine seam,
 * assembler, and routes are exercisable end-to-end.
 */
export const ACTIVE_FLOW_VERSION = 1;

/**
 * M1 placeholder flow definition. Replaced by the real 13-question flow in M2.
 */
export const FLOW_DEFINITION: FlowDefinition = {
  version: ACTIVE_FLOW_VERSION,
  questions: [
    {
      id: 'full_name',
      type: QuestionType.Text,
      required: true,
    },
  ],
};
