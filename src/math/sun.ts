import { jday, sunPos } from 'satellite.js';

/**
 * Unit vector from Earth to the Sun in the ECI frame.
 *
 * `sunPos` returns a geocentric position in AU whose magnitude varies with
 * Earth's orbital distance (~0.983 to ~1.017 AU), so it must be normalised
 * before use as a light direction.
 */
export function sunDirectionEci(date: Date): { x: number; y: number; z: number } {
  const { rsun } = sunPos(jday(date));
  const m = Math.hypot(rsun.x, rsun.y, rsun.z);
  return { x: rsun.x / m, y: rsun.y / m, z: rsun.z / m };
}
