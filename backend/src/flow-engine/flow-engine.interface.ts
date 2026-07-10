import { AnswerMap, AnswerValidationResult, FlowDefinition, QuestionDef } from './flow.types';

/**
 * DI token for the FlowEngine. A trivial stub is bound in M1; M2 replaces the binding
 * with the real predicate-based implementation.
 */
export const FLOW_ENGINE = Symbol('FLOW_ENGINE');

/**
 * The pure flow engine (spec §4) — zero I/O, 100% unit-testable. Owns visibility,
 * current-question selection, answer validation, reconciliation, and completion checks.
 */
export interface FlowEngine {
  /**
   * @param flow the active flow definition
   * @param answers the current answer map
   * @returns the questions whose `visibleWhen` predicate holds given the answers
   */
  visibleQuestions(flow: FlowDefinition, answers: AnswerMap): QuestionDef[];

  /**
   * @param flow the active flow definition
   * @param answers the current answer map
   * @returns the first visible & unanswered question, or null when none remain
   */
  currentQuestion(flow: FlowDefinition, answers: AnswerMap): QuestionDef | null;

  /**
   * @param flow the active flow definition
   * @param questionId the question being answered
   * @param value the proposed answer value
   * @param answers the current answer map (excluding this write)
   * @returns validity plus an error message when invalid
   */
  validateAnswer(
    flow: FlowDefinition,
    questionId: string,
    value: unknown,
    answers: AnswerMap,
  ): AnswerValidationResult;

  /**
   * @param flow the active flow definition
   * @param answers the current answer map
   * @returns the ids of stored answers that are now irrelevant (no longer visible)
   */
  reconcile(flow: FlowDefinition, answers: AnswerMap): string[];

  /**
   * @param flow the active flow definition
   * @param answers the current answer map
   * @returns the ids of required, visible questions still unanswered
   */
  completionChecklist(flow: FlowDefinition, answers: AnswerMap): string[];
}
