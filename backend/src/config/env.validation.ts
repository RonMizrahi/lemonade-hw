import * as Joi from 'joi';

/**
 * The application runtime environments.
 */
export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

const DEFAULT_HTTP_PORT = 3000;
const DEFAULT_WORKER_METRICS_PORT = 3001;
const DEFAULT_DB_PORT = 5432;
const DEFAULT_REDIS_PORT = 6379;
const DEFAULT_MAX_TRIGGERS = 3;
const DEFAULT_OUTBOX_POLL_MS = 500;
const DEFAULT_LOOKUP_MIN_MS = 3000;
const DEFAULT_LOOKUP_MAX_MS = 8000;
const DEFAULT_LOOKUP_FAILURE_RATE = 0.1;
const DEFAULT_LOOKUP_JOB_ATTEMPTS = 3;

/**
 * Joi schema validating every environment variable the app (API + worker) reads.
 * Fails fast at boot if a required value is missing or malformed.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid(...Object.values(NodeEnv))
    .default(NodeEnv.Development),
  HTTP_PORT: Joi.number().port().default(DEFAULT_HTTP_PORT),
  WORKER_METRICS_PORT: Joi.number().port().default(DEFAULT_WORKER_METRICS_PORT),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),

  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().port().default(DEFAULT_DB_PORT),
  DB_USERNAME: Joi.string().default('postgres'),
  DB_PASSWORD: Joi.string().allow('').default('postgres'),
  DB_NAME: Joi.string().default('onboarding'),

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().port().default(DEFAULT_REDIS_PORT),

  EXTERNAL_LOOKUP_MAX_TRIGGERS: Joi.number().integer().min(1).default(DEFAULT_MAX_TRIGGERS),
  OUTBOX_POLL_INTERVAL_MS: Joi.number().integer().min(50).default(DEFAULT_OUTBOX_POLL_MS),
  LOOKUP_DELAY_MIN_MS: Joi.number().integer().min(0).default(DEFAULT_LOOKUP_MIN_MS),
  LOOKUP_DELAY_MAX_MS: Joi.number().integer().min(0).default(DEFAULT_LOOKUP_MAX_MS),
  LOOKUP_FAILURE_RATE: Joi.number().min(0).max(1).default(DEFAULT_LOOKUP_FAILURE_RATE),
  LOOKUP_JOB_ATTEMPTS: Joi.number().integer().min(1).default(DEFAULT_LOOKUP_JOB_ATTEMPTS),
});
