import { decodePickId } from './pick-id.ts';

/**
 * Cursor tolerance in CSS pixels.
 *
 * The original implementation read a single device pixel. Because
 * `setViewOffset` scales positions but not `gl_PointSize`, that gave an
 * effective radius of only `pointSize / 2 / dpr` — 2 CSS pixels at DPR 2,
 * which is far below what anyone can hit reliably.
 */
export const PICK_RADIUS_CSS = 8;

/**
 * Choose the pick id nearest the centre of a square readback window.
 *
 * Nearest to the *cursor*, not nearest to the camera. Depth alone would let
 * a satellite far from the pointer win simply by being closer to the eye,
 * which is not what "that one" means when someone clicks.
 *
 * `pixels` is RGBA, row-major, bottom-up as WebGL returns it — orientation
 * does not matter here because the metric is symmetric about the centre.
 */
export function nearestHitInWindow(pixels: Uint8Array, size: number): number | null {
  const centre = (size - 1) / 2;
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const id = decodePickId(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
      if (id === null) continue;
      const dx = x - centre;
      const dy = y - centre;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = id;
      }
    }
  }
  return best;
}
