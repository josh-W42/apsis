/**
 * Distinguishing a click from a camera drag.
 *
 * A mouse drag on a canvas still fires `click` on release, so a plain click
 * listener treated every globe rotation as "clicked empty space" and cleared
 * the selection. That was reported as selections being lost while rotating.
 */

export interface PointerSample {
  x: number;
  y: number;
  t: number;
}

/**
 * Default slop, in CSS pixels, for a fine pointer.
 *
 * Touch needs a larger value — see clickSlopCss() in pointer-profile.ts.
 */
export const CLICK_SLOP_CSS = 4;

/**
 * True when a press/release pair should be treated as a click.
 *
 * `travelled` is the total path length since the press, not the straight
 * line between the two points: orbiting the globe and returning near the
 * start is a drag, however the endpoints line up.
 */
export function isClickGesture(
  down: PointerSample, up: PointerSample, travelled = 0,
  slop: number = CLICK_SLOP_CSS,
): boolean {
  if (travelled > slop) return false;
  return Math.hypot(up.x - down.x, up.y - down.y) <= slop;
}
