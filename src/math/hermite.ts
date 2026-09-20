/**
 * Cubic Hermite interpolation on one axis.
 *
 * This is the reference implementation for the GLSL port in
 * `src/render/satellites.ts`. Keep the two in step.
 *
 * @param p0 value at the start of the interval
 * @param v0 derivative at the start, per unit of the interval's own time units
 * @param p1 value at the end
 * @param v1 derivative at the end
 * @param s  normalised position in the interval, 0..1
 * @param h  interval width in the same time units as v0/v1
 */
export function hermite(
  p0: number, v0: number, p1: number, v1: number, s: number, h: number,
): number {
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return h00 * p0 + h10 * h * v0 + h01 * p1 + h11 * h * v1;
}
