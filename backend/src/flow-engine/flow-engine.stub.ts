import { Injectable } from '@nestjs/common';
import { FlowEngine } from './flow-engine.interface';
import { AnswerMap, AnswerValidationResult, FlowDefinition, QuestionDef } from './flow.types';

/**
 * Trivial M1 stub of the FlowEngine (spec §4). Treats every question as visible in
 * declaration order and accepts any value. M2 replaces this with the real predicate
 * engine (branching, per-type validation, reconciliation).
 */
@Injectable()
export class StubFlowEngine implements FlowEngine {
  /** @returns all questions that pass their `visibleWhen` predicate (none defined ⇒ all). */
  visibleQuestions(flow: FlowDefinition, answers: AnswerMap): QuestionDef[] {
    return flow.questions.filter((q) => (q.visibleWhen ? q.visibleWhen(answers) : true));
  }

  /** @returns the first visible unanswered question, or null. */
  currentQuestion(flow: FlowDefinition, answers: AnswerMap): QuestionDef | null {
    const visible = this.visibleQuestions(flow, answers);
    return visible.find((q) => !(q.id in answers)) ?? null;
  }

  /** @returns always valid in the stub — real per-type rules land in M2. */
  validateAnswer(
    _flow: FlowDefinition,
    _questionId: string,
    _value: unknown,
    _answers: AnswerMap,
  ): AnswerValidationResult {
    return { valid: true, error: null };
  }

  /** @returns the ids of answers whose question is no longer visible. */
  reconcile(flow: FlowDefinition, answers: AnswerMap): string[] {
    const visibleIds = new Set(this.visibleQuestions(flow, answers).map((q) => q.id));
    return Object.keys(answers).filter((id) => !visibleIds.has(id));
  }

  /** @returns required visible questions still unanswered. */
  completionChecklist(flow: FlowDefinition, answers: AnswerMap): string[] {
    return this.visibleQuestions(flow, answers)
      .filter((q) => q.required && !(q.id in answers))
      .map((q) => q.id);
  }
}
