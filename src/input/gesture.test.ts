import { describe, expect, it } from 'vitest';
import { CLICK_SLOP_CSS, isClickGesture } from './gesture.ts';

const down = { x: 100, y: 100, t: 1000 };

describe('isClickGesture', () => {
  it('accepts a still press and release', () => {
    expect(isClickGesture(down, { x: 100, y: 100, t: 1080 })).toBe(true);
  });

  it('accepts the small tremor of a real click', () => {
    expect(isClickGesture(down, { x: 102, y: 101, t: 1120 })).toBe(true);
  });

  it('rejects a drag — this is what was clearing the selection on rotate', () => {
    expect(isClickGesture(down, { x: 160, y: 130, t: 1400 })).toBe(false);
  });

  it('rejects a drag that returns near its origin', () => {
    // Orbiting and coming back must not read as a click just because the
    // endpoints match; travelled distance is tracked, not displacement.
    expect(isClickGesture(down, { x: 101, y: 100, t: 1500 }, 240)).toBe(false);
  });

  it('measures displacement, not axis distance', () => {
    // Just inside and just outside the slop radius on the diagonal.
    const inside = CLICK_SLOP_CSS / Math.SQRT2 - 0.1;
    const outside = CLICK_SLOP_CSS / Math.SQRT2 + 0.5;
    expect(isClickGesture(down, { x: 100 + inside, y: 100 + inside, t: 1050 })).toBe(true);
    expect(isClickGesture(down, { x: 100 + outside, y: 100 + outside, t: 1050 })).toBe(false);
  });

  it('accepts a slow but stationary press', () => {
    // Holding still for a while is still a click; only movement disqualifies.
    expect(isClickGesture(down, { x: 100, y: 100, t: 4000 })).toBe(true);
  });

  it('uses a slop small enough not to swallow deliberate small drags', () => {
    expect(CLICK_SLOP_CSS).toBeLessThanOrEqual(6);
    expect(CLICK_SLOP_CSS).toBeGreaterThanOrEqual(2);
  });
});
