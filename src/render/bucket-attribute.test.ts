import { describe, expect, it } from 'vitest';
import { buildBucketAttribute } from './satellites.ts';
import { bucketIndex } from '../catalog/constellation.ts';
import type { CatalogIndexEntry } from '../catalog/types.ts';

const make = (name: string, apogeeKm: number | null = 550, perigeeKm: number | null = 540):
  CatalogIndexEntry => ({
  noradId: 1, name, intlDesignator: '2020-001A', objectType: 'PAY',
  owner: 'US', ownerName: 'United States', launchDate: '2020-01-01',
  apogeeKm, perigeeKm, inclinationDeg: 53, meanMotion: 15.1,
});

describe('buildBucketAttribute', () => {
  it('writes one value per live satellite, in live order', () => {
    const index = [make('STARLINK-1'), make('ISS (ZARYA)'), make('ONEWEB-2')];
    const attr = buildBucketAttribute(index, Uint32Array.from([0, 1, 2]));
    expect(attr).toHaveLength(3);
    expect(attr[0]).toBe(bucketIndex('starlink'));
    expect(attr[1]).toBe(bucketIndex('other'));
    expect(attr[2]).toBe(bucketIndex('oneweb'));
  });

  it('follows liveIndices rather than catalog order — the index-space trap', () => {
    const index = [make('STARLINK-1'), make('ISS (ZARYA)'), make('ONEWEB-2')];
    // Catalog entry 1 is not renderable.
    const attr = buildBucketAttribute(index, Uint32Array.from([0, 2]));
    expect(attr).toHaveLength(2);
    expect(attr[0]).toBe(bucketIndex('starlink'));
    expect(attr[1]).toBe(bucketIndex('oneweb'));
  });

  it('buckets a geostationary object into the GEO belt', () => {
    const attr = buildBucketAttribute([make('INTELSAT 901', 35800, 35780)], Uint32Array.from([0]));
    expect(attr[0]).toBe(bucketIndex('geo'));
  });

  it('returns an empty attribute for an empty live set', () => {
    expect(buildBucketAttribute([make('STARLINK-1')], new Uint32Array(0))).toHaveLength(0);
  });
});
