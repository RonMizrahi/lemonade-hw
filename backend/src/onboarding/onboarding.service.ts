import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AnswerStatus, ExternalLookupStatus, SessionStatus } from '../common/enums';
import {
  Answer,
  ExternalLookup,
  IdempotencyKey,
  OnboardingSession,
  SessionSummary,
} from '../database/entities';
import { ACTIVE_FLOW_VERSION, FLOW_DEFINITION } from '../flow-engine/flow-definition';
import { FLOW_ENGINE, FlowEngine } from '../flow-engine/flow-engine.interface';
import { AnswerMap } from '../flow-engine/flow.types';
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
import { SummaryBuilder } from './summary-builder';
import { SessionStateDto } from './contract';

/**
 * Context for an idempotent, optimistically-locked write (submit/retry).
 */
export interface WriteContext {
  idempotencyKey: string;
}

/** HTTP status stored for a retry idempotency replay (202 Accepted, spec §6). */
const RETRY_STATUS_CODE = 202;

/** HTTP status stored for a submit idempotency replay (200 OK, spec §6). */
const SUBMIT_STATUS_CODE = 200;

/** The address question whose answer fires the external property lookup (spec §3, §7). */
const ADDRESS_QUESTION_ID = 'property_address';

/**
 * Orchestrates the onboarding use-cases (start, get-state, submit, edit, retry, complete),
 * coordinating the FlowEngine, repositories, OutboxWriter, and transactions (spec §2).
 *
 * The answer-flow use-cases (M3) run each write in ONE transaction: optimistic-lock check,
 * FlowEngine validation, answer upsert, the transactional lookup trigger on the address
 * answer (spec §7 stage 1), a version bump, and idempotent replay for POST submit (spec §6).
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
    private readonly summaryBuilder: SummaryBuilder,
    private readonly lookupTrigger: LookupTriggerService,
    @Inject(FLOW_ENGINE) private readonly flowEngine: FlowEngine,
  ) {}

  /**
   * Starts a new session pinned to the active flow version (spec §6).
   * @returns the initial session state (first question)
   * @throws NotFoundException when the active flow version is not registered (run the seed)
   */
  async startSession(): Promise<SessionStateDto> {
    return this.dataSource.transaction(async (manager) => {
      const flowVersion = await this.flowVersions.findByVersion(ACTIVE_FLOW_VERSION, manager);
      if (!flowVersion) {
        throw new NotFoundException('Active flow version is not registered');
      }
      const session = await this.sessions.create(
        { status: SessionStatus.InProgress, flowVersionId: flowVersion.id },
        manager,
      );
      return this.buildState(manager, session.id);
    });
  }

  /**
   * Fetches the current session state (polling target, spec §6).
   * @param sessionId the session id
   * @returns the session state
   * @throws NotFoundException when the session does not exist
   */
  async getState(sessionId: string): Promise<SessionStateDto> {
    const session = await this.sessions.findById(sessionId);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    const answers = await this.answers.findBySession(sessionId);
    const lookup = await this.lookups.findBySession(sessionId);
    return this.assembler.assemble({ session, answers, lookup });
  }

  /**
   * Submits an answer to the current question (idempotent, optimistically locked, spec §6, §7).
   * In one transaction: replay guard, version check, FlowEngine validation, current-question
   * enforcement, answer upsert, the transactional address trigger, and a version bump.
   * @param sessionId the session id
   * @param questionId the question being answered
   * @param value the answer value
   * @param expectedVersion the client's last-observed version
   * @param context the idempotency context (the `Idempotency-Key` header)
   * @returns the recalculated session state
   * @throws NotFoundException when the session does not exist
   * @throws BadRequestException when the value is invalid for the question
   * @throws ConflictException on a stale version or a non-current question
   * @throws UnprocessableEntityException on `Idempotency-Key` reuse with a different request
   */
  async submitAnswer(
    sessionId: string,
    questionId: string,
    value: unknown,
    expectedVersion: number,
    context: WriteContext,
  ): Promise<SessionStateDto> {
    const requestHash = this.hashSubmitRequest(sessionId, questionId, value, expectedVersion);
    return this.runIdempotent(context.idempotencyKey, requestHash, async (manager) => {
      const replay = await this.replayIfPresent(manager, context.idempotencyKey, requestHash);
      if (replay) {
        return replay;
      }

      const session = await this.loadSessionForWrite(manager, sessionId, expectedVersion);
      const answerMap = await this.activeAnswerMap(manager, sessionId);

      this.assertCurrentQuestion(answerMap, questionId);
      this.assertValid(questionId, value, answerMap);

      await this.upsertAnswer(manager, sessionId, questionId, value);
      if (questionId === ADDRESS_QUESTION_ID) {
        await this.lookupTrigger.trigger(manager, sessionId, true);
      }
      await this.bumpVersion(manager, session);

      const state = await this.buildState(manager, sessionId);
      await this.storeIdempotency(
        manager,
        context.idempotencyKey,
        sessionId,
        requestHash,
        state,
        SUBMIT_STATUS_CODE,
      );
      return state;
    });
  }

  /**
   * Edits a prior answer and recalculates the flow (spec §6, §8). In one transaction: version
   * check, FlowEngine validation, answer upsert, reconciliation (marking now-hidden answers
   * `irrelevant`), an address-change re-trigger, and a version bump.
   * @param sessionId the session id
   * @param questionId the question being edited
   * @param value the new answer value
   * @param expectedVersion the client's last-observed version
   * @returns the recalculated session state
   * @throws NotFoundException when the session or the prior answer does not exist
   * @throws BadRequestException when the value is invalid for the question
   * @throws ConflictException on a stale version
   */
  async editAnswer(
    sessionId: string,
    questionId: string,
    value: unknown,
    expectedVersion: number,
  ): Promise<SessionStateDto> {
    return this.dataSource.transaction(async (manager) => {
      const session = await this.loadSessionForWrite(manager, sessionId, expectedVersion);

      const existing = await this.answers.findByQuestion(sessionId, questionId, manager);
      if (!existing || existing.status !== AnswerStatus.Active) {
        throw new NotFoundException(`Question was not answered: ${questionId}`);
      }

      const answerMap = await this.activeAnswerMap(manager, sessionId);
      this.assertValid(questionId, value, answerMap);

      const addressChanged =
        questionId === ADDRESS_QUESTION_ID && !this.sameValue(existing.value, value);

      await this.upsertAnswer(manager, sessionId, questionId, value);
      await this.reconcileIrrelevant(manager, sessionId);
      if (addressChanged) {
        await this.lookupTrigger.trigger(manager, sessionId, true);
      }
      await this.bumpVersion(manager, session);

      return this.buildState(manager, sessionId);
    });
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
    return this.runIdempotent(context.idempotencyKey, requestHash, async (manager) => {
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
      await this.storeIdempotency(
        manager,
        context.idempotencyKey,
        sessionId,
        requestHash,
        state,
        RETRY_STATUS_CODE,
      );
      return state;
    });
  }

  /**
   * Completes the session once all gates pass, building the normalized summary (spec §6, §9).
   * In one transaction: idempotent short-circuit for an already-completed session, version
   * check, completion gates (all required visible questions answered + the lookup terminal),
   * summary build+persist, and the terminal `status`/`completed_at` transition.
   * @param sessionId the session id
   * @param expectedVersion the client's last-observed version
   * @returns the completed session state with summary
   * @throws NotFoundException when the session does not exist
   * @throws ConflictException on a stale version, unmet requirements, or a non-terminal lookup
   */
  async complete(sessionId: string, expectedVersion: number): Promise<SessionStateDto> {
    return this.dataSource.transaction(async (manager) => {
      const session = await this.sessions.findById(sessionId, manager);
      if (!session) {
        throw new NotFoundException('Session not found');
      }
      if (session.status === SessionStatus.Completed) {
        return this.buildState(manager, sessionId);
      }
      if (session.version !== expectedVersion) {
        throw new ConflictException('expectedVersion is stale');
      }

      const answers = await this.answers.findBySession(sessionId, manager);
      const lookup = await this.lookups.findBySession(sessionId, manager);
      this.assertCompletable(answers, lookup);

      const summary = this.summaryBuilder.build(answers, lookup);
      await this.markCompleted(manager, session, summary);

      return this.buildState(manager, sessionId);
    });
  }

  /**
   * Persists the terminal completion transition with an optimistic-lock guard: one conditional
   * UPDATE sets `summary`/`status`/`completed_at` and bumps the version, keyed on `id AND
   * version`. A zero-row result means a concurrent write moved the version between the read and
   * here (a rival completion or edit), so completion is rejected rather than clobbering it.
   * @param manager the enclosing transaction
   * @param session the session whose version was validated against `expectedVersion`
   * @param summary the normalized summary to persist
   * @returns resolves once the completion is committed
   * @throws ConflictException when the guarded update matched no row (concurrent write)
   */
  private async markCompleted(
    manager: EntityManager,
    session: OnboardingSession,
    summary: SessionSummary,
  ): Promise<void> {
    const result = await manager
      .getRepository(OnboardingSession)
      .createQueryBuilder()
      .update(OnboardingSession)
      .set({
        // The jsonb summary is opaque to TypeORM's deep-partial (its `unknown` values don't
        // satisfy the mapped type); a JSON string literal is the sanctioned ORM-type escape,
        // cast at the DB boundary via `::jsonb` so Postgres stores it as structured data.
        summary: () => ':summary::jsonb',
        status: SessionStatus.Completed,
        completedAt: () => 'now()',
        version: () => 'version + 1',
      })
      .where('id = :id AND version = :version', { id: session.id, version: session.version })
      .setParameters({ summary: JSON.stringify(summary) })
      .execute();
    if (result.affected === 0) {
      throw new ConflictException('expectedVersion is stale');
    }
  }

  /**
   * Asserts the completion gates (spec §9): every required visible question has an active
   * answer, and the external lookup is terminal (`completed` or `permanently_failed`).
   * @param answers all stored answers for the session
   * @param lookup the session's lookup row, or null if never triggered
   * @throws ConflictException when a required answer is missing or the lookup is not terminal
   */
  private assertCompletable(answers: Answer[], lookup: ExternalLookup | null): void {
    const answerMap = this.toActiveAnswerMap(answers);
    const missingRequired = this.flowEngine.completionChecklist(FLOW_DEFINITION, answerMap);
    if (missingRequired.length > 0) {
      throw new ConflictException(`Required questions unanswered: ${missingRequired.join(', ')}`);
    }
    if (!this.isLookupTerminal(lookup)) {
      throw new ConflictException('External lookup has not resolved');
    }
  }

  /**
   * Whether the external lookup has reached a completion-unblocking terminal state (spec §9).
   * @param lookup the session's lookup row, or null if never triggered
   * @returns true when the lookup is `completed` or `permanently_failed`
   */
  private isLookupTerminal(lookup: ExternalLookup | null): boolean {
    return (
      lookup?.status === ExternalLookupStatus.Completed ||
      lookup?.status === ExternalLookupStatus.PermanentlyFailed
    );
  }

  /**
   * Loads the session under the transaction and asserts its version matches the caller's.
   * @param manager the enclosing transaction
   * @param sessionId the session id
   * @param expectedVersion the client's last-observed version
   * @returns the loaded session
   * @throws NotFoundException when the session does not exist
   * @throws ConflictException when the stored version differs (a concurrent write landed first)
   */
  private async loadSessionForWrite(
    manager: EntityManager,
    sessionId: string,
    expectedVersion: number,
  ): Promise<OnboardingSession> {
    const session = await this.sessions.findById(sessionId, manager);
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    if (session.version !== expectedVersion) {
      throw new ConflictException('expectedVersion is stale');
    }
    return session;
  }

  /**
   * Bumps the session's optimistic-lock version with a guarded conditional update; a zero-row
   * result means a concurrent write moved the version between the read and here (spec §6).
   * @param manager the enclosing transaction
   * @param session the session whose version was validated against `expectedVersion`
   * @returns resolves once the version is bumped
   * @throws ConflictException when the guarded update matched no row (concurrent write)
   */
  private async bumpVersion(manager: EntityManager, session: OnboardingSession): Promise<void> {
    const result = await manager
      .getRepository(OnboardingSession)
      .createQueryBuilder()
      .update(OnboardingSession)
      .set({ version: () => 'version + 1' })
      .where('id = :id AND version = :version', { id: session.id, version: session.version })
      .execute();
    if (result.affected === 0) {
      throw new ConflictException('expectedVersion is stale');
    }
  }

  /**
   * Asserts the question being answered is the session's current (first visible & unanswered).
   * @param answerMap the current active answer map
   * @param questionId the question the client is answering
   * @throws ConflictException when it is not the current question (out-of-order submit)
   */
  private assertCurrentQuestion(answerMap: AnswerMap, questionId: string): void {
    const current = this.flowEngine.currentQuestion(FLOW_DEFINITION, answerMap);
    if (!current || current.id !== questionId) {
      throw new ConflictException(`Not the current question: ${questionId}`);
    }
  }

  /**
   * Runs the FlowEngine validation for a proposed answer value.
   * @param questionId the question being answered
   * @param value the proposed value
   * @param answerMap the current active answer map (excluding this write)
   * @throws BadRequestException when the value is invalid for the question
   */
  private assertValid(questionId: string, value: unknown, answerMap: AnswerMap): void {
    const result = this.flowEngine.validateAnswer(FLOW_DEFINITION, questionId, value, answerMap);
    if (!result.valid) {
      throw new BadRequestException(result.error ?? 'Invalid answer');
    }
  }

  /**
   * Upserts an answer (active), keyed on (session, question). Reactivates an `irrelevant` row.
   * @param manager the enclosing transaction
   * @param sessionId the owning session id
   * @param questionId the question id
   * @param value the answer value
   * @returns resolves once persisted
   */
  private async upsertAnswer(
    manager: EntityManager,
    sessionId: string,
    questionId: string,
    value: unknown,
  ): Promise<void> {
    const existing = await this.answers.findByQuestion(sessionId, questionId, manager);
    if (existing) {
      existing.value = value;
      existing.status = AnswerStatus.Active;
      await this.answers.save(existing, manager);
      return;
    }
    await this.answers.create(
      { sessionId, questionId, value, status: AnswerStatus.Active },
      manager,
    );
  }

  /**
   * Marks any active answers now hidden by the current answer set as `irrelevant` (spec §8).
   * @param manager the enclosing transaction
   * @param sessionId the owning session id
   * @returns resolves once all now-hidden answers are soft-marked
   */
  private async reconcileIrrelevant(manager: EntityManager, sessionId: string): Promise<void> {
    const answers = await this.answers.findBySession(sessionId, manager);
    const answerMap = this.toActiveAnswerMap(answers);
    const irrelevantIds = new Set(this.flowEngine.reconcile(FLOW_DEFINITION, answerMap));
    for (const answer of answers) {
      if (answer.status === AnswerStatus.Active && irrelevantIds.has(answer.questionId)) {
        answer.status = AnswerStatus.Irrelevant;
        await this.answers.save(answer, manager);
      }
    }
  }

  /**
   * Loads the session's active answers as a FlowEngine answer map.
   * @param manager the enclosing transaction
   * @param sessionId the owning session id
   * @returns questionId → value map of active answers
   */
  private async activeAnswerMap(manager: EntityManager, sessionId: string): Promise<AnswerMap> {
    const answers = await this.answers.findBySession(sessionId, manager);
    return this.toActiveAnswerMap(answers);
  }

  /**
   * Projects active answers into a FlowEngine answer map (irrelevant answers excluded).
   * @param answers all stored answers for the session
   * @returns questionId → value map of active answers
   */
  private toActiveAnswerMap(answers: Answer[]): AnswerMap {
    const map: AnswerMap = {};
    for (const answer of answers) {
      if (answer.status === AnswerStatus.Active) {
        map[answer.questionId] = answer.value;
      }
    }
    return map;
  }

  /**
   * Structural equality for two normalized answer values (used to detect an address change).
   * @param a the first value
   * @param b the second value
   * @returns whether the two values are equal by JSON serialization
   */
  private sameValue(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
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
   * @param statusCode the HTTP status the write returned
   * @returns resolves once persisted
   */
  private async storeIdempotency(
    manager: EntityManager,
    key: string,
    sessionId: string,
    requestHash: string,
    state: SessionStateDto,
    statusCode: number,
  ): Promise<void> {
    await this.idempotencyKeys.create(
      {
        key,
        sessionId,
        requestHash,
        response: state,
        statusCode,
      },
      manager,
    );
  }

  /**
   * Runs an idempotent write in a transaction. If a concurrent request with the same
   * `Idempotency-Key` won the unique-constraint race (Postgres 23505), the winner has already
   * committed — including its idempotency row — so replay that stored response instead of
   * surfacing a 500 (spec §6). Any other error is rethrown unchanged.
   * @param key the `Idempotency-Key` header value
   * @param requestHash the hash of the current request
   * @param work the transactional operation to run
   * @returns the operation's state, or the winning request's replayed state on a lost race
   * @throws UnprocessableEntityException when the winning request used the key with a different body
   */
  private async runIdempotent(
    key: string,
    requestHash: string,
    work: (manager: EntityManager) => Promise<SessionStateDto>,
  ): Promise<SessionStateDto> {
    try {
      return await this.dataSource.transaction(work);
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        const existing = await this.idempotencyKeys.findByKey(key);
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new UnprocessableEntityException(
              'Idempotency-Key reused with a different request',
            );
          }
          return this.toSessionState(existing.response);
        }
      }
      throw err;
    }
  }

  /**
   * Detects a Postgres unique-violation (SQLSTATE 23505) surfaced by TypeORM's QueryFailedError.
   * @param err the caught error
   * @returns whether the error is a unique-constraint violation
   */
  private isUniqueViolation(err: unknown): boolean {
    const e = err as { code?: string; driverError?: { code?: string } };
    return e?.code === '23505' || e?.driverError?.code === '23505';
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
   * Hashes a submit request's identity (session, question, value, version) so a replay with the
   * same key + same body returns the stored state, while a different body ⇒ 422 (spec §6).
   * @param sessionId the session being answered
   * @param questionId the question being answered
   * @param value the answer value
   * @param expectedVersion the client's last-observed version
   * @returns a stable hash of the submit operation
   */
  private hashSubmitRequest(
    sessionId: string,
    questionId: string,
    value: unknown,
    expectedVersion: number,
  ): string {
    const body = JSON.stringify({ questionId, value, expectedVersion });
    return createHash('sha256').update(`POST:answers:${sessionId}:${body}`).digest('hex');
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
