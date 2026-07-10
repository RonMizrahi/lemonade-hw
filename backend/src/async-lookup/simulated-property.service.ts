/**
 * DI token for the simulated external property service.
 */
export const SIMULATED_PROPERTY_SERVICE = Symbol('SIMULATED_PROPERTY_SERVICE');

/**
 * The address input to a property lookup.
 */
export interface PropertyLookupInput {
  sessionId: string;
  address: unknown;
}

/**
 * The mock property data returned on a successful lookup (spec §7).
 */
export interface PropertyLookupResult {
  dataSource: 'external';
  estimatedValue: number;
  squareFeet: number;
  yearBuilt: number;
  floodZone: string;
  roofType: string;
  hazards: string[];
}

/**
 * The simulated slow external property service (spec §4, §7): random 3–8s delay and ~10%
 * failure, both injectable for deterministic tests.
 */
export interface SimulatedPropertyService {
  /**
   * @param input the address to look up
   * @returns the mock property data on success
   * @throws Error to simulate a transient failure
   */
  lookup(input: PropertyLookupInput): Promise<PropertyLookupResult>;
}
