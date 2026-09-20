/**
 * Day/night blending across the terminator.
 *
 * This is the JavaScript twin of the `smoothstep` in the earth fragment
 * shader. Keep the two in step — the shader is the thing that runs, this is
 * the thing that is tested.
 */

/** Sun dot product where the surface starts to catch light. */
export const TERMINATOR_START = -0.1;
/** Sun dot product where the surface is fully lit. */
export const TERMINATOR_END = 0.25;

/**
 * Fraction of daylight for a surface normal, given its dot product with the
 * sun direction. 0 is full night, 1 is full day.
 *
 * The band straddles zero rather than starting there: the atmosphere keeps
 * the ground lit for a while after the sun is geometrically below the
 * horizon, and a band centred on zero gives a hard, unconvincing edge.
 */
export function dayFactor(sunDot: number): number {
  const t = Math.min(
    1,
    Math.max(0, (sunDot - TERMINATOR_START) / (TERMINATOR_END - TERMINATOR_START)),
  );
  return t * t * (3 - 2 * t);
}
