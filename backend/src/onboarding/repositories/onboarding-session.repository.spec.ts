import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { SessionStatus } from '../../common/enums';
import { OnboardingSession } from '../../database/entities';
import { OnboardingSessionRepository } from './onboarding-session.repository';

/**
 * Builds a jest-mocked TypeORM Repository exposing only the methods under test.
 */
function buildMockRepo(): jest.Mocked<
  Pick<Repository<OnboardingSession>, 'create' | 'save' | 'findOne'>
> {
  return {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  };
}

describe('OnboardingSessionRepository', () => {
  let mockRepo: ReturnType<typeof buildMockRepo>;
  let repository: OnboardingSessionRepository;

  beforeEach(() => {
    mockRepo = buildMockRepo();
    repository = new OnboardingSessionRepository(
      mockRepo as unknown as Repository<OnboardingSession>,
    );
  });

  it('create() builds and saves a session', async () => {
    const flowVersionId = randomUUID();
    const draft = { flowVersionId, status: SessionStatus.InProgress } as OnboardingSession;
    const saved = { ...draft, id: randomUUID(), version: 1 } as OnboardingSession;
    mockRepo.create.mockReturnValue(draft);
    mockRepo.save.mockResolvedValue(saved);

    const result = await repository.create({ flowVersionId });

    expect(mockRepo.create).toHaveBeenCalledWith({ flowVersionId });
    expect(mockRepo.save).toHaveBeenCalledWith(draft);
    expect(result).toBe(saved);
  });

  it('findById() delegates to findOne with the id filter', async () => {
    const id = randomUUID();
    const session = { id } as OnboardingSession;
    mockRepo.findOne.mockResolvedValue(session);

    const result = await repository.findById(id);

    expect(mockRepo.findOne).toHaveBeenCalledWith({ where: { id } });
    expect(result).toBe(session);
  });

  it('findById() returns null when absent', async () => {
    mockRepo.findOne.mockResolvedValue(null);

    const result = await repository.findById(randomUUID());

    expect(result).toBeNull();
  });

  it('save() persists an existing session', async () => {
    const session = { id: randomUUID(), version: 2 } as OnboardingSession;
    mockRepo.save.mockResolvedValue(session);

    const result = await repository.save(session);

    expect(mockRepo.save).toHaveBeenCalledWith(session);
    expect(result).toBe(session);
  });
});
