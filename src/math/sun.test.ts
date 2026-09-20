import { describe, expect, it } from 'vitest';
import { sunDirectionEci } from './sun.ts';

describe('sunDirectionEci', () => {
  it('returns a unit vector', () => {
    const d = sunDirectionEci(new Date('2026-09-19T12:00:00Z'));
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
  });

  it('puts the sun near the equatorial plane at the September equinox', () => {
    const d = sunDirectionEci(new Date('2026-09-22T12:00:00Z'));
    const declDeg = Math.asin(d.z) * (180 / Math.PI);
    expect(Math.abs(declDeg)).toBeLessThan(1.5);
  });

  it('puts the sun far south at the December solstice', () => {
    const d = sunDirectionEci(new Date('2026-12-21T12:00:00Z'));
    const declDeg = Math.asin(d.z) * (180 / Math.PI);
    expect(declDeg).toBeLessThan(-22);
  });

  it('sweeps roughly one degree per day', () => {
    const a = sunDirectionEci(new Date('2026-09-19T12:00:00Z'));
    const b = sunDirectionEci(new Date('2026-09-20T12:00:00Z'));
    const dot = a.x * b.x + a.y * b.y + a.z * b.z;
    const deg = Math.acos(Math.min(1, dot)) * (180 / Math.PI);
    expect(deg).toBeGreaterThan(0.8);
    expect(deg).toBeLessThan(1.2);
  });
});
