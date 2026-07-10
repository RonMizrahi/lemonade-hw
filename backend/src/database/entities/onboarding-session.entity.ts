import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { SessionStatus } from '../../common/enums';
import { FlowVersion } from './flow-version.entity';

/**
 * Normalized session summary, populated on completion (spec §9). Kept open here;
 * the completion milestone (M5) defines the exact fields.
 */
export interface SessionSummary {
  [key: string]: unknown;
}

/**
 * The root aggregate: one onboarding session. Version is an optimistic-lock counter
 * (`@VersionColumn`) bumped on every write; clients echo it as `expectedVersion` (spec §5, §6).
 */
@Entity({ name: 'onboarding_session' })
export class OnboardingSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: SessionStatus, default: SessionStatus.InProgress })
  status!: SessionStatus;

  @Column({ name: 'flow_version_id', type: 'uuid' })
  flowVersionId!: string;

  @ManyToOne(() => FlowVersion, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'flow_version_id' })
  flowVersion!: FlowVersion;

  /** Optimistic lock — bumped by TypeORM on every persisted change (spec §6). */
  @VersionColumn()
  version!: number;

  @Column({ type: 'jsonb', nullable: true })
  summary!: SessionSummary | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}
