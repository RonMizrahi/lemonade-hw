import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import {
  PropertyLookupInput,
  PropertyLookupResult,
  SimulatedPropertyService,
} from './simulated-property.service';
import { DELAY_FN, DelayFn, RANDOM_SOURCE, RandomSource } from './random';

/** Deterministic mock property values returned on a successful lookup. */
const MOCK_ESTIMATED_VALUE = 450000;
const MOCK_SQUARE_FEET = 2100;
const MOCK_YEAR_BUILT = 1998;
const MOCK_FLOOD_ZONE = 'X';
const MOCK_ROOF_TYPE = 'asphalt_shingle';
const MOCK_HAZARDS = ['none'];

/**
 * The real simulated slow external property service (spec §4, §7). Waits a random
 * 3–8s (bounds from config), fails ~10% of the time (rate from config), and otherwise
 * returns mock property data. The random source and delay are injected so tests force
 * fast, deterministic success or failure.
 */
@Injectable()
export class RealSimulatedPropertyService implements SimulatedPropertyService {
  private readonly logger = new Logger(RealSimulatedPropertyService.name);
  private readonly delayMinMs: number;
  private readonly delayMaxMs: number;
  private readonly failureRate: number;

  constructor(
    config: ConfigService<AppConfig, true>,
    @Inject(RANDOM_SOURCE) private readonly random: RandomSource,
    @Inject(DELAY_FN) private readonly delay: DelayFn,
  ) {
    const lookup = config.get('lookup', { infer: true });
    this.delayMinMs = lookup.delayMinMs;
    this.delayMaxMs = lookup.delayMaxMs;
    this.failureRate = lookup.failureRate;
  }

  /**
   * Simulates a slow property lookup with a random delay and failure chance.
   * @param input the session id + address being looked up
   * @returns mock property data on success
   * @throws Error on the simulated ~10% failure
   */
  async lookup(input: PropertyLookupInput): Promise<PropertyLookupResult> {
    const span = Math.max(0, this.delayMaxMs - this.delayMinMs);
    const delayMs = Math.round(this.delayMinMs + this.random() * span);
    await this.delay(delayMs);

    if (this.random() < this.failureRate) {
      this.logger.warn(`Simulated property lookup failed for session ${input.sessionId}`);
      throw new Error('Simulated external property lookup failure');
    }

    return {
      dataSource: 'external',
      estimatedValue: MOCK_ESTIMATED_VALUE,
      squareFeet: MOCK_SQUARE_FEET,
      yearBuilt: MOCK_YEAR_BUILT,
      floodZone: MOCK_FLOOD_ZONE,
      roofType: MOCK_ROOF_TYPE,
      hazards: [...MOCK_HAZARDS],
    };
  }
}
