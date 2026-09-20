import { propagate, type SatRec } from 'satellite.js';
import type { EciVec3, Kilometer, KilometerPerSecond } from 'satellite.js';

export interface State {
  p: EciVec3<Kilometer>;
  v: EciVec3<KilometerPerSecond>;
}

/**
 * Propagate and assert success.
 *
 * `propagate` returns null when SGP4 rejects the elements. Test fixtures are
 * chosen to be propagable, so a null here is a broken fixture and should fail
 * loudly rather than be silently cast away.
 */
export function stateAt(rec: SatRec, date: Date): State {
  const result = propagate(rec, date);
  if (result === null) {
    throw new Error(`propagation failed at ${date.toISOString()}`);
  }
  return { p: result.position, v: result.velocity };
}
