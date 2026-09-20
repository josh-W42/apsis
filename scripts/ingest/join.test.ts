import { describe, expect, it } from 'vitest';
import { joinCatalog } from './join.ts';
import type { OmmRecord } from '../../src/catalog/types.ts';
import type { SatcatRow } from './parse-satcat.ts';

function omm(id: number, name = `SAT-${id}`): OmmRecord {
  return {
    OBJECT_NAME: name, OBJECT_ID: `2020-00${id}A`, NORAD_CAT_ID: id,
    EPOCH: '2026-09-19T00:00:00', MEAN_MOTION: 15.5, ECCENTRICITY: 0.001,
    INCLINATION: 51.6, RA_OF_ASC_NODE: 100, ARG_OF_PERICENTER: 90,
    MEAN_ANOMALY: 10, BSTAR: 0.0001, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0,
    EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', ELEMENT_SET_NO: 999,
    REV_AT_EPOCH: 100,
  };
}
const row = (decayDate: string | null): SatcatRow => ({
  meta: { objectType: 'PAY', owner: 'US', launchDate: '2020-01-01',
          apogeeKm: 500, perigeeKm: 490 },
  decayDate,
});

describe('joinCatalog', () => {
  it('attaches SATCAT metadata by NORAD id', () => {
    const out = joinCatalog([omm(1)], new Map([[1, row(null)]]));
    expect(out).toHaveLength(1);
    expect(out[0]!.meta.owner).toBe('US');
  });

  it('drops objects with a decay date', () => {
    const out = joinCatalog([omm(1), omm(2)],
      new Map([[1, row('2024-01-01')], [2, row(null)]]));
    expect(out.map((e) => e.omm.NORAD_CAT_ID)).toEqual([2]);
  });

  it('keeps GP records absent from SATCAT, with null metadata', () => {
    const out = joinCatalog([omm(7)], new Map());
    expect(out).toHaveLength(1);
    expect(out[0]!.meta).toEqual({
      objectType: null, owner: null, launchDate: null,
      apogeeKm: null, perigeeKm: null,
    });
  });

  it('is deterministic — output is sorted by NORAD id', () => {
    const out = joinCatalog([omm(30), omm(2), omm(11)], new Map());
    expect(out.map((e) => e.omm.NORAD_CAT_ID)).toEqual([2, 11, 30]);
  });
});

describe('joinCatalog trimming', () => {
  it('drops OMM fields nothing downstream reads', () => {
    const out = joinCatalog([omm(1)], new Map());
    const keys = Object.keys(out[0]!.omm);
    for (const dead of ['EPHEMERIS_TYPE', 'CLASSIFICATION_TYPE',
                        'REV_AT_EPOCH']) {
      expect(keys).not.toContain(dead);
    }
  });

  it('keeps every field json2satrec reads, plus name and id', () => {
    const out = joinCatalog([omm(1)], new Map());
    const keys = Object.keys(out[0]!.omm);
    for (const required of [
      'NORAD_CAT_ID', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION',
      'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR',
      'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT', 'OBJECT_NAME', 'OBJECT_ID',
      'ELEMENT_SET_NO',
    ]) {
      expect(keys).toContain(required);
    }
  });
});
