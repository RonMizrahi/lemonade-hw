import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Initial schema: creates all six tables (spec §5) with their enums, FKs, unique
 * constraints, and the outbox relay index. Schema is migration-owned (synchronize:false).
 */
export class Init1720000000000 implements MigrationInterface {
  name = 'Init1720000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- enum types ---
    await queryRunner.query(
      `CREATE TYPE "session_status_enum" AS ENUM('in_progress', 'completed')`,
    );
    await queryRunner.query(`CREATE TYPE "answer_status_enum" AS ENUM('active', 'irrelevant')`);
    await queryRunner.query(
      `CREATE TYPE "external_lookup_status_enum" AS ENUM('not_started', 'loading', 'completed', 'failed', 'permanently_failed')`,
    );
    await queryRunner.query(`CREATE TYPE "outbox_status_enum" AS ENUM('pending', 'published')`);

    // --- flow_version ---
    await queryRunner.createTable(
      new Table({
        name: 'flow_version',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'version', type: 'int' },
          { name: 'definition', type: 'jsonb' },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
        ],
        uniques: [{ name: 'uq_flow_version_version', columnNames: ['version'] }],
      }),
      true,
    );

    // --- onboarding_session ---
    await queryRunner.createTable(
      new Table({
        name: 'onboarding_session',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'status',
            type: 'session_status_enum',
            enum: ['in_progress', 'completed'],
            default: `'in_progress'`,
          },
          { name: 'flow_version_id', type: 'uuid' },
          { name: 'version', type: 'int', default: 1 },
          { name: 'summary', type: 'jsonb', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
          { name: 'completed_at', type: 'timestamptz', isNullable: true },
        ],
        foreignKeys: [
          {
            name: 'fk_session_flow_version',
            columnNames: ['flow_version_id'],
            referencedTableName: 'flow_version',
            referencedColumnNames: ['id'],
            onDelete: 'RESTRICT',
          },
        ],
      }),
      true,
    );

    // --- answer ---
    await queryRunner.createTable(
      new Table({
        name: 'answer',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'session_id', type: 'uuid' },
          { name: 'question_id', type: 'text' },
          { name: 'value', type: 'jsonb' },
          {
            name: 'status',
            type: 'answer_status_enum',
            enum: ['active', 'irrelevant'],
            default: `'active'`,
          },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
        foreignKeys: [
          {
            name: 'fk_answer_session',
            columnNames: ['session_id'],
            referencedTableName: 'onboarding_session',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
        uniques: [
          { name: 'uq_answer_session_question', columnNames: ['session_id', 'question_id'] },
        ],
      }),
      true,
    );

    // --- external_lookup ---
    await queryRunner.createTable(
      new Table({
        name: 'external_lookup',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'session_id', type: 'uuid' },
          {
            name: 'status',
            type: 'external_lookup_status_enum',
            enum: ['not_started', 'loading', 'completed', 'failed', 'permanently_failed'],
            default: `'not_started'`,
          },
          { name: 'generation', type: 'int', default: 0 },
          { name: 'triggers', type: 'int', default: 0 },
          { name: 'max_triggers', type: 'int', default: 3 },
          { name: 'job_attempts', type: 'int', default: 0 },
          { name: 'result', type: 'jsonb', isNullable: true },
          { name: 'error', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
          { name: 'last_attempt_at', type: 'timestamptz', isNullable: true },
        ],
        foreignKeys: [
          {
            name: 'fk_external_lookup_session',
            columnNames: ['session_id'],
            referencedTableName: 'onboarding_session',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
        uniques: [{ name: 'uq_external_lookup_session', columnNames: ['session_id'] }],
      }),
      true,
    );

    // --- outbox_event ---
    await queryRunner.createTable(
      new Table({
        name: 'outbox_event',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'aggregate_type', type: 'text' },
          { name: 'aggregate_id', type: 'uuid' },
          { name: 'type', type: 'text' },
          { name: 'payload', type: 'jsonb' },
          {
            name: 'status',
            type: 'outbox_status_enum',
            enum: ['pending', 'published'],
            default: `'pending'`,
          },
          { name: 'publish_attempts', type: 'int', default: 0 },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'published_at', type: 'timestamptz', isNullable: true },
        ],
      }),
      true,
    );
    await queryRunner.createIndex(
      'outbox_event',
      new TableIndex({
        name: 'ix_outbox_status_created_at',
        columnNames: ['status', 'created_at'],
      }),
    );

    // --- idempotency_key ---
    await queryRunner.createTable(
      new Table({
        name: 'idempotency_key',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'key', type: 'text' },
          { name: 'session_id', type: 'uuid' },
          { name: 'request_hash', type: 'text' },
          { name: 'response', type: 'jsonb' },
          { name: 'status_code', type: 'int' },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
        ],
        uniques: [{ name: 'uq_idempotency_key', columnNames: ['key'] }],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('idempotency_key', true);
    await queryRunner.dropIndex('outbox_event', 'ix_outbox_status_created_at');
    await queryRunner.dropTable('outbox_event', true);
    await queryRunner.dropTable('external_lookup', true);
    await queryRunner.dropTable('answer', true);
    await queryRunner.dropTable('onboarding_session', true);
    await queryRunner.dropTable('flow_version', true);

    await queryRunner.query(`DROP TYPE IF EXISTS "outbox_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "external_lookup_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "answer_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "session_status_enum"`);
  }
}
