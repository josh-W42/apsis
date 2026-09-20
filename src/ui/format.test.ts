import { describe, expect, it } from 'vitest';
import { formatKm, formatLatLon, formatPeriod, resultSummary } from './format.ts';
import type { SearchOutcome } from '../catalog/search.ts';

const outcome = (n: number, total: number, truncated: boolean): SearchOutcome => ({
  hits: Array.from({ length: n }, () => ({ catalogIndex: 0, entry: {} as never })),
  totalMatches: total,
  truncated,
});

describe('formatKm', () => {
  it('formats with one decimal by default', () => {
    expect(formatKm(419.3421)).toBe('419.3 km');
  });

  it('honours a digit count', () => {
    expect(formatKm(7.66312, 3)).toBe('7.663 km');
  });

  it('renders null as an em dash rather than "null km"', () => {
    expect(formatKm(null)).toBe('—');
  });

  it('groups thousands so GEO altitudes stay readable', () => {
    expect(formatKm(35786)).toBe('35,786.0 km');
  });
});

describe('formatLatLon', () => {
  it('uses hemisphere letters, not signs', () => {
    expect(formatLatLon(-12.404, 147.881)).toBe('12.404°S 147.881°E');
    expect(formatLatLon(51.63, -0.12)).toBe('51.630°N 0.120°W');
  });

  it('treats the equator and prime meridian as positive hemispheres', () => {
    expect(formatLatLon(0, 0)).toBe('0.000°N 0.000°E');
  });
});

describe('formatPeriod', () => {
  it('shows minutes for a LEO orbit', () => {
    // Deliberately off a .x5 rounding boundary — this test is about the
    // format, not about float-to-decimal rounding behaviour.
    expect(formatPeriod(92.94)).toBe('92.9 min');
  });

  it('adds an hour breakdown once the period passes two hours', () => {
    expect(formatPeriod(1436)).toBe('1436.0 min (23h 56m)');
  });
});

describe('resultSummary', () => {
  it('is null when nothing was truncated — no noise for small results', () => {
    expect(resultSummary(outcome(3, 3, false))).toBeNull();
  });

  it('reports the remainder when truncated', () => {
    expect(resultSummary(outcome(20, 11114, true))).toBe('and 11,094 more');
  });

  it('uses the singular for exactly one more', () => {
    expect(resultSummary(outcome(20, 21, true))).toBe('and 1 more');
  });

  it('is null for an empty outcome', () => {
    expect(resultSummary(outcome(0, 0, false))).toBeNull();
  });
});
