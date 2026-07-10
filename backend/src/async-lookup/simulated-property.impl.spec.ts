import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AppConfig, LookupConfig } from '../config/configuration';
import { RealSimulatedPropertyService } from './simulated-property.impl';
import { RandomSource } from './random';

const LOOKUP_CONFIG: LookupConfig = {
  maxTriggers: 3,
  outboxPollIntervalMs: 500,
  delayMinMs: 3000,
  delayMaxMs: 8000,
  failureRate: 0.1,
  jobAttempts: 3,
};

/**
 * Builds a ConfigService stub returning the fixed lookup config.
 */
function buildConfig(): ConfigService<AppConfig, true> {
  return {
    get: jest.fn().mockReturnValue(LOOKUP_CONFIG),
  } as unknown as ConfigService<AppConfig, true>;
}

/**
 * Builds the service with an injected random source; delay is a no-op so tests are fast.
 */
function buildService(random: RandomSource): RealSimulatedPropertyService {
  return new RealSimulatedPropertyService(buildConfig(), random, () => Promise.resolve());
}

describe('RealSimulatedPropertyService', () => {
  it('returns mock property data on a successful roll (below failure rate not hit)', async () => {
    // second random() = 0.99 > 0.1 failure rate → success
    const rolls = [0, 0.99];
    const service = buildService(() => rolls.shift() ?? 0.99);

    const result = await service.lookup({ sessionId: randomUUID(), address: '1 Main St' });

    expect(result.dataSource).toBe('external');
    expect(result.estimatedValue).toBeGreaterThan(0);
    expect(Array.isArray(result.hazards)).toBe(true);
  });

  it('throws a simulated failure when the roll lands under the failure rate', async () => {
    // second random() = 0.05 < 0.1 failure rate → failure
    const rolls = [0.5, 0.05];
    const service = buildService(() => rolls.shift() ?? 0);

    await expect(service.lookup({ sessionId: randomUUID(), address: '1 Main St' })).rejects.toThrow(
      /failure/i,
    );
  });

  it('delays within the configured bounds (min at roll 0, max at roll ~1)', async () => {
    const delays: number[] = [];
    const delayFn = (ms: number): Promise<void> => {
      delays.push(ms);
      return Promise.resolve();
    };
    const config = buildConfig();

    const atMin = new RealSimulatedPropertyService(config, () => 0, delayFn);
    await atMin.lookup({ sessionId: randomUUID(), address: 'x' }).catch(() => undefined);
    const atMax = new RealSimulatedPropertyService(config, () => 0.999999, delayFn);
    await atMax.lookup({ sessionId: randomUUID(), address: 'x' }).catch(() => undefined);

    expect(delays[0]).toBe(LOOKUP_CONFIG.delayMinMs);
    expect(delays[1]).toBeGreaterThanOrEqual(LOOKUP_CONFIG.delayMinMs);
    expect(delays[1]).toBeLessThanOrEqual(LOOKUP_CONFIG.delayMaxMs);
  });
});
