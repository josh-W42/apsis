import { describe, expect, it } from 'vitest';
import { nearestHitInWindow, PICK_RADIUS_CSS } from './pick-window.ts';
import { encodePickId } from './pick-id.ts';

/** Build an RGBA buffer of size*size with ids planted at given offsets. */
function windowWith(size: number, plants: { x: number; y: number; id: number }[]): Uint8Array {
  const buf = new Uint8Array(size * size * 4);
  for (const { x, y, id } of plants) {
    const [r, g, b] = encodePickId(id);
    const i = (y * size + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
  }
  return buf;
}

describe('nearestHitInWindow', () => {
  it('returns null for an empty window', () => {
    expect(nearestHitInWindow(new Uint8Array(5 * 5 * 4), 5)).toBeNull();
  });

  it('finds a hit at the exact centre', () => {
    expect(nearestHitInWindow(windowWith(5, [{ x: 2, y: 2, id: 42 }]), 5)).toBe(42);
  });

  it('finds an off-centre hit when nothing is at the centre', () => {
    expect(nearestHitInWindow(windowWith(5, [{ x: 0, y: 0, id: 7 }]), 5)).toBe(7);
  });

  it('prefers the hit closest to the cursor, not the first one scanned', () => {
    // id 1 is scanned first (top-left) but id 2 is nearer the centre.
    const buf = windowWith(5, [{ x: 0, y: 0, id: 1 }, { x: 2, y: 3, id: 2 }]);
    expect(nearestHitInWindow(buf, 5)).toBe(2);
  });

  it('breaks ties deterministically by scan order', () => {
    // Both are exactly one pixel from the centre.
    const buf = windowWith(5, [{ x: 2, y: 1, id: 10 }, { x: 1, y: 2, id: 20 }]);
    expect(nearestHitInWindow(buf, 5)).toBe(10);
  });

  it('handles a 1x1 window — the degenerate case the old code used', () => {
    expect(nearestHitInWindow(windowWith(1, [{ x: 0, y: 0, id: 5 }]), 1)).toBe(5);
    expect(nearestHitInWindow(new Uint8Array(4), 1)).toBeNull();
  });

  it('ignores the alpha channel when decoding', () => {
    const buf = windowWith(3, [{ x: 1, y: 1, id: 900 }]);
    buf[(1 * 3 + 1) * 4 + 3] = 0;   // alpha zeroed
    expect(nearestHitInWindow(buf, 3)).toBe(900);
  });

  it('round-trips a large id planted off-centre', () => {
    expect(nearestHitInWindow(windowWith(7, [{ x: 5, y: 1, id: 16_577 }]), 7)).toBe(16_577);
  });

  it('exposes a cursor tolerance big enough to click comfortably', () => {
    // The old 1x1 readback gave a 2 CSS px radius at DPR 2, which users
    // reported as "can't click the satellites".
    expect(PICK_RADIUS_CSS).toBeGreaterThanOrEqual(6);
  });
});
