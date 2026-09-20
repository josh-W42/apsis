import { describe, expect, it } from 'vitest';
import { dayFactor, TERMINATOR_END, TERMINATOR_START } from './day-night.ts';

describe('dayFactor', () => {
  it('is fully night facing directly away from the sun', () => {
    expect(dayFactor(-1)).toBe(0);
  });

  it('is fully day facing directly at the sun', () => {
    expect(dayFactor(1)).toBe(1);
  });

  it('is between the two across the terminator band', () => {
    const mid = (TERMINATOR_START + TERMINATOR_END) / 2;
    const f = dayFactor(mid);
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(1);
  });

  it('increases monotonically with sun angle', () => {
    let previous = -1;
    for (let d = -1; d <= 1.0001; d += 0.05) {
      const f = dayFactor(d);
      expect(f).toBeGreaterThanOrEqual(previous);
      previous = f;
    }
  });

  it('clamps outside the band rather than extrapolating', () => {
    expect(dayFactor(TERMINATOR_START - 0.5)).toBe(0);
    expect(dayFactor(TERMINATOR_END + 0.5)).toBe(1);
  });

  it('puts the terminator slightly past geometric sunset, as atmosphere does', () => {
    // Real twilight means the surface is still lit a little after the sun
    // drops below the horizon, so the band starts below zero.
    expect(TERMINATOR_START).toBeLessThan(0);
    expect(TERMINATOR_END).toBeGreaterThan(0);
  });

  it('is smooth — no hard step at the band edges', () => {
    const eps = 1e-4;
    for (const edge of [TERMINATOR_START, TERMINATOR_END]) {
      const jump = Math.abs(dayFactor(edge + eps) - dayFactor(edge - eps));
      expect(jump).toBeLessThan(1e-3);
    }
  });
});
