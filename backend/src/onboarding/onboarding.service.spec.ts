import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ExternalLookupStatus, SessionStatus } from '../common/enums';
import { ExternalLookup, OnboardingSession } from '../database/entities';
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
      trigger as unknown as LookupTriggerService,
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
