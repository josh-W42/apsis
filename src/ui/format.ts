import type { SearchOutcome } from '../catalog/search.ts';

export type TrackingStatus = 'TRACKING' | 'ERROR' | 'STALE';

const EM_DASH = '—';

export function formatKm(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH;
  return `${value.toLocaleString('en-US', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  })} km`;
}

/** Hemisphere letters rather than signs — easier to read at a glance. */
export function formatLatLon(latDeg: number, lonDeg: number): string {
  const lat = `${Math.abs(latDeg).toFixed(3)}°${latDeg < 0 ? 'S' : 'N'}`;
  const lon = `${Math.abs(lonDeg).toFixed(3)}°${lonDeg < 0 ? 'W' : 'E'}`;
  return `${lat} ${lon}`;
}

export function formatPeriod(minutes: number): string {
  const base = `${minutes.toFixed(1)} min`;
  if (minutes < 120) return base;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return `${base} (${h}h ${m}m)`;
}

/**
 * The "and N more" line. Null when nothing was cut, so a three-result search
 * does not carry a pointless footer.
 */
export function resultSummary(outcome: SearchOutcome): string | null {
  if (!outcome.truncated) return null;
  const remainder = outcome.totalMatches - outcome.hits.length;
  if (remainder <= 0) return null;
  return `and ${remainder.toLocaleString('en-US')} more`;
}
