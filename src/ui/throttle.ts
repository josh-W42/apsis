/**
 * Leading-edge throttle.
 *
 * Live values arrive at 60 fps; the panel writes to the DOM at 4 Hz. Digits
 * changing sixty times a second are unreadable, and re-rendering React that
 * often for numbers nobody can follow is pure waste.
 *
 * `now` is injected so this is testable without timers or `vi.mock`.
 */
export function createThrottle(
  intervalMs: number, now: () => number = () => performance.now(),
): (fn: () => void) => void {
  let last = Number.NEGATIVE_INFINITY;
  return (fn) => {
    const t = now();
    if (t - last < intervalMs) return;
    last = t;
    fn();
  };
}
