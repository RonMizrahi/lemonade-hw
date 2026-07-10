import { Injectable } from '@nestjs/common';
import { QuestionType } from '../common/enums';
import { FlowEngine } from './flow-engine.interface';
import { AnswerMap, AnswerValidationResult, FlowDefinition, QuestionDef } from './flow.types';

/** A passing validation result — reused so the object isn't re-allocated per call. */
const VALID: AnswerValidationResult = { valid: true, error: null };

/**
 * @param error the error message
 * @returns a failing validation result carrying the message
 */
function invalid(error: string): AnswerValidationResult {
  return { valid: false, error };
}

/**
 * Base type check for a raw answer value against a question type. Business rules
 * (age, coverage-start) live in each question's `validate`, layered on top of this.
 * @param type the declared question type
 * @param value the raw answer value
 * @param choices the allowed choices for a `choice` question
 * @returns an error string when the value doesn't match the type, otherwise null
 */
function checkType(type: QuestionType, value: unknown, choices?: string[]): string | null {
  switch (type) {
    case QuestionType.Text:
      return typeof value === 'string' && value.trim().length > 0
        ? null
        : 'Value must be a non-empty string';
    case QuestionType.Number:
      return typeof value === 'number' && Number.isFinite(value)
        ? null
        : 'Value must be a finite number';
    case QuestionType.Boolean:
      return typeof value === 'boolean' ? null : 'Value must be a boolean';
    case QuestionType.Date:
      return isCalendarDateString(value) ? null : 'Value must be a valid YYYY-MM-DD date';
    case QuestionType.Choice:
      return typeof value === 'string' && (choices ?? []).includes(value)
        ? null
        : `Value must be one of: ${(choices ?? []).join(', ')}`;
    case QuestionType.Address:
      return isAddress(value) ? null : 'Value must be an address with a street and city';
  }
}

/**
 * Structural check for an `address` answer: an object carrying non-empty `street` and `city`.
 * @param value the raw answer value
 * @returns true when the value is a well-formed address
 */
function isAddress(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record: Record<string, unknown> = { ...value };
  return isNonEmptyString(record.street) && isNonEmptyString(record.city);
}

/**
 * @param value a candidate value
 * @returns true when the value is a non-empty (trimmed) string
 */
function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Type check for a date answer: a `YYYY-MM-DD` string denoting a real calendar day (rejecting
 * overflow like month 13 that `Date` silently rolls forward). Matches the format the flow's
 * date business rules parse, so the base check and the rule agree on what's a valid date.
 * @param value the raw answer value
 * @returns true when the value is a well-formed calendar date string
 */
function isCalendarDateString(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * The pure predicate flow engine (spec §4). Zero I/O: visibility, current-question
 * selection, answer validation, reconciliation, and completion all derive from the
 * declarative {@link FlowDefinition} and the current answer map.
 */
@Injectable()
export class FlowEngineService implements FlowEngine {
  /**
   * @param flow the active flow definition
   * @param answers the current answer map
   * @returns the questions whose `visibleWhen` predicate holds (undefined ⇒ always visible)
   */
  visibleQuestions(flow: FlowDefinition, answers: AnswerMap): QuestionDef[] {
    return flow.questions.filter((question) => this.isVisible(question, answers));
  }

  /**
   * @param flow the active flow definition
   * @param answers the current answer map
   * @returns the first visible & unanswered question in presentation order, or null
   */
  currentQuestion(flow: FlowDefinition, answers: AnswerMap): QuestionDef | null {
    return (
      flow.questions.find(
        (question) => this.isVisible(question, answers) && !this.isAnswered(question, answers),
      ) ?? null
    );
  }

  /**
   * Validates a proposed answer: the question must exist and be visible, the value must
   * satisfy the base type check, then the question's own business rule (spec §4).
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
  ): AnswerValidationResult {
    const question = flow.questions.find((candidate) => candidate.id === questionId);
    if (!question) {
      return invalid(`Unknown question: ${questionId}`);
    }
    if (!this.isVisible(question, answers)) {
      return invalid(`Question is not currently visible: ${questionId}`);
    }

    const typeError = checkType(question.type, value, question.choices);
    if (typeError) {
      return invalid(typeError);
    }

    const ruleError = question.validate ? question.validate(value, answers) : null;
    return ruleError ? invalid(ruleError) : VALID;
  }

  /**
   * @param flow the active flow definition
   * @param answers the current answer map
   * @returns the ids of stored answers whose question is no longer visible (spec §8)
   */
  reconcile(flow: FlowDefinition, answers: AnswerMap): string[] {
    const visibleIds = new Set(this.visibleQuestions(flow, answers).map((question) => question.id));
    return Object.keys(answers).filter((id) => !visibleIds.has(id));
  }

  /**
   * @param flow the active flow definition
   * @param answers the current answer map
   * @returns the ids of required, visible questions still unanswered (spec §4, §9)
   */
  completionChecklist(flow: FlowDefinition, answers: AnswerMap): string[] {
    return this.visibleQuestions(flow, answers)
      .filter((question) => question.required && !this.isAnswered(question, answers))
      .map((question) => question.id);
  }

  /**
   * @param question a flow question
   * @param answers the current answer map
   * @returns whether the question is visible under the current answers
   */
  private isVisible(question: QuestionDef, answers: AnswerMap): boolean {
    return question.visibleWhen ? question.visibleWhen(answers) : true;
  }

  /**
   * @param question a flow question
   * @param answers the current answer map
   * @returns whether an answer is present for the question
   */
  private isAnswered(question: QuestionDef, answers: AnswerMap): boolean {
    return question.id in answers;
  }
}
