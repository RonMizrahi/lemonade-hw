import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * A stored idempotency record for a `POST` write. First call executes and stores the
 * response; replays with the same key + same body replay it; same key + different body
 * ⇒ 422 (via `request_hash` mismatch). Key is globally unique (spec §5, §6).
 */
@Entity({ name: 'idempotency_key' })
@Unique('uq_idempotency_key', ['key'])
export class IdempotencyKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Client-supplied `Idempotency-Key` header value. */
  @Column({ type: 'text' })
  key!: string;

  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;

  /** Hash of method+path+body; mismatch on the same key ⇒ 422. */
  @Column({ name: 'request_hash', type: 'text' })
  requestHash!: string;

  /** Stored response body, replayed verbatim on a matching retry. */
  @Column({ type: 'jsonb' })
  response!: unknown;

  @Column({ name: 'status_code', type: 'int' })
  statusCode!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
