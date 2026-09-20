import { describe, expect, it } from 'vitest';
import { decodePickId, encodePickId, MAX_PICKABLE } from './pick-id.ts';

describe('pick id codec', () => {
  it('reserves black for the background', () => {
    expect(decodePickId(0, 0, 0)).toBeNull();
  });

  it('round-trips the first index', () => {
    const [r, g, b] = encodePickId(0);
    expect([r, g, b]).not.toEqual([0, 0, 0]);
    expect(decodePickId(r, g, b)).toBe(0);
  });

  it('round-trips across byte boundaries, where off-by-ones hide', () => {
    for (const i of [0, 1, 254, 255, 256, 257, 65_534, 65_535, 65_536, 16_576, 16_577]) {
      const [r, g, b] = encodePickId(i);
      expect(decodePickId(r, g, b), `index ${i}`).toBe(i);
    }
  });

  it('round-trips every index across the real catalog size', () => {
    for (let i = 0; i < 16_578; i++) {
      const [r, g, b] = encodePickId(i);
      expect(decodePickId(r, g, b)).toBe(i);
    }
  });

  it('keeps every channel inside a byte', () => {
    for (const i of [0, 12_345, 16_577, MAX_PICKABLE - 1]) {
      for (const c of encodePickId(i)) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
        expect(Number.isInteger(c)).toBe(true);
      }
    }
  });

  it('rejects an index the encoding cannot represent', () => {
    expect(() => encodePickId(-1)).toThrow(/range/i);
    expect(() => encodePickId(MAX_PICKABLE)).toThrow(/range/i);
  });
});
