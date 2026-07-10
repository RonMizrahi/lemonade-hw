import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from '../../src/database/entities';
import { Init1720000000000 } from '../../src/database/migrations/1720000000000-init';
import { runMigrations, startPostgres, StartedPostgres } from './setup/postgres-container';

const EXPECTED_TABLES = [
  'flow_version',
  'onboarding_session',
  'answer',
  'external_lookup',
  'outbox_event',
  'idempotency_key',
];

interface TableNameRow {
  table_name: string;
}

interface IndexNameRow {
  indexname: string;
}

describe('Migration 0001-init (Testcontainers Postgres)', () => {
  let coords: StartedPostgres;
  let dataSource: DataSource;

  beforeAll(async () => {
    coords = await startPostgres();
    await runMigrations(coords);

    dataSource = new DataSource({
      type: 'postgres',
      host: coords.host,
      port: coords.port,
      username: coords.username,
      password: coords.password,
      database: coords.database,
      entities: ALL_ENTITIES,
      migrations: [Init1720000000000],
      synchronize: false,
    });
    await dataSource.initialize();
  }, 120000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
    await coords.container.stop();
  });

  it.each(EXPECTED_TABLES)('creates the "%s" table', async (table) => {
    const rows = await dataSource.query<TableNameRow[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].table_name).toBe(table);
  });

  it('creates exactly the six expected tables', async () => {
    const rows = await dataSource.query<TableNameRow[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'migrations'`,
    );

    const names = rows.map((row) => row.table_name).sort();
    expect(names).toEqual([...EXPECTED_TABLES].sort());
  });

  it('creates the outbox relay index on (status, created_at)', async () => {
    const rows = await dataSource.query<IndexNameRow[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'outbox_event' AND indexname = 'ix_outbox_status_created_at'`,
    );

    expect(rows).toHaveLength(1);
  });

  it('enforces the unique(session_id, question_id) constraint on answer', async () => {
    const constraints = await dataSource.query<{ conname: string }[]>(
      `SELECT conname FROM pg_constraint WHERE conname = 'uq_answer_session_question'`,
    );

    expect(constraints).toHaveLength(1);
  });
});
