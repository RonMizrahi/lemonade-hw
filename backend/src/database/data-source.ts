import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import { ALL_ENTITIES } from './entities';

loadDotenv();

const DEFAULT_DB_PORT = 5432;

/**
 * Builds the TypeORM DataSource options from the environment. `synchronize` is always
 * false — schema is owned exclusively by migrations (spec §2, §5). Shared by the Nest
 * runtime and the TypeORM CLI (migrations/seed).
 * @returns the fully-resolved DataSource options.
 */
export function buildDataSourceOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : DEFAULT_DB_PORT,
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'onboarding',
    entities: ALL_ENTITIES,
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    synchronize: false,
    logging: false,
  };
}

/**
 * The DataSource instance the TypeORM CLI targets (migration:run/generate/revert, seed).
 */
export const AppDataSource = new DataSource(buildDataSourceOptions());
