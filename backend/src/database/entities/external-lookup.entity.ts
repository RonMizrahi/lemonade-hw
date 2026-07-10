import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ExternalLookupStatus } from '../../common/enums';
import { OnboardingSession } from './onboarding-session.entity';

/**
 * Mock property-lookup result, or the fallback record on permanent failure (spec §5, §7).
 * Shape is open; the async pipeline milestone (M4) populates concrete fields.
 */
export interface ExternalLookupResult {
  [key: string]: unknown;
}

/**
 * The async external property lookup for a session (one per session).
 * `generation` guards against stale jobs when the address changes mid-flight (spec §7).
 */
@Entity({ name: 'external_lookup' })
@Unique('uq_external_lookup_session', ['sessionId'])
export class ExternalLookup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @OneToOne(() => OnboardingSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session!: OnboardingSession;

  @Column({
    type: 'enum',
    enum: ExternalLookupStatus,
    default: ExternalLookupStatus.NotStarted,
  })
  status!: ExternalLookupStatus;

  /** Bumped when the address changes; jobs carry it, stale jobs are ignored (spec §7). */
  @Column({ type: 'int', default: 0 })
  generation!: number;

  /** Number of enqueue triggers (initial + manual retries). */
  @Column({ type: 'int', default: 0 })
  triggers!: number;

  @Column({ name: 'max_triggers', type: 'int', default: 3 })
  maxTriggers!: number;

  /** BullMQ attempts on the current trigger. */
  @Column({ name: 'job_attempts', type: 'int', default: 0 })
  jobAttempts!: number;

  @Column({ type: 'jsonb', nullable: true })
  result!: ExternalLookupResult | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'last_attempt_at', type: 'timestamptz', nullable: true })
  lastAttemptAt!: Date | null;
}
