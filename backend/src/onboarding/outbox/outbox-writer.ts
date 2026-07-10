import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OutboxStatus } from '../../common/enums';
import { OutboxEvent, OutboxEventPayload } from '../../database/entities';

/**
 * Event type emitted when an external property lookup is requested (spec §7).
 */
export const EXTERNAL_LOOKUP_REQUESTED = 'external_lookup.requested';

/**
 * Aggregate type recorded on the outbox row for a lookup request.
 */
export const AGGREGATE_TYPE_EXTERNAL_LOOKUP = 'external_lookup';

/**
 * Writes outbox events (spec §7). The write MUST happen inside the same transaction as the
 * answer that triggered it — the caller passes its `EntityManager` — so the event is
 * persisted iff the answer commits (at-least-once, no lost or phantom triggers).
 */
@Injectable()
export class OutboxWriter {
  /**
   * Inserts an `external_lookup.requested` outbox event within the caller's transaction.
   * @param manager the transactional EntityManager of the enclosing answer write
   * @param payload the lookup identity carried to the worker
   * @returns the persisted outbox event
   */
  async writeLookupRequested(
    manager: EntityManager,
    payload: OutboxEventPayload,
  ): Promise<OutboxEvent> {
    const repo = manager.getRepository(OutboxEvent);
    const event = repo.create({
      aggregateType: AGGREGATE_TYPE_EXTERNAL_LOOKUP,
      aggregateId: payload.lookupId,
      type: EXTERNAL_LOOKUP_REQUESTED,
      payload,
      status: OutboxStatus.Pending,
      publishAttempts: 0,
    });
    return repo.save(event);
  }
}
