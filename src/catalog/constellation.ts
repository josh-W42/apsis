import { classifyRegime } from './regime.ts';

export type ConstellationBucket =
  | 'starlink' | 'oneweb' | 'gnss' | 'geo' | 'other';

/**
 * Canonical order. The shader palette is an array indexed by this order, so
 * changing it changes the colours — keep them in step.
 */
export const BUCKETS: readonly ConstellationBucket[] = [
  'starlink', 'oneweb', 'gnss', 'geo', 'other',
];

export function bucketIndex(bucket: ConstellationBucket): number {
  return BUCKETS.indexOf(bucket);
}

/**
 * Constellation prefixes are anchored so "SUPERSTARLINKER" does not match
 * "STARLINK".
 */
const STARLINK = /^STARLINK\b/;
const ONEWEB = /^ONEWEB\b/;

/**
 * GNSS is deliberately NOT anchored, only word-bounded.
 *
 * GLONASS and Galileo satellites are catalogued under other designations
 * with the family name in a bracketed suffix — "COSMOS 2433 [GLONASS-M]",
 * "GSAT0101 (GALILEO-PFM)". Anchoring this dropped 61 real GNSS satellites
 * into `other`. Word boundaries still prevent matching inside a longer
 * token such as "GPSAT".
 */
const GNSS = /\b(GPS|NAVSTAR|GLONASS|GALILEO|BEIDOU)\b/;

/**
 * Bucket an object for colour-coding.
 *
 * Precedence is name first, orbit second. That ordering is deliberate and it
 * makes this disagree with `classifyRegime`: 22 BeiDou satellites sit at
 * geostationary altitude but bucket as `gnss`, because as a visual grouping
 * they belong with the rest of their constellation.
 *
 * Name matching is inherently fragile — new constellations launch and naming
 * changes. It degrades to `other` rather than failing.
 */
export function classifyConstellation(
  name: string, apogeeKm: number | null, perigeeKm: number | null,
): ConstellationBucket {
  const n = name.toUpperCase();
  if (STARLINK.test(n)) return 'starlink';
  if (ONEWEB.test(n)) return 'oneweb';
  if (GNSS.test(n)) return 'gnss';
  if (classifyRegime(apogeeKm, perigeeKm) === 'GEO') return 'geo';
  return 'other';
}
