import { describe, expect, it } from 'vitest';
import { BUCKETS } from '../catalog/constellation.ts';
import { contrastRatio } from './contrast.ts';
import { BUCKET_COLORS, BUCKET_SIZE_SCALE, NIGHT_EARTH, SPACE } from './theme.ts';

/**
 * The globe's night side is nearly black, and a dot drawn on it has only its
 * own luminance to work with. The first Starlink colour (#3d5a73) sat at
 * 2.43:1 there and was invisible in use — a bug no rendering test caught.
 */
const MIN_NIGHT_CONTRAST = 3;

describe('constellation palette legibility', () => {
  it.each(BUCKETS)('%s is visible against the globe night side', (bucket) => {
    expect(contrastRatio(BUCKET_COLORS[bucket], NIGHT_EARTH))
      .toBeGreaterThanOrEqual(MIN_NIGHT_CONTRAST);
  });

  it.each(BUCKETS)('%s is visible against empty space', (bucket) => {
    expect(contrastRatio(BUCKET_COLORS[bucket], SPACE))
      .toBeGreaterThanOrEqual(MIN_NIGHT_CONTRAST);
  });

  it('keeps Starlink recessive by size rather than by darkness', () => {
    // Receding via luminance is what made it disappear. It recedes by being
    // smaller and less saturated instead, so this asserts both halves.
    expect(BUCKET_SIZE_SCALE.starlink).toBeLessThan(1);
    for (const b of BUCKETS) {
      if (b === 'starlink') continue;
      expect(BUCKET_SIZE_SCALE[b]).toBe(1);
    }
  });

  it('gives every bucket a size scale', () => {
    for (const b of BUCKETS) {
      expect(BUCKET_SIZE_SCALE[b]).toBeGreaterThan(0);
    }
  });
});
