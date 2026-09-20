import { describe, expect, it } from 'vitest';
import { searchCatalog } from './search.ts';
import type { CatalogIndexEntry } from './types.ts';

const make = (noradId: number, name: string, intlDesignator = '2020-001A'): CatalogIndexEntry => ({
  noradId, name, intlDesignator, objectType: 'PAY', owner: 'US',
  ownerName: 'United States', launchDate: '2020-01-01',
  apogeeKm: 550, perigeeKm: 540, inclinationDeg: 53, meanMotion: 15.1,
});

const INDEX: CatalogIndexEntry[] = [
  make(25544, 'ISS (ZARYA)', '1998-067A'),
  make(44713, 'STARLINK-1007'),
  make(44714, 'STARLINK-1008'),
  make(48274, 'ONEWEB-0123'),
  make(11111, 'COSMOS 2558'),
];

describe('searchCatalog', () => {
  it('returns nothing for an empty or whitespace query', () => {
    expect(searchCatalog(INDEX, '').hits).toHaveLength(0);
    expect(searchCatalog(INDEX, '   ').hits).toHaveLength(0);
    expect(searchCatalog(INDEX, '').totalMatches).toBe(0);
  });

  it('matches a NORAD id exactly and ranks it first', () => {
    const out = searchCatalog(INDEX, '25544');
    expect(out.hits[0]!.entry.noradId).toBe(25544);
    expect(out.hits[0]!.catalogIndex).toBe(0);
  });

  it('matches an international designator', () => {
    expect(searchCatalog(INDEX, '1998-067A').hits[0]!.entry.noradId).toBe(25544);
  });

  it('is case insensitive on names and designators', () => {
    expect(searchCatalog(INDEX, 'iss').hits[0]!.entry.name).toBe('ISS (ZARYA)');
    expect(searchCatalog(INDEX, '1998-067a').hits[0]!.entry.noradId).toBe(25544);
  });

  it('ranks a name prefix above a mid-string substring', () => {
    const index = [make(1, 'DEEP STARLINK PROBE'), make(2, 'STARLINK-9')];
    const hits = searchCatalog(index, 'starlink').hits;
    expect(hits[0]!.entry.name).toBe('STARLINK-9');
  });

  it('reports the true total even when results are capped', () => {
    const many = Array.from({ length: 500 }, (_, i) => make(1000 + i, `STARLINK-${i}`));
    const out = searchCatalog(many, 'starlink', 20);
    expect(out.hits).toHaveLength(20);
    expect(out.totalMatches).toBe(500);
    expect(out.truncated).toBe(true);
  });

  it('does not mark a short result set as truncated', () => {
    const out = searchCatalog(INDEX, 'oneweb', 20);
    expect(out.hits).toHaveLength(1);
    expect(out.totalMatches).toBe(1);
    expect(out.truncated).toBe(false);
  });

  it('carries the catalog index so selection can find the position', () => {
    expect(searchCatalog(INDEX, 'oneweb').hits[0]!.catalogIndex).toBe(3);
  });

  it('returns an empty outcome for no match rather than throwing', () => {
    const out = searchCatalog(INDEX, 'zzzznope');
    expect(out.hits).toHaveLength(0);
    expect(out.totalMatches).toBe(0);
    expect(out.truncated).toBe(false);
  });

  it('stays under 20 ms at catalog scale for the worst-case query', () => {
    const many = Array.from({ length: 16_578 }, (_, i) => make(i, `STARLINK-${i}`));
    const t = performance.now();
    searchCatalog(many, 'starlink');
    expect(performance.now() - t).toBeLessThan(20);
  });
});
