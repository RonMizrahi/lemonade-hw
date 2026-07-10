import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { OutboxStatus } from '../../common/enums';

/**
 * Payload of an `external_lookup.requested` outbox event (spec §7).
 */
export interface OutboxEventPayload {
  lookupId: string;
  sessionId: string;
  generation: number;
}

/**
 * Transactional outbox row. Written in the same DB transaction as the answer that
 * triggers a lookup; the OutboxRelay polls `pending` rows and publishes them (spec §7).
 * Indexed on (status, created_at) for the relay's poll query.
 */
@Entity({ name: 'outbox_event' })
@Index('ix_outbox_status_created_at', ['status', 'createdAt'])
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'aggregate_type', type: 'text' })
  aggregateType!: string;

  @Column({ name: 'aggregate_id', type: 'uuid' })
  aggregateId!: string;

  @Column({ type: 'text' })
  type!: string;

  @Column({ type: 'jsonb' })
  payload!: OutboxEventPayload;

  @Column({ type: 'enum', enum: OutboxStatus, default: OutboxStatus.Pending })
  status!: OutboxStatus;

  /** Relay retry counter. */
  @Column({ name: 'publish_attempts', type: 'int', default: 0 })
  publishAttempts!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;
}
