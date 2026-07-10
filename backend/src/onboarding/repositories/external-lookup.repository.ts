import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ExternalLookup } from '../../database/entities';

/**
 * Data access for {@link ExternalLookup}. The service and worker read/advance the lookup
 * state through here; the generation guard logic itself lives in the caller (spec §7).
 */
@Injectable()
export class ExternalLookupRepository {
  constructor(
    @InjectRepository(ExternalLookup)
    private readonly repo: Repository<ExternalLookup>,
  ) {}

  private scoped(manager?: EntityManager): Repository<ExternalLookup> {
    return manager ? manager.getRepository(ExternalLookup) : this.repo;
  }

  /**
   * Creates and persists a lookup row.
   * @param data the lookup fields
   * @param manager optional transactional EntityManager
   * @returns the saved lookup
   */
  async create(data: Partial<ExternalLookup>, manager?: EntityManager): Promise<ExternalLookup> {
    const repo = this.scoped(manager);
    return repo.save(repo.create(data));
  }

  /**
   * Persists changes to an existing lookup.
   * @param lookup the lookup entity to save
   * @param manager optional transactional EntityManager
   * @returns the saved lookup
   */
  async save(lookup: ExternalLookup, manager?: EntityManager): Promise<ExternalLookup> {
    return this.scoped(manager).save(lookup);
  }

  /**
   * Finds the single lookup for a session.
   * @param sessionId the owning session id
   * @param manager optional transactional EntityManager
   * @returns the lookup, or null if none exists yet
   */
  async findBySession(sessionId: string, manager?: EntityManager): Promise<ExternalLookup | null> {
    return this.scoped(manager).findOne({ where: { sessionId } });
  }

  /**
   * Finds a lookup by id.
   * @param id the lookup id
   * @param manager optional transactional EntityManager
   * @returns the lookup, or null if not found
   */
  async findById(id: string, manager?: EntityManager): Promise<ExternalLookup | null> {
    return this.scoped(manager).findOne({ where: { id } });
  }
}
