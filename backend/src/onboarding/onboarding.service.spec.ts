import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager, UpdateResult } from 'typeorm';
import { AnswerStatus, ExternalLookupStatus, SessionStatus } from '../common/enums';
import { Answer, ExternalLookup, OnboardingSession } from '../database/entities';
import { FlowEngineService } from '../flow-engine/flow-engine.service';
import { LookupTriggerService } from '../async-lookup/lookup-trigger.service';
import { OnboardingService } from './onboarding.service';
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
 * Builds a lookup row in a given state for retry-gating tests.
 */
function buildLookup(overrides: Partial<ExternalLookup> = {}): ExternalLookup {
  const lookup = new ExternalLookup();
  lookup.id = randomUUID();
  lookup.status = ExternalLookupStatus.Failed;
  lookup.triggers = 1;
  lookup.maxTriggers = 3;
  lookup.generation = 1;
  return Object.assign(lookup, overrides);
}

describe('OnboardingService.retryLookup', () => {
  const sessionId = randomUUID();
  const idempotencyKey = randomUUID();
  const session = Object.assign(new OnboardingSession(), {
    id: sessionId,
    status: SessionStatus.InProgress,
    version: 1,
  });

  let sessions: jest.Mocked<Pick<OnboardingSessionRepository, 'findById'>>;
  let answers: jest.Mocked<Pick<AnswerRepository, 'findBySession'>>;
  let lookups: jest.Mocked<Pick<ExternalLookupRepository, 'findBySession'>>;
  let idempotencyKeys: jest.Mocked<Pick<IdempotencyKeyRepository, 'findByKey' | 'create'>>;
  let trigger: jest.Mocked<Pick<LookupTriggerService, 'trigger'>>;
  let assembler: jest.Mocked<Pick<SessionStateAssembler, 'assemble'>>;
  let dataSource: DataSource;
  let service: OnboardingService;

  const state = { sessionId, version: 2 } as SessionStateDto;

  beforeEach(() => {
    sessions = { findById: jest.fn().mockResolvedValue(session) };
    answers = { findBySession: jest.fn().mockResolvedValue([]) };
    lookups = { findBySession: jest.fn() };
    idempotencyKeys = { findByKey: jest.fn().mockResolvedValue(null), create: jest.fn() };
    trigger = { trigger: jest.fn().mockResolvedValue({ lookup: buildLookup() }) };
    assembler = { assemble: jest.fn().mockReturnValue(state) };
    dataSource = {
      transaction: jest.fn((cb: (m: EntityManager) => Promise<unknown>) => cb({} as EntityManager)),
    } as unknown as DataSource;

    service = new OnboardingService(
      dataSource,
      sessions as unknown as OnboardingSessionRepository,
      answers as unknown as AnswerRepository,
      {} as FlowVersionRepository,
      lookups as unknown as ExternalLookupRepository,
      {} as OutboxEventRepository,
      idempotencyKeys as unknown as IdempotencyKeyRepository,
      {} as OutboxWriter,
      assembler as unknown as SessionStateAssembler,
      new SummaryBuilder(),
      trigger as unknown as LookupTriggerService,
      new FlowEngineService(),
    );
  });

  it('re-triggers and returns state when failed and under max triggers', async () => {
    lookups.findBySession.mockResolvedValue(buildLookup({ triggers: 1, maxTriggers: 3 }));

    const result = await service.retryLookup(sessionId, { idempotencyKey });

    expect(trigger.trigger).toHaveBeenCalledWith(expect.anything(), sessionId, false);
    expect(idempotencyKeys.create).toHaveBeenCalled();
    expect(result).toBe(state);
  });

  it('rejects with 409 when the lookup is not in failed state', async () => {
    lookups.findBySession.mockResolvedValue(buildLookup({ status: ExternalLookupStatus.Loading }));

    await expect(service.retryLookup(sessionId, { idempotencyKey })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(trigger.trigger).not.toHaveBeenCalled();
  });

  it('rejects with 409 when max triggers is reached', async () => {
    lookups.findBySession.mockResolvedValue(buildLookup({ triggers: 3, maxTriggers: 3 }));

    await expect(service.retryLookup(sessionId, { idempotencyKey })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(trigger.trigger).not.toHaveBeenCalled();
  });

  it('rejects with 404 when no lookup exists for the session', async () => {
    lookups.findBySession.mockResolvedValue(null);

    await expect(service.retryLookup(sessionId, { idempotencyKey })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('replays the stored response on a repeated idempotency key', async () => {
    idempotencyKeys.findByKey.mockResolvedValue({
      requestHash: service['hashRetryRequest'](sessionId),
      response: state,
    } as never);

    const result = await service.retryLookup(sessionId, { idempotencyKey });

    expect(result).toEqual(state);
    expect(trigger.trigger).not.toHaveBeenCalled();
  });
});

/** A valid address answer value for `property_address` submits/edits. */
const VALID_ADDRESS = { street: '1 Main St', city: 'Springfield' };
/** A valid adult date of birth. */
const ADULT_DOB = '1990-06-15';

/**
 * In-memory {@link Answer} store standing in for the real repository, so submit/edit exercise
 * the real FlowEngine over evolving answer state without a database.
 */
class FakeAnswerRepo {
  readonly rows: Answer[] = [];

  create(data: Partial<Answer>): Promise<Answer> {
    const row = Object.assign(new Answer(), {
      id: randomUUID(),
      status: AnswerStatus.Active,
      ...data,
    });
    this.rows.push(row);
    return Promise.resolve(row);
  }

  save(answer: Answer): Promise<Answer> {
    return Promise.resolve(answer);
  }

  findBySession(): Promise<Answer[]> {
    return Promise.resolve(this.rows);
  }

  findByQuestion(_sessionId: string, questionId: string): Promise<Answer | null> {
    return Promise.resolve(this.rows.find((r) => r.questionId === questionId) ?? null);
  }

  seed(questionId: string, value: unknown, status: AnswerStatus = AnswerStatus.Active): void {
    this.rows.push(Object.assign(new Answer(), { id: randomUUID(), questionId, value, status }));
  }
}

/**
 * Assembles an {@link OnboardingService} wired with the real FlowEngine, an in-memory answer
 * store, and jest-mocked session/idempotency/lookup access for the M3 answer-flow use-cases.
 */
function buildService(sessionVersion = 0): {
  service: OnboardingService;
  session: OnboardingSession;
  answerRepo: FakeAnswerRepo;
  trigger: jest.Mock;
  idempotencyKeys: {
    findByKey: jest.Mock;
    create: jest.Mock;
  };
  bumpAffected: { value: number };
} {
  const sessionId = randomUUID();
  const session = Object.assign(new OnboardingSession(), {
    id: sessionId,
    status: SessionStatus.InProgress,
    version: sessionVersion,
  });
  const answerRepo = new FakeAnswerRepo();
  const sessions = { findById: jest.fn().mockResolvedValue(session) };
  const lookups = { findBySession: jest.fn().mockResolvedValue(null) };
  const idempotencyKeys = { findByKey: jest.fn().mockResolvedValue(null), create: jest.fn() };
  const trigger = jest.fn().mockResolvedValue({ lookup: {} });
  const assembler = {
    assemble: jest.fn().mockReturnValue({ sessionId }),
  };

  const bumpAffected = { value: 1 };
  const manager = {
    getRepository: () => ({
      createQueryBuilder: () => ({
        update: () => ({
          set: () => ({
            where: () => ({
              execute: (): Promise<UpdateResult> =>
                Promise.resolve({ affected: bumpAffected.value } as UpdateResult),
            }),
          }),
        }),
      }),
    }),
  } as unknown as EntityManager;

  const dataSource = {
    transaction: jest.fn((cb: (m: EntityManager) => Promise<unknown>) => cb(manager)),
  } as unknown as DataSource;

  const service = new OnboardingService(
    dataSource,
    sessions as unknown as OnboardingSessionRepository,
    answerRepo as unknown as AnswerRepository,
    {} as FlowVersionRepository,
    lookups as unknown as ExternalLookupRepository,
    {} as OutboxEventRepository,
    idempotencyKeys as unknown as IdempotencyKeyRepository,
    {} as OutboxWriter,
    assembler as unknown as SessionStateAssembler,
    new SummaryBuilder(),
    { trigger } as unknown as LookupTriggerService,
    new FlowEngineService(),
  );

  return { service, session, answerRepo, trigger, idempotencyKeys, bumpAffected };
}

describe('OnboardingService.submitAnswer', () => {
  it('accepts a valid answer to the current question and persists it', async () => {
    const { service, session, answerRepo } = buildService();

    await service.submitAnswer(session.id, 'full_name', 'Jane Doe', 0, {
      idempotencyKey: randomUUID(),
    });

    expect(answerRepo.rows).toHaveLength(1);
    expect(answerRepo.rows[0]).toMatchObject({ questionId: 'full_name', value: 'Jane Doe' });
  });

  it('rejects an invalid value with 400 (empty name fails the type check)', async () => {
    const { service, session } = buildService();

    await expect(
      service.submitAnswer(session.id, 'full_name', '', 0, { idempotencyKey: randomUUID() }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an out-of-order (non-current) question with 409', async () => {
    const { service, session } = buildService();

    // date_of_birth is not current until full_name is answered
    await expect(
      service.submitAnswer(session.id, 'date_of_birth', ADULT_DOB, 0, {
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a stale expectedVersion with 409', async () => {
    const { service, session } = buildService(3);

    await expect(
      service.submitAnswer(session.id, 'full_name', 'Jane', 2, { idempotencyKey: randomUUID() }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('fires the transactional trigger only for property_address', async () => {
    const { service, session, answerRepo, trigger } = buildService();
    answerRepo.seed('full_name', 'Jane');
    answerRepo.seed('date_of_birth', ADULT_DOB);
    answerRepo.seed('residence_type', 'own');

    await service.submitAnswer(session.id, 'property_address', VALID_ADDRESS, 0, {
      idempotencyKey: randomUUID(),
    });

    expect(trigger).toHaveBeenCalledWith(expect.anything(), session.id, true);
  });

  it('does NOT trigger a lookup for a non-address answer', async () => {
    const { service, session, trigger } = buildService();

    await service.submitAnswer(session.id, 'full_name', 'Jane', 0, {
      idempotencyKey: randomUUID(),
    });

    expect(trigger).not.toHaveBeenCalled();
  });

  it('replays the stored response for the same key + same body (one write)', async () => {
    const { service, session, answerRepo, idempotencyKeys } = buildService();
    const key = randomUUID();
    const stored = { sessionId: session.id, version: 1 } as SessionStateDto;
    const requestHash = service['hashSubmitRequest'](session.id, 'full_name', 'Jane', 0);
    idempotencyKeys.findByKey.mockResolvedValue({ requestHash, response: stored });

    const result = await service.submitAnswer(session.id, 'full_name', 'Jane', 0, {
      idempotencyKey: key,
    });

    expect(result).toEqual(stored);
    expect(answerRepo.rows).toHaveLength(0);
    expect(idempotencyKeys.create).not.toHaveBeenCalled();
  });

  it('rejects the same key + different body with 422', async () => {
    const { service, session, idempotencyKeys } = buildService();
    const otherHash = service['hashSubmitRequest'](session.id, 'full_name', 'Someone else', 0);
    idempotencyKeys.findByKey.mockResolvedValue({ requestHash: otherHash, response: {} });

    await expect(
      service.submitAnswer(session.id, 'full_name', 'Jane', 0, { idempotencyKey: randomUUID() }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('stores the idempotency record on the first successful submit', async () => {
    const { service, session, idempotencyKeys } = buildService();

    await service.submitAnswer(session.id, 'full_name', 'Jane', 0, {
      idempotencyKey: randomUUID(),
    });

    expect(idempotencyKeys.create).toHaveBeenCalledTimes(1);
  });

  it('rejects with 409 when the guarded version bump matches no row (concurrent write)', async () => {
    const { service, session, bumpAffected } = buildService();
    bumpAffected.value = 0;

    await expect(
      service.submitAnswer(session.id, 'full_name', 'Jane', 0, { idempotencyKey: randomUUID() }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('OnboardingService.editAnswer', () => {
  it('rejects editing a never-answered question with 404', async () => {
    const { service, session } = buildService();

    await expect(service.editAnswer(session.id, 'full_name', 'Jane', 0)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects an invalid edited value with 400', async () => {
    const { service, session, answerRepo } = buildService();
    answerRepo.seed('full_name', 'Jane');

    await expect(service.editAnswer(session.id, 'full_name', '', 0)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a stale expectedVersion with 409', async () => {
    const { service, session, answerRepo } = buildService(5);
    answerRepo.seed('full_name', 'Jane');

    await expect(service.editAnswer(session.id, 'full_name', 'Janet', 4)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('marks now-hidden answers irrelevant on a branch-switch edit (own → rent)', async () => {
    const { service, session, answerRepo } = buildService();
    answerRepo.seed('full_name', 'Jane');
    answerRepo.seed('date_of_birth', ADULT_DOB);
    answerRepo.seed('residence_type', 'own');
    answerRepo.seed('property_address', VALID_ADDRESS);
    answerRepo.seed('year_built', 1990);
    answerRepo.seed('construction_type', 'wood');
    answerRepo.seed('has_security_system', false);

    await service.editAnswer(session.id, 'residence_type', 'rent', 0);

    const byId = (id: string): Answer | undefined =>
      answerRepo.rows.find((r) => r.questionId === id);
    expect(byId('year_built')?.status).toBe(AnswerStatus.Irrelevant);
    expect(byId('construction_type')?.status).toBe(AnswerStatus.Irrelevant);
    expect(byId('has_security_system')?.status).toBe(AnswerStatus.Irrelevant);
    expect(byId('residence_type')?.status).toBe(AnswerStatus.Active);
  });

  it('re-triggers the lookup when the property_address value changes', async () => {
    const { service, session, answerRepo, trigger } = buildService();
    answerRepo.seed('property_address', VALID_ADDRESS);

    await service.editAnswer(
      session.id,
      'property_address',
      { street: '2 Oak Ave', city: 'Portland' },
      0,
    );

    expect(trigger).toHaveBeenCalledWith(expect.anything(), session.id, true);
  });

  it('does NOT re-trigger when property_address is edited to the same value', async () => {
    const { service, session, answerRepo, trigger } = buildService();
    answerRepo.seed('property_address', VALID_ADDRESS);

    await service.editAnswer(session.id, 'property_address', { ...VALID_ADDRESS }, 0);

    expect(trigger).not.toHaveBeenCalled();
  });

  it('does NOT re-trigger when a non-address answer is edited', async () => {
    const { service, session, answerRepo, trigger } = buildService();
    answerRepo.seed('full_name', 'Jane');

    await service.editAnswer(session.id, 'full_name', 'Janet', 0);

    expect(trigger).not.toHaveBeenCalled();
  });
});
