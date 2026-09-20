import { degreesLat, degreesLong, eciToGeodetic, gstime } from 'satellite.js';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface LiveState {
  /** WGS84 geodetic height above the ellipsoid, km. */
  altitudeKm: number;
  speedKmS: number;
  latDeg: number;
  lonDeg: number;
}

/**
 * Derive the values the detail panel shows live.
 *
 * Altitude is the geodetic height from `eciToGeodetic`, not `|r| - 6371`.
 * The earth is an ellipsoid and the two differ by about 5.7 km for the ISS —
 * enough to be visibly wrong in a panel that quotes a number.
 */
export function liveState(
  positionEciKm: Vec3, velocityEciKmS: Vec3, date: Date,
): LiveState {
  const geodetic = eciToGeodetic(positionEciKm, gstime(date));
  return {
    altitudeKm: geodetic.height,
    speedKmS: Math.hypot(velocityEciKmS.x, velocityEciKmS.y, velocityEciKmS.z),
    latDeg: degreesLat(geodetic.latitude),
    lonDeg: degreesLong(geodetic.longitude),
  };
}

/** Orbital period from SGP4 mean motion in revolutions per day. */
export function periodMinutes(meanMotion: number): number {
  return 1440 / meanMotion;
}
