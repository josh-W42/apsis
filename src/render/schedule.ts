/**
 * Frame-window arithmetic for the interpolating renderer.
 *
 * Kept pure and separate from globe.ts because the original scheduling bug —
 * alpha running past 1.7, freezing the dots at the end of every segment —
 * lived in logic that nothing tested. The renderer wiring needs a browser;
 * this arithmetic does not.
 */

/**
 * The epoch to request given the current wall clock.
 *
 * Always one tick beyond the current tick boundary, derived from `nowMs`
 * rather than accumulated, so a slow start or a late frame cannot put the
 * schedule permanently behind.
 */
export function nextEpochFor(nowMs: number, tickMs: number): number {
  return Math.floor(nowMs / tickMs) * tickMs + tickMs;
}

/** The tick boundary at or before `nowMs`. */
export function alignEpoch(nowMs: number, tickMs: number): number {
  return Math.floor(nowMs / tickMs) * tickMs;
}

/**
 * Interpolation position within the [epochA, epochB] window, clamped to 0..1.
 *
 * Returns 0 for a degenerate window so a missing second frame renders the
 * first one's state rather than NaN.
 */
export function alphaFor(nowMs: number, epochA: number, epochB: number): number {
  if (epochB <= epochA) return 0;
  const raw = (nowMs - epochA) / (epochB - epochA);
  return raw < 0 ? 0 : raw > 1 ? 1 : raw;
}

/** Has the schedule fallen far enough behind that the window should reset? */
export function isStaleWindow(
  incomingEpochMs: number, currentEpochB: number, tickMs: number,
): boolean {
  return currentEpochB !== 0 && incomingEpochMs - currentEpochB > 2 * tickMs;
}
