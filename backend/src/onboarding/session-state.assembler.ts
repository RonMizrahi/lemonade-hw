import { Inject, Injectable } from '@nestjs/common';
import { AnswerStatus, ExternalLookupStatus } from '../common/enums';
import { Answer, ExternalLookup, OnboardingSession } from '../database/entities';
import { FLOW_DEFINITION } from '../flow-engine/flow-definition';
import { FLOW_ENGINE, FlowEngine } from '../flow-engine/flow-engine.interface';
import { AnswerMap, QuestionDef } from '../flow-engine/flow.types';
import {
  AnsweredQuestionDto,
  CompletionStateDto,
  ExternalLookupStateDto,
  QuestionDto,
  SessionStateDto,
} from './contract';

/**
 * Bundle of persisted rows the assembler projects into the session-state contract.
 */
export interface SessionStateInput {
  session: OnboardingSession;
  answers: Answer[];
  lookup: ExternalLookup | null;
}

/**
 * Assembles the frozen session-state contract (spec §6) from persisted data plus the pure
 * FlowEngine (current question, completion checklist). Pure projection — no I/O.
 */
@Injectable()
export class SessionStateAssembler {
  constructor(@Inject(FLOW_ENGINE) private readonly flowEngine: FlowEngine) {}

  /**
   * Projects persisted session data into the session-state DTO.
   * @param input the session, its answers, and its lookup row
   * @returns the full session-state contract object
   */
  assemble(input: SessionStateInput): SessionStateDto {
    const { session, answers, lookup } = input;
    const answerMap = this.toAnswerMap(answers);
    const currentQuestion = this.flowEngine.currentQuestion(FLOW_DEFINITION, answerMap);
    const missingRequired = this.flowEngine.completionChecklist(FLOW_DEFINITION, answerMap);

    return {
      sessionId: session.id,
      status: session.status,
      version: session.version,
      currentQuestion: currentQuestion ? this.toQuestionDto(currentQuestion) : null,
      answeredQuestions: answers.map((answer) => this.toAnsweredQuestionDto(answer)),
      externalLookup: this.toExternalLookupDto(lookup),
      completion: this.toCompletionDto(lookup, missingRequired),
      summary: session.summary,
    };
  }

  /**
   * Builds the FlowEngine answer map from active answers only.
   * @param answers all stored answers
   * @returns questionId → value map of active answers
   */
  private toAnswerMap(answers: Answer[]): AnswerMap {
    const map: AnswerMap = {};
    for (const answer of answers) {
      if (answer.status === AnswerStatus.Active) {
        map[answer.questionId] = answer.value;
      }
    }
    return map;
  }

  /**
   * @param question the flow question definition
   * @returns its client-facing DTO
   */
  private toQuestionDto(question: QuestionDef): QuestionDto {
    return {
      id: question.id,
      type: question.type,
      ...(question.choices ? { choices: question.choices } : {}),
    };
  }

  /**
   * @param answer a stored answer row
   * @returns its client-facing DTO
   */
  private toAnsweredQuestionDto(answer: Answer): AnsweredQuestionDto {
    return { questionId: answer.questionId, value: answer.value, status: answer.status };
  }

  /**
   * @param lookup the lookup row, or null before the address is answered
   * @returns the external-lookup projection (defaults to not_started)
   */
  private toExternalLookupDto(lookup: ExternalLookup | null): ExternalLookupStateDto {
    if (!lookup) {
      return { status: ExternalLookupStatus.NotStarted, attempts: 0, result: null };
    }
    return {
      status: lookup.status,
      attempts: lookup.jobAttempts,
      result: this.toResultRecord(lookup.result),
    };
  }

  /**
   * Normalizes the jsonb lookup result into a plain record or null.
   * @param result the stored lookup result
   * @returns a record, or null when absent
   */
  private toResultRecord(result: unknown): Record<string, unknown> | null {
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      return { ...result };
    }
    return null;
  }

  /**
   * @param lookup the lookup row (for terminal-state gating)
   * @param missingRequired required visible questions still unanswered
   * @returns the completion projection
   */
  private toCompletionDto(
    lookup: ExternalLookup | null,
    missingRequired: string[],
  ): CompletionStateDto {
    const lookupTerminal =
      lookup?.status === ExternalLookupStatus.Completed ||
      lookup?.status === ExternalLookupStatus.PermanentlyFailed;
    const canComplete = missingRequired.length === 0 && lookupTerminal === true;
    return { canComplete, missingRequired };
  }
}
