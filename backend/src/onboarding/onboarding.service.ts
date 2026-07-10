import { Injectable, NotImplementedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AnswerRepository,
  ExternalLookupRepository,
  FlowVersionRepository,
  IdempotencyKeyRepository,
  OnboardingSessionRepository,
  OutboxEventRepository,
} from './repositories';
import { OutboxWriter } from './outbox/outbox-writer';
import { SessionStateAssembler } from './session-state.assembler';
import { SessionStateDto } from './contract';

/**
 * Context for an idempotent, optimistically-locked write (submit/retry).
 */
export interface WriteContext {
  idempotencyKey: string;
}

/**
 * Orchestrates the onboarding use-cases (start, get-state, submit, edit, retry, complete),
 * coordinating the FlowEngine, repositories, OutboxWriter, and transactions (spec §2).
 *
 * M1 wires every dependency but leaves the use-case bodies as `NotImplementedException`
 * stubs — the answer-flow (M3), async (M4), and completion (M5) milestones fill them in.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sessions: OnboardingSessionRepository,
    private readonly answers: AnswerRepository,
    private readonly flowVersions: FlowVersionRepository,
    private readonly lookups: ExternalLookupRepository,
    private readonly outboxEvents: OutboxEventRepository,
    private readonly idempotencyKeys: IdempotencyKeyRepository,
    private readonly outboxWriter: OutboxWriter,
    private readonly assembler: SessionStateAssembler,
  ) {}

  /**
   * Starts a new session pinned to the active flow version (spec §6).
   * @returns the initial session state
   * @throws NotImplementedException until implemented in M3
   */
  async startSession(): Promise<SessionStateDto> {
    throw new NotImplementedException('startSession is implemented in M3');
  }

  /**
   * Fetches the current session state (polling target, spec §6).
   * @param sessionId the session id
   * @returns the session state
   * @throws NotImplementedException until implemented in M3
   */
  async getState(sessionId: string): Promise<SessionStateDto> {
    void sessionId;
    throw new NotImplementedException('getState is implemented in M3');
  }

  /**
   * Submits an answer to the current question (idempotent, optimistically locked, spec §6).
   * @param sessionId the session id
   * @param questionId the question being answered
   * @param value the answer value
   * @param expectedVersion the client's last-observed version
   * @param context the idempotency context
   * @returns the recalculated session state
   * @throws NotImplementedException until implemented in M3
   */
  async submitAnswer(
    sessionId: string,
    questionId: string,
    value: unknown,
    expectedVersion: number,
    context: WriteContext,
  ): Promise<SessionStateDto> {
    void [sessionId, questionId, value, expectedVersion, context];
    throw new NotImplementedException('submitAnswer is implemented in M3');
  }

  /**
   * Edits a prior answer and recalculates the flow (spec §6, §8).
   * @param sessionId the session id
   * @param questionId the question being edited
   * @param value the new answer value
   * @param expectedVersion the client's last-observed version
   * @returns the recalculated session state
   * @throws NotImplementedException until implemented in M3
   */
  async editAnswer(
    sessionId: string,
    questionId: string,
    value: unknown,
    expectedVersion: number,
  ): Promise<SessionStateDto> {
    void [sessionId, questionId, value, expectedVersion];
    throw new NotImplementedException('editAnswer is implemented in M3');
  }

  /**
   * Manually retries a failed external lookup (idempotent, spec §6, §7).
   * @param sessionId the session id
   * @param context the idempotency context
   * @returns the session state with the re-enqueued lookup
   * @throws NotImplementedException until implemented in M4
   */
  async retryLookup(sessionId: string, context: WriteContext): Promise<SessionStateDto> {
    void [sessionId, context];
    throw new NotImplementedException('retryLookup is implemented in M4');
  }

  /**
   * Completes the session once all gates pass, building the summary (spec §6, §9).
   * @param sessionId the session id
   * @param expectedVersion the client's last-observed version
   * @returns the completed session state with summary
   * @throws NotImplementedException until implemented in M5
   */
  async complete(sessionId: string, expectedVersion: number): Promise<SessionStateDto> {
    void [sessionId, expectedVersion];
    throw new NotImplementedException('complete is implemented in M5');
  }
}
