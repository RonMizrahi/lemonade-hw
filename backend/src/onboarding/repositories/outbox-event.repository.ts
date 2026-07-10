import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OutboxStatus } from '../../common/enums';
import { OutboxEvent } from '../../database/entities';

/**
 * Data access for {@link OutboxEvent}. Writes happen inside the answer transaction (via
 * OutboxWriter); the relay reads `pending` rows and marks them published (spec §7).
 */
@Injectable()
export class OutboxEventRepository {
  constructor(
    @InjectRepository(OutboxEvent)
    private readonly repo: Repository<OutboxEvent>,
  ) {}

  private scoped(manager?: EntityManager): Repository<OutboxEvent> {
    return manager ? manager.getRepository(OutboxEvent) : this.repo;
  }

  /**
   * Creates and persists an outbox event.
   * @param data the event fields
   * @param manager optional transactional EntityManager (the answer tx)
   * @returns the saved event
   */
  async create(data: Partial<OutboxEvent>, manager?: EntityManager): Promise<OutboxEvent> {
    const repo = this.scoped(manager);
    return repo.save(repo.create(data));
  }

  /**
   * Persists changes to an existing event (e.g. marking it published).
   * @param event the event entity to save
   * @param manager optional transactional EntityManager
   * @returns the saved event
   */
  async save(event: OutboxEvent, manager?: EntityManager): Promise<OutboxEvent> {
    return this.scoped(manager).save(event);
  }

  /**
   * Loads the oldest pending events for the relay to publish.
   * @param limit the maximum number of rows to claim
   * @param manager optional transactional EntityManager
   * @returns pending events, oldest first
   */
  async findPending(limit: number, manager?: EntityManager): Promise<OutboxEvent[]> {
    return this.scoped(manager).find({
      where: { status: OutboxStatus.Pending },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }
}
