import { describe, expect, it } from 'vitest';
import { json2satrec } from 'satellite.js';
import { stateAt } from '../test-support/state.ts';
import { hermite } from './hermite.ts';
import type { TrimmedOmm } from '../catalog/types.ts';

const ISS: TrimmedOmm = {
  OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', NORAD_CAT_ID: 25544,
  EPOCH: '2026-09-19T12:00:00.000000', MEAN_MOTION: 15.50103472,
  ECCENTRICITY: 0.0004364, INCLINATION: 51.6412, RA_OF_ASC_NODE: 247.4627,
  ARG_OF_PERICENTER: 130.5360, MEAN_ANOMALY: 325.0288, BSTAR: 0.00023844,
  MEAN_MOTION_DOT: 0.00012353, MEAN_MOTION_DDOT: 0, ELEMENT_SET_NO: 999,
};

describe('hermite', () => {
  it('reproduces the endpoints exactly', () => {
    expect(hermite(10, 2, 20, 3, 0, 1)).toBeCloseTo(10, 10);
    expect(hermite(10, 2, 20, 3, 1, 1)).toBeCloseTo(20, 10);
  });

  it('honours the endpoint tangents', () => {
    expect(hermite(0, 1, 1, 1, 0.5, 1)).toBeCloseTo(0.5, 10);
  });

  it('is exact for a cubic, which linear interpolation is not', () => {
    const f = (t: number) => 2 * t ** 3 - t ** 2 + 3 * t + 1;
    const df = (t: number) => 6 * t ** 2 - 2 * t + 3;
    const [t0, t1] = [1, 3];
    const h = t1 - t0;
    for (const s of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(hermite(f(t0), df(t0), f(t1), df(t1), s, h))
        .toBeCloseTo(f(t0 + s * h), 8);
    }
  });

  it('tracks a real LEO orbit to within 10 m across a 1 s tick', () => {
    const rec = json2satrec(ISS);
    const t0 = new Date('2026-09-19T13:30:00.000Z');
    const t1 = new Date(t0.getTime() + 1000);
    const mid = new Date(t0.getTime() + 500);

    const a = stateAt(rec, t0), b = stateAt(rec, t1), m = stateAt(rec, mid);

    for (const axis of ['x', 'y', 'z'] as const) {
      const got = hermite(a.p[axis], a.v[axis], b.p[axis], b.v[axis], 0.5, 1);
      expect(Math.abs(got - m.p[axis])).toBeLessThan(0.01); // km == 10 m
    }
  });

  it('beats linear interpolation on a 10 s tick, where linear degrades badly', () => {
    const rec = json2satrec(ISS);
    const t0 = new Date('2026-09-19T13:30:00.000Z');
    const t1 = new Date(t0.getTime() + 10_000);
    const mid = new Date(t0.getTime() + 5_000);
    const a = stateAt(rec, t0), b = stateAt(rec, t1), m = stateAt(rec, mid);

    const linear = a.p.x + (b.p.x - a.p.x) * 0.5;
    const cubic = hermite(a.p.x, a.v.x, b.p.x, b.v.x, 0.5, 10);
    expect(Math.abs(cubic - m.p.x)).toBeLessThan(Math.abs(linear - m.p.x));
  });
});
