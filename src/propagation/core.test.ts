import { describe, expect, it } from 'vitest';
import { json2satrec } from 'satellite.js';
import { stateAt } from '../test-support/state.ts';
import { createPropagationCore } from './core.ts';
import type { CatalogEntry, TrimmedOmm } from '../catalog/types.ts';

// Two real objects with stable elements. ISS is LEO; a GEO object exercises
// a different SGP4 regime.
const ISS: TrimmedOmm = {
  OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', NORAD_CAT_ID: 25544,
  EPOCH: '2026-09-19T12:00:00.000000', MEAN_MOTION: 15.50103472,
  ECCENTRICITY: 0.0004364, INCLINATION: 51.6412, RA_OF_ASC_NODE: 247.4627,
  ARG_OF_PERICENTER: 130.5360, MEAN_ANOMALY: 325.0288, BSTAR: 0.00023844,
  MEAN_MOTION_DOT: 0.00012353, MEAN_MOTION_DDOT: 0, ELEMENT_SET_NO: 999,
};
const GEO: TrimmedOmm = {
  ...ISS, OBJECT_NAME: 'GEO TEST', OBJECT_ID: '2000-001A', NORAD_CAT_ID: 26000,
  MEAN_MOTION: 1.00270000, ECCENTRICITY: 0.0001, INCLINATION: 0.05,
  MEAN_MOTION_DOT: 0,
};

const entry = (omm: TrimmedOmm): CatalogEntry => ({
  omm,
  meta: { objectType: null, owner: null, launchDate: null, apogeeKm: null, perigeeKm: null },
});

const CATALOG = [entry(ISS), entry(GEO)];
const AT = new Date('2026-09-19T13:30:00.000Z');

describe('createPropagationCore', () => {
  it('reports one entry per catalog record', async () => {
    const core = await createPropagationCore(CATALOG);
    expect(core.count).toBe(2);
    core.dispose();
  });

  it('matches a direct satellite.js propagate() call — pipeline fidelity', async () => {
    const core = await createPropagationCore(CATALOG);
    const frame = core.tick(AT);

    for (let i = 0; i < CATALOG.length; i++) {
      const { p } = stateAt(json2satrec(CATALOG[i]!.omm), AT);

      // WASM and the JS port derive from the same Vallado reference; they
      // should agree far more tightly than 1 m. Relax only with a reason.
      expect(frame.positions[i * 3 + 0]!).toBeCloseTo(p.x, 3);
      expect(frame.positions[i * 3 + 1]!).toBeCloseTo(p.y, 3);
      expect(frame.positions[i * 3 + 2]!).toBeCloseTo(p.z, 3);
    }
    core.dispose();
  });

  it('returns velocities consistent with a finite difference of positions', async () => {
    const core = await createPropagationCore(CATALOG);
    const dt = 1;
    const a = core.tick(AT);
    const vx = a.velocities[0]!, vy = a.velocities[1]!, vz = a.velocities[2]!;
    const ax = a.positions[0]!, ay = a.positions[1]!, az = a.positions[2]!;
    const b = core.tick(new Date(AT.getTime() + dt * 1000));

    // Over 1 s a LEO chord is within ~1 m of the velocity-scaled step.
    expect(b.positions[0]!).toBeCloseTo(ax + vx * dt, 2);
    expect(b.positions[1]!).toBeCloseTo(ay + vy * dt, 2);
    expect(b.positions[2]!).toBeCloseTo(az + vz * dt, 2);
    core.dispose();
  });

  it('excludes satellites with a non-zero SGP4 error from liveIndices', async () => {
    // Mean motion of 0 is not physically propagable; SGP4 must flag it.
    const broken = entry({ ...ISS, NORAD_CAT_ID: 99999, MEAN_MOTION: 0, ECCENTRICITY: 0.99 });
    const core = await createPropagationCore([...CATALOG, broken]);
    core.tick(AT);
    expect(core.count).toBe(3);
    expect(Array.from(core.liveIndices)).not.toContain(2);
    expect(Array.from(core.liveIndices)).toEqual(expect.arrayContaining([0, 1]));
    core.dispose();
  });

  it('stamps the frame with the requested epoch', async () => {
    const core = await createPropagationCore(CATALOG);
    expect(core.tick(AT).epochMs).toBe(AT.getTime());
    core.dispose();
  });
});

describe('runtime lifetime', () => {
  it('survives a create/dispose/create cycle, as React StrictMode causes', async () => {
    // Regression guard: disposing the shared WASM runtime calls emscripten's
    // _exit_runtime(), which permanently kills the module. If dispose() ever
    // starts tearing down the runtime again, the second create here throws
    // ExitStatus and the page breaks on StrictMode's second mount.
    const first = await createPropagationCore(CATALOG);
    first.tick(AT);
    first.dispose();

    const second = await createPropagationCore(CATALOG);
    const frame = second.tick(AT);
    expect(Number.isFinite(frame.positions[0]!)).toBe(true);
    expect(frame.positions[0]).not.toBe(0);
    second.dispose();
  });
});
