import type { Config } from 'jest';

/**
 * Jest configuration with three separate projects:
 * - unit: `*.spec.ts` under `src/` — pure logic, no I/O.
 * - integration: `*.int-spec.ts` under `test/integration/` — Testcontainers Postgres/Redis.
 * - e2e: `*.e2e-spec.ts` under `test/e2e/` — full HTTP journeys (added in later milestones).
 */
const tsJestTransform: Config['transform'] = {
  '^.+\\.ts$': [
    'ts-jest',
    {
      tsconfig: 'tsconfig.json',
    },
  ],
};

const config: Config = {
  projects: [
    {
      displayName: 'unit',
      rootDir: '.',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      moduleFileExtensions: ['js', 'json', 'ts'],
      transform: tsJestTransform,
    },
    {
      displayName: 'integration',
      rootDir: '.',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
      moduleFileExtensions: ['js', 'json', 'ts'],
      transform: tsJestTransform,
      testTimeout: 120000,
    },
    {
      displayName: 'e2e',
      rootDir: '.',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
      moduleFileExtensions: ['js', 'json', 'ts'],
      transform: tsJestTransform,
      testTimeout: 180000,
    },
  ],
};

export default config;
