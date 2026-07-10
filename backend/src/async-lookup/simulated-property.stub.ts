import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  PropertyLookupInput,
  PropertyLookupResult,
  SimulatedPropertyService,
} from './simulated-property.service';

/**
 * M1 stub of the {@link SimulatedPropertyService}. Bound to the token so the DI graph
 * resolves; M4 replaces it with the real 3–8s / ~10%-fail simulation.
 */
@Injectable()
export class StubSimulatedPropertyService implements SimulatedPropertyService {
  /**
   * @param _input the address to look up
   * @returns never — throws until implemented
   * @throws NotImplementedException always (M4 implements the simulation)
   */
  lookup(_input: PropertyLookupInput): Promise<PropertyLookupResult> {
    throw new NotImplementedException('SimulatedPropertyService is implemented in M4');
  }
}
