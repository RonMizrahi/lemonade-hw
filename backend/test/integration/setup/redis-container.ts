import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';

const REDIS_IMAGE = 'redis:7-alpine';

/**
 * A started Redis container plus its connection coordinates, for integration tests.
 */
export interface StartedRedis {
  container: StartedRedisContainer;
  host: string;
  port: number;
}

/**
 * Starts a throwaway Redis 7 container and exports its coordinates into `process.env`
 * so the BullMQ connection (OutboxRelay + LookupProcessor) picks them up.
 * @returns the started container coordinates
 */
export async function startRedis(): Promise<StartedRedis> {
  const container = await new RedisContainer(REDIS_IMAGE).start();
  const coords: StartedRedis = {
    container,
    host: container.getHost(),
    port: container.getPort(),
  };

  process.env.REDIS_HOST = coords.host;
  process.env.REDIS_PORT = String(coords.port);

  return coords;
}
