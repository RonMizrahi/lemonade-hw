import {
  PropertyLookupInput,
  PropertyLookupResult,
  SimulatedPropertyService,
} from '../../../src/async-lookup/simulated-property.service';

/** A deterministic mock property result for integration tests. */
export const FAKE_RESULT: PropertyLookupResult = {
  dataSource: 'external',
  estimatedValue: 500000,
  squareFeet: 1800,
  yearBuilt: 2005,
  floodZone: 'X',
  roofType: 'metal',
  hazards: [],
};

/**
 * A controllable SimulatedPropertyService double for integration tests: flip `shouldFail`
 * to force guaranteed success or guaranteed failure, with no delay (fast + deterministic).
 */
export class ControllableSimulatedPropertyService implements SimulatedPropertyService {
  shouldFail = false;

  /**
   * @param _input the address input (ignored by the fake)
   * @returns the fixed fake result unless configured to fail
   * @throws Error when `shouldFail` is set
   */
  lookup(_input: PropertyLookupInput): Promise<PropertyLookupResult> {
    if (this.shouldFail) {
      return Promise.reject(new Error('Forced integration failure'));
    }
    return Promise.resolve({ ...FAKE_RESULT });
  }
}
