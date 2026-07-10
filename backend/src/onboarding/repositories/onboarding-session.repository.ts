import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OnboardingSession } from '../../database/entities';

/**
 * Data access for {@link OnboardingSession}. All session persistence flows through here;
 * no business rules live in this layer (repository pattern, spec §2).
 */
@Injectable()
export class OnboardingSessionRepository {
  constructor(
    @InjectRepository(OnboardingSession)
    private readonly repo: Repository<OnboardingSession>,
  ) {}

  /**
   * Resolves the repository bound to a transaction, or the default one.
   * @param manager optional transactional EntityManager
   * @returns the appropriate TypeORM repository
   */
  private scoped(manager?: EntityManager): Repository<OnboardingSession> {
    return manager ? manager.getRepository(OnboardingSession) : this.repo;
  }

  /**
   * Creates and persists a new session.
   * @param data the fields to initialize the session with
   * @param manager optional transactional EntityManager
   * @returns the saved session
   */
  async create(
    data: Partial<OnboardingSession>,
    manager?: EntityManager,
  ): Promise<OnboardingSession> {
    const repo = this.scoped(manager);
    return repo.save(repo.create(data));
  }

  /**
   * Finds a session by id.
   * @param id the session id
   * @param manager optional transactional EntityManager
   * @returns the session, or null if not found
   */
  async findById(id: string, manager?: EntityManager): Promise<OnboardingSession | null> {
    return this.scoped(manager).findOne({ where: { id } });
  }

  /**
   * Persists changes to an existing session (bumps `@VersionColumn`).
   * @param session the session entity to save
   * @param manager optional transactional EntityManager
   * @returns the saved session
   */
  async save(session: OnboardingSession, manager?: EntityManager): Promise<OnboardingSession> {
    return this.scoped(manager).save(session);
  }
}
