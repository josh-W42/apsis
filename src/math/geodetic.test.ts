import { describe, expect, it } from 'vitest';
import { json2satrec } from 'satellite.js';
import { liveState, periodMinutes } from './geodetic.ts';
import { stateAt } from '../test-support/state.ts';
import type { TrimmedOmm } from '../catalog/types.ts';

const ISS: TrimmedOmm = {
  OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', NORAD_CAT_ID: 25544,
  EPOCH: '2026-09-19T12:00:00.000000', MEAN_MOTION: 15.50103472,
  ECCENTRICITY: 0.0004364, INCLINATION: 51.6412, RA_OF_ASC_NODE: 247.4627,
  ARG_OF_PERICENTER: 130.5360, MEAN_ANOMALY: 325.0288, BSTAR: 0.00023844,
  MEAN_MOTION_DOT: 0.00012353, MEAN_MOTION_DDOT: 0, ELEMENT_SET_NO: 999,
};
const AT = new Date('2026-09-19T13:30:00.000Z');

describe('liveState', () => {
  it('reports a plausible ISS altitude', () => {
    const { p, v } = stateAt(json2satrec(ISS), AT);
    const s = liveState(p, v, AT);
    expect(s.altitudeKm).toBeGreaterThan(380);
    expect(s.altitudeKm).toBeLessThan(460);
  });

  it('uses WGS84 geodetic height, not the spherical approximation', () => {
    // These differ by ~5.7 km for the ISS. Showing |r|-6371 in the panel
    // would be visibly wrong, so this asserts they are NOT equal.
    const { p, v } = stateAt(json2satrec(ISS), AT);
    const spherical = Math.hypot(p.x, p.y, p.z) - 6371;
    expect(Math.abs(liveState(p, v, AT).altitudeKm - spherical)).toBeGreaterThan(1);
  });

  it('reports orbital speed matching the velocity vector magnitude', () => {
    const { p, v } = stateAt(json2satrec(ISS), AT);
    expect(liveState(p, v, AT).speedKmS).toBeCloseTo(Math.hypot(v.x, v.y, v.z), 9);
  });

  it('keeps the ground point inside the orbit inclination band', () => {
    const rec = json2satrec(ISS);
    for (let m = 0; m < 95; m += 5) {
      const t = new Date(AT.getTime() + m * 60_000);
      const { p, v } = stateAt(rec, t);
      expect(Math.abs(liveState(p, v, t).latDeg)).toBeLessThanOrEqual(52.2);
    }
  });

  it('keeps longitude in [-180, 180]', () => {
    const rec = json2satrec(ISS);
    for (let m = 0; m < 95; m += 5) {
      const t = new Date(AT.getTime() + m * 60_000);
      const { p, v } = stateAt(rec, t);
      const lon = liveState(p, v, t).lonDeg;
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
    }
  });

  it('moves the ground point westward relative to inertial space as earth turns', () => {
    const { p, v } = stateAt(json2satrec(ISS), AT);
    const a = liveState(p, v, AT);
    const b = liveState(p, v, new Date(AT.getTime() + 3_600_000));
    let d = a.lonDeg - b.lonDeg;
    while (d < -180) d += 360;
    while (d > 180) d -= 360;
    expect(Math.abs(d)).toBeGreaterThan(14);
    expect(Math.abs(d)).toBeLessThan(16);
  });
});

describe('periodMinutes', () => {
  it('converts the ISS mean motion to about 93 minutes', () => {
    expect(periodMinutes(15.50103472)).toBeCloseTo(92.9, 1);
  });

  it('gives a geostationary satellite roughly a sidereal day', () => {
    expect(periodMinutes(1.0027)).toBeCloseTo(1436, 0);
  });
});
