/**
 * Live indices are encoded as RGB so the GPU can report which satellite is
 * under the cursor.
 *
 * Index 0 must be representable, and the cleared background reads as black,
 * so everything is stored offset by one and (0,0,0) means "nothing here".
 */

/** Exclusive upper bound on encodable indices. */
export const MAX_PICKABLE = 0xff_ff_ff - 1;

export function encodePickId(liveIndex: number): [number, number, number] {
  if (!Number.isInteger(liveIndex) || liveIndex < 0 || liveIndex >= MAX_PICKABLE) {
    throw new RangeError(`pick id ${liveIndex} out of range [0, ${MAX_PICKABLE})`);
  }
  const v = liveIndex + 1;
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];
}

export function decodePickId(r: number, g: number, b: number): number | null {
  const v = r | (g << 8) | (b << 16);
  return v === 0 ? null : v - 1;
}
