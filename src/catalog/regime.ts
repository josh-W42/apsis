export type OrbitRegime = 'LEO' | 'MEO' | 'GEO' | 'HEO' | 'UNKNOWN';

/** Geostationary altitude, km. */
const GEO_ALTITUDE = 35_786;
/** How close to GEO altitude both apsides must sit to count as geostationary. */
const GEO_TOLERANCE = 500;
/** Apogee-perigee spread above which an orbit is highly elliptical. */
const HEO_SPREAD = 5_000;
/** Apogee below which an orbit is low earth. */
const LEO_CEILING = 2_000;

/**
 * Classify an orbit from its apsides.
 *
 * Eccentricity is tested before altitude: a Molniya orbit reaches GEO
 * altitude at apogee but is not geostationary, and calling it GEO would be
 * actively misleading in the panel.
 */
export function classifyRegime(
  apogeeKm: number | null, perigeeKm: number | null,
): OrbitRegime {
  if (apogeeKm === null || perigeeKm === null) return 'UNKNOWN';
  if (apogeeKm - perigeeKm > HEO_SPREAD) return 'HEO';
  if (Math.abs(apogeeKm - GEO_ALTITUDE) < GEO_TOLERANCE &&
      Math.abs(perigeeKm - GEO_ALTITUDE) < GEO_TOLERANCE) return 'GEO';
  if (apogeeKm < LEO_CEILING) return 'LEO';
  return 'MEO';
}

const LABELS: Record<OrbitRegime, string> = {
  LEO: 'Low Earth orbit',
  MEO: 'Medium Earth orbit',
  GEO: 'Geostationary orbit',
  HEO: 'Highly elliptical orbit',
  UNKNOWN: 'Unknown orbit',
};

export function regimeLabel(regime: OrbitRegime): string {
  return LABELS[regime];
}
