import { QuestionType } from '../common/enums';

/**
 * Map of questionId → its current answer value. The FlowEngine operates purely over this.
 */
export type AnswerMap = Record<string, unknown>;

/**
 * A declarative question definition (spec §4). Predicates are pure functions of the answer
 * map; `visibleWhen` undefined ⇒ always visible.
 */
export interface QuestionDef {
  id: string;
  type: QuestionType;
  required: boolean;
  choices?: string[];
  /** Pure predicate over the current answer map; undefined ⇒ always visible. */
  visibleWhen?: (answers: AnswerMap) => boolean;
  /** Per-type validation beyond the base type check; returns an error string or null. */
  validate?: (value: unknown, answers: AnswerMap) => string | null;
}

/**
 * A versioned, declarative flow definition (spec §4). Declaration order == presentation order.
 */
export interface FlowDefinition {
  version: number;
  questions: QuestionDef[];
}

/**
 * Result of validating a single answer.
 */
export interface AnswerValidationResult {
  valid: boolean;
  error: string | null;
}
