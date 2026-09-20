import { describe, expect, it } from 'vitest';
import { parseGpResponse } from './parse-gp.ts';

const valid = JSON.stringify([
  { OBJECT_NAME: 'CALSPHERE 1', NORAD_CAT_ID: 900, EPOCH: '2026-09-19T17:48:10.854720',
    MEAN_MOTION: 13.76707938, ECCENTRICITY: 0.0026146, INCLINATION: 90.2179,
    RA_OF_ASC_NODE: 73.9588, ARG_OF_PERICENTER: 10.5867, MEAN_ANOMALY: 121.006,
    BSTAR: 0.00042544, MEAN_MOTION_DOT: 4.28e-6, MEAN_MOTION_DDOT: 0,
    EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', ELEMENT_SET_NO: 999,
    REV_AT_EPOCH: 8443, OBJECT_ID: '1964-063C' },
]);

describe('parseGpResponse', () => {
  it('parses a valid GP array', () => {
    const out = parseGpResponse(valid);
    expect(out).toHaveLength(1);
    expect(out[0]!.NORAD_CAT_ID).toBe(900);
  });

  it('rejects the Celestrak "not updated" plain-text refusal served with HTTP 200', () => {
    const refusal =
      'GP data has not updated since your last successful\n' +
      'download of GROUP=active at 2026-09-20 01:16:54 UTC.\n';
    expect(() => parseGpResponse(refusal)).toThrow(/not valid JSON/i);
  });

  it('rejects an empty body', () => {
    expect(() => parseGpResponse('')).toThrow(/empty/i);
  });

  it('rejects a JSON object that is not an array', () => {
    expect(() => parseGpResponse('{"error":"nope"}')).toThrow(/array/i);
  });

  it('rejects an empty array — a zero-object catalog is always a fault', () => {
    expect(() => parseGpResponse('[]')).toThrow(/zero/i);
  });

  it('rejects a record missing a field SGP4 requires, naming that field', () => {
    // Omit exactly one required field so the assertion isolates it. A fixture
    // missing everything would only ever report whichever field is checked
    // first, which tests the check order rather than the contract.
    const complete = JSON.parse(valid)[0] as Record<string, unknown>;
    delete complete.MEAN_MOTION;
    expect(() => parseGpResponse(JSON.stringify([complete]))).toThrow(/MEAN_MOTION/);
  });

  it('names the object whose record is incomplete', () => {
    const complete = JSON.parse(valid)[0] as Record<string, unknown>;
    delete complete.INCLINATION;
    expect(() => parseGpResponse(JSON.stringify([complete]))).toThrow(/900/);
  });
});
