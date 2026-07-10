import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { FlowVersion } from '../../database/entities';

/**
 * Data access for {@link FlowVersion}. Used by the seed to register the active version and
 * by session creation to pin the flow a session started under.
 */
@Injectable()
export class FlowVersionRepository {
  constructor(
    @InjectRepository(FlowVersion)
    private readonly repo: Repository<FlowVersion>,
  ) {}

  private scoped(manager?: EntityManager): Repository<FlowVersion> {
    return manager ? manager.getRepository(FlowVersion) : this.repo;
  }

  /**
   * Creates and persists a flow version.
   * @param data the flow version fields
   * @param manager optional transactional EntityManager
   * @returns the saved flow version
   */
  async create(data: Partial<FlowVersion>, manager?: EntityManager): Promise<FlowVersion> {
    const repo = this.scoped(manager);
    return repo.save(repo.create(data));
  }

  /**
   * Finds a flow version by its numeric version.
   * @param version the flow version number
   * @param manager optional transactional EntityManager
   * @returns the flow version, or null if not registered
   */
  async findByVersion(version: number, manager?: EntityManager): Promise<FlowVersion | null> {
    return this.scoped(manager).findOne({ where: { version } });
  }
}
