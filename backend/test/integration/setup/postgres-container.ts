import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from '../../../src/database/entities';
import { Init1720000000000 } from '../../../src/database/migrations/1720000000000-init';

const POSTGRES_IMAGE = 'postgres:16-alpine';

/**
 * A started Postgres container plus its connection coordinates, for integration tests.
 */
export interface StartedPostgres {
  container: StartedPostgreSqlContainer;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

/**
 * Starts a throwaway Postgres 16 container and exports its coordinates into `process.env`
 * so the Nest DatabaseModule and the DataSource pick them up.
 * @returns the started container coordinates
 */
export async function startPostgres(): Promise<StartedPostgres> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const coords: StartedPostgres = {
    container,
    host: container.getHost(),
    port: container.getPort(),
    username: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
  };

  process.env.DB_HOST = coords.host;
  process.env.DB_PORT = String(coords.port);
  process.env.DB_USERNAME = coords.username;
  process.env.DB_PASSWORD = coords.password;
  process.env.DB_NAME = coords.database;

  return coords;
}

/**
 * Runs the initial migration against the container using a dedicated DataSource.
 * @param coords the container coordinates
 * @returns resolves once all six tables exist
 */
export async function runMigrations(coords: StartedPostgres): Promise<void> {
  const dataSource = new DataSource({
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
  await dataSource.runMigrations();
  await dataSource.destroy();
}
