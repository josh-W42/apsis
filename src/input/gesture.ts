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

/** How far the pointer may move and still count as a click, in CSS pixels. */
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
): boolean {
  if (travelled > CLICK_SLOP_CSS) return false;
  return Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_SLOP_CSS;
}
