import { describe, expect, it } from 'vitest';
import { BUCKETS, bucketIndex, classifyConstellation } from './constellation.ts';

describe('classifyConstellation', () => {
  it('buckets Starlink by name', () => {
    expect(classifyConstellation('STARLINK-1007', 551, 540)).toBe('starlink');
    expect(classifyConstellation('STARLINK-30123', 340, 330)).toBe('starlink');
  });

  it('buckets OneWeb by name', () => {
    expect(classifyConstellation('ONEWEB-0012', 1200, 1190)).toBe('oneweb');
  });

  it('buckets every GNSS family by name', () => {
    for (const n of ['GPS BIIF-2', 'NAVSTAR 81', 'GLONASS-K1 17L', 'GALILEO 23', 'BEIDOU-3 M12']) {
      expect(classifyConstellation(n, 20200, 20180)).toBe('gnss');
    }
  });

  it('buckets an unnamed geostationary object as the GEO belt', () => {
    expect(classifyConstellation('INTELSAT 901', 35800, 35780)).toBe('geo');
  });

  it('puts a geostationary BeiDou in gnss, not geo — name beats orbit', () => {
    expect(classifyConstellation('BEIDOU-3 G4', 35800, 35780)).toBe('gnss');
  });

  it('catches GNSS family names in bracketed suffixes — real catalog names', () => {
    // GLONASS flies under COSMOS designations and Galileo under GSAT. An
    // anchored regex dropped 61 of these into `other`.
    expect(classifyConstellation('COSMOS 2433 [GLONASS-M]', 19100, 19100)).toBe('gnss');
    expect(classifyConstellation('GSAT0101 (GALILEO-PFM)', 23200, 23200)).toBe('gnss');
  });

  it('still refuses a family name embedded in a longer token', () => {
    expect(classifyConstellation('GPSAT ONE', 500, 490)).toBe('other');
  });

  it('falls back to other', () => {
    expect(classifyConstellation('ISS (ZARYA)', 422, 416)).toBe('other');
    expect(classifyConstellation('COSMOS 2558', 700, 690)).toBe('other');
  });

  it('is case insensitive', () => {
    expect(classifyConstellation('starlink-1007', 551, 540)).toBe('starlink');
  });

  it('does not match a name that merely contains a family name mid-word', () => {
    expect(classifyConstellation('SUPERSTARLINKER 1', 500, 490)).toBe('other');
  });

  it('handles null orbit data without throwing', () => {
    expect(classifyConstellation('UNKNOWN OBJECT', null, null)).toBe('other');
    expect(classifyConstellation('STARLINK-1', null, null)).toBe('starlink');
  });

  it('gives every bucket a stable index for the shader palette', () => {
    expect(BUCKETS).toHaveLength(5);
    for (const b of BUCKETS) {
      expect(bucketIndex(b)).toBe(BUCKETS.indexOf(b));
    }
  });
});
