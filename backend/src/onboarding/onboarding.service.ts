import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  NotImplementedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ExternalLookupStatus } from '../common/enums';
import { ExternalLookup, IdempotencyKey } from '../database/entities';
import { LookupTriggerService } from '../async-lookup/lookup-trigger.service';
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

/** HTTP status stored for a retry idempotency replay (202 Accepted, spec §6). */
const RETRY_STATUS_CODE = 202;

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
    private readonly lookupTrigger: LookupTriggerService,
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
   * Manually retries a failed external lookup (idempotent, spec §6, §7 stage 4). Allowed only
   * when the lookup is `failed` and the trigger budget is not spent; re-runs the trigger
   * machinery (new outbox event, same generation). Replays return the stored state.
   * @param sessionId the session id
   * @param context the idempotency context (the `Idempotency-Key` header)
   * @returns the session state with the re-enqueued lookup
   * @throws NotFoundException when the session or lookup does not exist
   * @throws ConflictException when the lookup is not `failed` or `max_triggers` is reached
   * @throws UnprocessableEntityException on `Idempotency-Key` reuse with a different request
   */
  async retryLookup(sessionId: string, context: WriteContext): Promise<SessionStateDto> {
    const requestHash = this.hashRetryRequest(sessionId);
    return this.dataSource.transaction(async (manager) => {
      const replay = await this.replayIfPresent(manager, context.idempotencyKey, requestHash);
      if (replay) {
        return replay;
      }

      const session = await this.sessions.findById(sessionId, manager);
      if (!session) {
        throw new NotFoundException('Session not found');
      }

      const lookup = await this.lookups.findBySession(sessionId, manager);
      this.assertRetryable(lookup);

      await this.lookupTrigger.trigger(manager, sessionId, false);

      const state = await this.buildState(manager, sessionId);
      await this.storeIdempotency(manager, context.idempotencyKey, sessionId, requestHash, state);
      return state;
    });
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

  /**
   * Asserts a lookup may be manually retried: it must exist, be `failed`, and have budget.
   * @param lookup the session's lookup row, or null if none exists
   * @throws NotFoundException when no lookup exists for the session
   * @throws ConflictException when not in `failed` state or `max_triggers` is reached
   */
  private assertRetryable(lookup: ExternalLookup | null): void {
    if (!lookup) {
      throw new NotFoundException('No external lookup for this session');
    }
    if (lookup.status !== ExternalLookupStatus.Failed) {
      throw new ConflictException('Lookup is not in a retryable (failed) state');
    }
    if (lookup.triggers >= lookup.maxTriggers) {
      throw new ConflictException('Maximum lookup retries reached');
    }
  }

  /**
   * Returns the stored idempotent response for a key, validating the request matches.
   * @param manager the enclosing transaction
   * @param key the `Idempotency-Key` header value
   * @param requestHash the hash of the current request
   * @returns the replayed state, or null when the key is unused
   * @throws UnprocessableEntityException when the key was used for a different request
   */
  private async replayIfPresent(
    manager: EntityManager,
    key: string,
    requestHash: string,
  ): Promise<SessionStateDto | null> {
    const existing = await this.idempotencyKeys.findByKey(key, manager);
    if (!existing) {
      return null;
    }
    if (existing.requestHash !== requestHash) {
      throw new UnprocessableEntityException('Idempotency-Key reused with a different request');
    }
    return this.toSessionState(existing.response);
  }

  /**
   * Persists the idempotency record so replays of this key return the same state.
   * @param manager the enclosing transaction
   * @param key the `Idempotency-Key` header value
   * @param sessionId the owning session id
   * @param requestHash the hash of the current request
   * @param state the response to store for replay
   * @returns resolves once persisted
   */
  private async storeIdempotency(
    manager: EntityManager,
    key: string,
    sessionId: string,
    requestHash: string,
    state: SessionStateDto,
  ): Promise<void> {
    await this.idempotencyKeys.create(
      {
        key,
        sessionId,
        requestHash,
        response: state,
        statusCode: RETRY_STATUS_CODE,
      },
      manager,
    );
  }

  /**
   * Loads the session, its answers, and its lookup, and projects the session state.
   * @param manager the enclosing transaction
   * @param sessionId the session id
   * @returns the assembled session state
   * @throws NotFoundException when the session no longer exists
   */
  private async buildState(manager: EntityManager, sessionId: string): Promise<SessionStateDto> {
    const session = await this.sessions.findById(sessionId, manager);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    const answers = await this.answers.findBySession(sessionId, manager);
    const lookup = await this.lookups.findBySession(sessionId, manager);
    return this.assembler.assemble({ session, answers, lookup });
  }

  /**
   * Hashes the retry request's identity so replays with the same key are validated.
   * @param sessionId the session being retried
   * @returns a stable hash of the retry operation
   */
  private hashRetryRequest(sessionId: string): string {
    return createHash('sha256').update(`POST:retry:${sessionId}`).digest('hex');
  }

  /**
   * Narrows a stored jsonb idempotency response back to the session-state contract.
   * @param stored the persisted response value
   * @returns the session state
   */
  private toSessionState(stored: IdempotencyKey['response']): SessionStateDto {
    return stored as SessionStateDto;
  }
}
