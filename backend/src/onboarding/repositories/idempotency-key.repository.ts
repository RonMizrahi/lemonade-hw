import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { IdempotencyKey } from '../../database/entities';

/**
 * Data access for {@link IdempotencyKey}. Backs the idempotent-POST contract: first call
 * stores the response, replays return it, key reuse with a different body ⇒ 422 (spec §6).
 */
@Injectable()
export class IdempotencyKeyRepository {
  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly repo: Repository<IdempotencyKey>,
  ) {}

  private scoped(manager?: EntityManager): Repository<IdempotencyKey> {
    return manager ? manager.getRepository(IdempotencyKey) : this.repo;
  }

  /**
   * Creates and persists an idempotency record.
   * @param data the record fields
   * @param manager optional transactional EntityManager
   * @returns the saved record
   */
  async create(data: Partial<IdempotencyKey>, manager?: EntityManager): Promise<IdempotencyKey> {
    const repo = this.scoped(manager);
    return repo.save(repo.create(data));
  }

  /**
   * Finds a stored idempotency record by its client-supplied key.
   * @param key the `Idempotency-Key` header value
   * @param manager optional transactional EntityManager
   * @returns the record, or null if the key is unused
   */
  async findByKey(key: string, manager?: EntityManager): Promise<IdempotencyKey | null> {
    return this.scoped(manager).findOne({ where: { key } });
  }
}
