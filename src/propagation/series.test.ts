import { describe, expect, it } from 'vitest';
import { createPropagationCore } from './core.ts';
import { periodMinutes } from '../math/geodetic.ts';
import type { CatalogEntry, TrimmedOmm } from '../catalog/types.ts';

const ISS: TrimmedOmm = {
  OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', NORAD_CAT_ID: 25544,
  EPOCH: '2026-09-19T12:00:00.000000', MEAN_MOTION: 15.50103472,
  ECCENTRICITY: 0.0004364, INCLINATION: 51.6412, RA_OF_ASC_NODE: 247.4627,
  ARG_OF_PERICENTER: 130.5360, MEAN_ANOMALY: 325.0288, BSTAR: 0.00023844,
  MEAN_MOTION_DOT: 0.00012353, MEAN_MOTION_DDOT: 0, ELEMENT_SET_NO: 999,
};
const entry = (omm: TrimmedOmm): CatalogEntry => ({
  omm,
  meta: {
    objectType: null, owner: null, ownerName: null, launchDate: null,
    apogeeKm: null, perigeeKm: null,
  },
});
const START = Date.parse('2026-09-19T13:30:00.000Z');

describe('PropagationCore.series', () => {
  it('returns the requested number of samples', async () => {
    const core = await createPropagationCore([entry(ISS)]);
    const s = core.series(0, START, 200)!;
    expect(s.samples).toHaveLength(200 * 3);
    expect(s.epochMs).toHaveLength(200);
    core.dispose();
  });

  it('spans one full orbital period', async () => {
    const core = await createPropagationCore([entry(ISS)]);
    const s = core.series(0, START, 200)!;
    expect(s.periodMinutes).toBeCloseTo(periodMinutes(ISS.MEAN_MOTION), 3);
    const spanMin = (s.epochMs[199]! - s.epochMs[0]!) / 60_000;
    expect(spanMin).toBeCloseTo(s.periodMinutes, 0);
    core.dispose();
  });

  it('closes the loop — last sample returns near the first', async () => {
    const core = await createPropagationCore([entry(ISS)]);
    const s = core.series(0, START, 200)!;
    const d = Math.hypot(
      s.samples[597]! - s.samples[0]!,
      s.samples[598]! - s.samples[1]!,
      s.samples[599]! - s.samples[2]!,
    );
    expect(d).toBeLessThan(400);
    core.dispose();
  });

  it('keeps every sample at a plausible orbital radius', async () => {
    const core = await createPropagationCore([entry(ISS)]);
    const s = core.series(0, START, 200)!;
    for (let i = 0; i < 200; i++) {
      const r = Math.hypot(s.samples[i * 3]!, s.samples[i * 3 + 1]!, s.samples[i * 3 + 2]!);
      expect(r).toBeGreaterThan(6600);
      expect(r).toBeLessThan(6900);
    }
    core.dispose();
  });

  it('returns null for an out-of-range catalog index rather than throwing', async () => {
    const core = await createPropagationCore([entry(ISS)]);
    expect(core.series(99, START, 200)).toBeNull();
    expect(core.series(-1, START, 200)).toBeNull();
    core.dispose();
  });
});
