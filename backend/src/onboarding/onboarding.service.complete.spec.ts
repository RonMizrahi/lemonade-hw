import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, UpdateResult } from 'typeorm';
import { AnswerStatus, ExternalLookupStatus, SessionStatus } from '../common/enums';
import { Answer, ExternalLookup, OnboardingSession } from '../database/entities';
import { FlowEngineService } from '../flow-engine/flow-engine.service';
import {
  AnswerRepository,
  ExternalLookupRepository,
  OnboardingSessionRepository,
} from './repositories';
import { SessionStateAssembler } from './session-state.assembler';
import { SummaryBuilder } from './summary-builder';
import { OnboardingService } from './onboarding.service';

/** Rows matched by the guarded completion UPDATE; 0 simulates a concurrent write landing first. */
const affected = { value: 1 };

/**
 * An EntityManager stand-in whose query builder resolves the guarded completion UPDATE to the
 * configurable `affected` count, so the optimistic-lock guard in `markCompleted` is testable.
 */
const FAKE_MANAGER = {
  getRepository: () => ({
    createQueryBuilder: () => ({
      update: () => ({
        set: () => ({
          where: () => ({
            setParameters: () => ({
              execute: (): Promise<UpdateResult> =>
                Promise.resolve({ affected: affected.value } as UpdateResult),
            }),
          }),
        }),
      }),
    }),
  }),
} as unknown as EntityManager;

/**
 * A DataSource whose `transaction` runs the callback immediately with the fake manager,
 * so the service's transactional `complete` can be unit-tested without a real database.
 */
function fakeDataSource(): DataSource {
  return {
    transaction: <T>(cb: (manager: EntityManager) => Promise<T>): Promise<T> => cb(FAKE_MANAGER),
  } as unknown as DataSource;
}

/** Builds a session row with the given status/version. */
function session(overrides: Partial<OnboardingSession> = {}): OnboardingSession {
  return {
    id: randomUUID(),
    status: SessionStatus.InProgress,
    version: 5,
    summary: null,
    completedAt: null,
    ...overrides,
  } as OnboardingSession;
}

/** Builds an active answer row. */
function answer(questionId: string, value: unknown): Answer {
  return { questionId, value, status: AnswerStatus.Active } as Answer;
}

/** A complete set of active homeowner answers (no required question missing). */
function completableAnswers(): Answer[] {
  return [
    answer('full_name', 'Jane Doe'),
    answer('date_of_birth', '1990-06-15'),
    answer('residence_type', 'own'),
    answer('property_address', { street: '1 Main St', city: 'Springfield' }),
    answer('year_built', 1990),
    answer('construction_type', 'brick'),
    answer('has_security_system', false),
    answer('coverage_start_date', '2099-01-01'),
    answer('wants_earthquake_coverage', false),
  ];
}

/** Builds a lookup row in the given status with an optional result. */
function lookup(
  status: ExternalLookupStatus,
  result: Record<string, unknown> | null = null,
): ExternalLookup {
  return { status, result, jobAttempts: 1 } as ExternalLookup;
}

describe('OnboardingService.complete (gating + summary)', () => {
  let sessions: jest.Mocked<Pick<OnboardingSessionRepository, 'findById'>>;
  let answers: jest.Mocked<Pick<AnswerRepository, 'findBySession'>>;
  let lookups: jest.Mocked<Pick<ExternalLookupRepository, 'findBySession'>>;
  let service: OnboardingService;

  beforeEach(() => {
    affected.value = 1;
    sessions = { findById: jest.fn() };
    answers = { findBySession: jest.fn() };
    lookups = { findBySession: jest.fn() };
    const flowEngine = new FlowEngineService();
    const summaryBuilder = new SummaryBuilder();
    const assembler = new SessionStateAssembler(flowEngine);

    service = new OnboardingService(
      fakeDataSource(),
      sessions as unknown as OnboardingSessionRepository,
      answers as unknown as AnswerRepository,
      {} as never,
      lookups as unknown as ExternalLookupRepository,
      {} as never,
      {} as never,
      {} as never,
      assembler,
      summaryBuilder,
      {} as never,
      flowEngine,
    );
  });

  /**
   * Mocks the two `findById` reads `complete` performs: the pre-write load returns `before`,
   * and the post-write `buildState` re-read returns `after` (the committed completed row), so
   * the assembled state reflects the guarded UPDATE the way a real re-SELECT would.
   */
  function stubReads(before: OnboardingSession, after: OnboardingSession): void {
    sessions.findById.mockResolvedValueOnce(before).mockResolvedValue(after);
  }

  it('throws 404 when the session does not exist', async () => {
    sessions.findById.mockResolvedValue(null);

    await expect(service.complete(randomUUID(), 5)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks (409) when a required visible question is unanswered', async () => {
    sessions.findById.mockResolvedValue(session());
    answers.findBySession.mockResolvedValue([answer('full_name', 'Jane Doe')]);
    lookups.findBySession.mockResolvedValue(lookup(ExternalLookupStatus.Completed));

    await expect(service.complete(randomUUID(), 5)).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks (409) when the lookup is still loading', async () => {
    sessions.findById.mockResolvedValue(session());
    answers.findBySession.mockResolvedValue(completableAnswers());
    lookups.findBySession.mockResolvedValue(lookup(ExternalLookupStatus.Loading));

    await expect(service.complete(randomUUID(), 5)).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks (409) on a stale expectedVersion', async () => {
    sessions.findById.mockResolvedValue(session({ version: 5 }));
    answers.findBySession.mockResolvedValue(completableAnswers());
    lookups.findBySession.mockResolvedValue(lookup(ExternalLookupStatus.Completed));

    await expect(service.complete(randomUUID(), 4)).rejects.toBeInstanceOf(ConflictException);
  });

  it('completes when the lookup is completed and all required answers are present', async () => {
    const before = session({ version: 5 });
    // The post-write re-read reflects the committed summary the guarded UPDATE persisted.
    const after = session({
      id: before.id,
      status: SessionStatus.Completed,
      version: 6,
      summary: { propertyData: { dataSource: 'external', data: null } },
    });
    stubReads(before, after);
    answers.findBySession.mockResolvedValue(completableAnswers());
    lookups.findBySession.mockResolvedValue(
      lookup(ExternalLookupStatus.Completed, { dataSource: 'external', estimatedValue: 1 }),
    );

    const state = await service.complete(before.id, 5);

    expect(state.status).toBe(SessionStatus.Completed);
    expect(state.version).toBe(6);
    expect(state.summary).toMatchObject({ propertyData: { dataSource: 'external' } });
  });

  it('completes with the fallback dataSource when the lookup permanently failed', async () => {
    const before = session({ version: 5 });
    const after = session({
      id: before.id,
      status: SessionStatus.Completed,
      version: 6,
      summary: { propertyData: { dataSource: 'fallback', data: null } },
    });
    stubReads(before, after);
    answers.findBySession.mockResolvedValue(completableAnswers());
    lookups.findBySession.mockResolvedValue(
      lookup(ExternalLookupStatus.PermanentlyFailed, { fallback: true, dataSource: 'fallback' }),
    );

    const state = await service.complete(before.id, 5);

    expect(state.status).toBe(SessionStatus.Completed);
    expect(state.summary).toMatchObject({ propertyData: { dataSource: 'fallback' } });
  });

  it('rejects (409) when a concurrent write lands between the read and the guarded update', async () => {
    const before = session({ version: 5 });
    sessions.findById.mockResolvedValue(before);
    answers.findBySession.mockResolvedValue(completableAnswers());
    lookups.findBySession.mockResolvedValue(lookup(ExternalLookupStatus.Completed));
    // The guarded UPDATE matches no row: another writer moved the version first.
    affected.value = 0;

    await expect(service.complete(before.id, 5)).rejects.toBeInstanceOf(ConflictException);
  });

  it('is idempotent: re-completing returns the stored summary without a re-write', async () => {
    const storedSummary = { propertyData: { dataSource: 'external', data: null } };
    const stored = session({ status: SessionStatus.Completed, summary: storedSummary, version: 6 });
    sessions.findById.mockResolvedValue(stored);
    answers.findBySession.mockResolvedValue(completableAnswers());
    lookups.findBySession.mockResolvedValue(lookup(ExternalLookupStatus.Completed));

    const state = await service.complete(stored.id, 999);

    expect(state.status).toBe(SessionStatus.Completed);
    expect(state.summary).toEqual(storedSummary);
  });
});
