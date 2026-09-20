import { describe, expect, it } from 'vitest';
import {
  buildReverseMap, catalogIndexFromLive, liveIndexFromCatalog,
} from './indexing.ts';

// Catalog of 5; indices 1 and 3 failed SGP4 and are not renderable.
const LIVE = Uint32Array.from([0, 2, 4]);
const COUNT = 5;

describe('index space mapping', () => {
  it('maps every live index to its catalog index', () => {
    expect(catalogIndexFromLive(LIVE, 0)).toBe(0);
    expect(catalogIndexFromLive(LIVE, 1)).toBe(2);
    expect(catalogIndexFromLive(LIVE, 2)).toBe(4);
  });

  it('returns null for a live index outside the rendered set', () => {
    expect(catalogIndexFromLive(LIVE, 3)).toBeNull();
    expect(catalogIndexFromLive(LIVE, -1)).toBeNull();
  });

  it('maps catalog indices back to live indices', () => {
    const rev = buildReverseMap(LIVE, COUNT);
    expect(liveIndexFromCatalog(rev, 0)).toBe(0);
    expect(liveIndexFromCatalog(rev, 2)).toBe(1);
    expect(liveIndexFromCatalog(rev, 4)).toBe(2);
  });

  it('returns null for catalog entries that are not renderable', () => {
    const rev = buildReverseMap(LIVE, COUNT);
    expect(liveIndexFromCatalog(rev, 1)).toBeNull();
    expect(liveIndexFromCatalog(rev, 3)).toBeNull();
  });

  it('returns null outside the catalog entirely', () => {
    const rev = buildReverseMap(LIVE, COUNT);
    expect(liveIndexFromCatalog(rev, 99)).toBeNull();
    expect(liveIndexFromCatalog(rev, -1)).toBeNull();
  });

  it('round-trips every live index — the property that keeps selection honest', () => {
    const rev = buildReverseMap(LIVE, COUNT);
    for (let j = 0; j < LIVE.length; j++) {
      const i = catalogIndexFromLive(LIVE, j);
      expect(i).not.toBeNull();
      expect(liveIndexFromCatalog(rev, i!)).toBe(j);
    }
  });

  it('round-trips at catalog scale with a realistic sparse exclusion', () => {
    const count = 16_578;
    const live: number[] = [];
    for (let i = 0; i < count; i++) if (i % 997 !== 0) live.push(i);
    const liveIdx = Uint32Array.from(live);
    const rev = buildReverseMap(liveIdx, count);
    for (let j = 0; j < liveIdx.length; j += 37) {
      expect(liveIndexFromCatalog(rev, catalogIndexFromLive(liveIdx, j)!)).toBe(j);
    }
    expect(liveIndexFromCatalog(rev, 0)).toBeNull();
  });
});
