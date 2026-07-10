/**
 * Strongly-typed application configuration, loaded from validated env vars.
 * Services read these via `ConfigService.get<AppConfig>('...')` — never `process.env`.
 */
export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  name: string;
}

export interface RedisConfig {
  host: string;
  port: number;
}

export interface LookupConfig {
  maxTriggers: number;
  outboxPollIntervalMs: number;
  delayMinMs: number;
  delayMaxMs: number;
  failureRate: number;
  jobAttempts: number;
}

export interface AppConfig {
  nodeEnv: string;
  httpPort: number;
  workerMetricsPort: number;
  logLevel: string;
  database: DatabaseConfig;
  redis: RedisConfig;
  lookup: LookupConfig;
}

/**
 * Reads a required string env var (Joi has already validated presence/defaults).
 * @param key the environment variable name
 * @returns the string value, or empty string if unexpectedly absent
 */
function str(key: string): string {
  const value = process.env[key];
  return value ?? '';
}

/**
 * Reads a required numeric env var (Joi has already validated it as a number).
 * @param key the environment variable name
 * @returns the parsed number, or NaN if unexpectedly absent
 */
function num(key: string): number {
  return Number(process.env[key]);
}

/**
 * Maps the validated `process.env` into the typed {@link AppConfig} tree.
 * @returns the fully-typed configuration object consumed by `@nestjs/config`.
 */
export function loadConfiguration(): AppConfig {
  return {
    nodeEnv: str('NODE_ENV'),
    httpPort: num('HTTP_PORT'),
    workerMetricsPort: num('WORKER_METRICS_PORT'),
    logLevel: str('LOG_LEVEL'),
    database: {
      host: str('DB_HOST'),
      port: num('DB_PORT'),
      username: str('DB_USERNAME'),
      password: str('DB_PASSWORD'),
      name: str('DB_NAME'),
    },
    redis: {
      host: str('REDIS_HOST'),
      port: num('REDIS_PORT'),
    },
    lookup: {
      maxTriggers: num('EXTERNAL_LOOKUP_MAX_TRIGGERS'),
      outboxPollIntervalMs: num('OUTBOX_POLL_INTERVAL_MS'),
      delayMinMs: num('LOOKUP_DELAY_MIN_MS'),
      delayMaxMs: num('LOOKUP_DELAY_MAX_MS'),
      failureRate: num('LOOKUP_FAILURE_RATE'),
      jobAttempts: num('LOOKUP_JOB_ATTEMPTS'),
    },
  };
}
