import { describe, expect, it } from 'vitest';
import { GP_URL, SATCAT_URL, runIngest, type IngestDeps } from './ingest.ts';

const GP = JSON.stringify([
  { OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', NORAD_CAT_ID: 25544,
    EPOCH: '2026-09-19T00:00:00', MEAN_MOTION: 15.5, ECCENTRICITY: 0.001,
    INCLINATION: 51.6, RA_OF_ASC_NODE: 100, ARG_OF_PERICENTER: 90,
    MEAN_ANOMALY: 10, BSTAR: 0.0001, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0,
    EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', ELEMENT_SET_NO: 999,
    REV_AT_EPOCH: 100 },
]);

const SATCAT =
  'OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,OPS_STATUS_CODE,OWNER,' +
  'LAUNCH_DATE,LAUNCH_SITE,DECAY_DATE,PERIOD,INCLINATION,APOGEE,PERIGEE,' +
  'RCS,DATA_STATUS_CODE,ORBIT_CENTER,ORBIT_TYPE\n' +
  'ISS (ZARYA),1998-067A,25544,PAY,+,ISS,1998-11-20,TTMTR,,92.8,51.64,420,410,399.05,,EA,ORB';

function deps(over: Partial<Record<string, string>> = {}): IngestDeps {
  return {
    fetchText: async (url) => {
      if (url === GP_URL) return over.gp ?? GP;
      if (url === SATCAT_URL) return over.satcat ?? SATCAT;
      throw new Error(`unexpected url ${url}`);
    },
    now: () => new Date('2026-09-19T12:00:00.000Z'),
  };
}

describe('runIngest', () => {
  it('produces a joined catalog and a manifest', async () => {
    const { catalog, manifest } = await runIngest(deps());
    expect(catalog).toHaveLength(1);
    expect(catalog[0]!.meta.owner).toBe('ISS');
    expect(manifest.objectCount).toBe(1);
    expect(manifest.generatedAt).toBe('2026-09-19T12:00:00.000Z');
    expect(manifest.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('propagates the Celestrak refusal as an IngestError, so the caller can keep the last good artifact', async () => {
    await expect(runIngest(deps({ gp: 'GP data has not updated since your last successful\ndownload.' })))
      .rejects.toThrow(/not valid JSON/i);
  });

  it('fails rather than emitting an empty catalog when SATCAT marks everything decayed', async () => {
    const allDecayed = SATCAT.replace(',,92.8,51.64', ',2024-01-01,92.8,51.64');
    await expect(runIngest(deps({ satcat: allDecayed })))
      .rejects.toThrow(/zero objects after/i);
  });

  it('is deterministic — identical inputs yield an identical checksum', async () => {
    const a = await runIngest(deps());
    const b = await runIngest(deps());
    expect(a.manifest.checksum).toBe(b.manifest.checksum);
  });
});
