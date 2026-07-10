import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { AnswerStatus } from '../../common/enums';
import { OnboardingSession } from './onboarding-session.entity';

/**
 * A single answer to a flow question. Values are stored as normalized JSON.
 * `irrelevant` answers are soft-marked (retained for audit), not deleted (spec §5, §8).
 * Unique per (session, question).
 */
@Entity({ name: 'answer' })
@Unique('uq_answer_session_question', ['sessionId', 'questionId'])
export class Answer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  @ManyToOne(() => OnboardingSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session!: OnboardingSession;

  @Column({ name: 'question_id', type: 'text' })
  questionId!: string;

  /** Normalized answer value (string, number, boolean, address object, …). */
  @Column({ type: 'jsonb' })
  value!: unknown;

  @Column({ type: 'enum', enum: AnswerStatus, default: AnswerStatus.Active })
  status!: AnswerStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
