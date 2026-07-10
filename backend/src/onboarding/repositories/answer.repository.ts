import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Answer } from '../../database/entities';

/**
 * Data access for {@link Answer}. Enforces no rules — callers own branching/reconciliation.
 */
@Injectable()
export class AnswerRepository {
  constructor(
    @InjectRepository(Answer)
    private readonly repo: Repository<Answer>,
  ) {}

  private scoped(manager?: EntityManager): Repository<Answer> {
    return manager ? manager.getRepository(Answer) : this.repo;
  }

  /**
   * Creates and persists a new answer.
   * @param data the answer fields
   * @param manager optional transactional EntityManager
   * @returns the saved answer
   */
  async create(data: Partial<Answer>, manager?: EntityManager): Promise<Answer> {
    const repo = this.scoped(manager);
    return repo.save(repo.create(data));
  }

  /**
   * Persists changes to an existing answer.
   * @param answer the answer entity to save
   * @param manager optional transactional EntityManager
   * @returns the saved answer
   */
  async save(answer: Answer, manager?: EntityManager): Promise<Answer> {
    return this.scoped(manager).save(answer);
  }

  /**
   * Finds all answers for a session, ordered by creation.
   * @param sessionId the owning session id
   * @param manager optional transactional EntityManager
   * @returns the session's answers
   */
  async findBySession(sessionId: string, manager?: EntityManager): Promise<Answer[]> {
    return this.scoped(manager).find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Finds a single answer by session and question.
   * @param sessionId the owning session id
   * @param questionId the question id
   * @param manager optional transactional EntityManager
   * @returns the answer, or null if not present
   */
  async findByQuestion(
    sessionId: string,
    questionId: string,
    manager?: EntityManager,
  ): Promise<Answer | null> {
    return this.scoped(manager).findOne({ where: { sessionId, questionId } });
  }
}
