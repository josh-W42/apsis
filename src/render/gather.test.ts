import { describe, expect, it } from 'vitest';
import { gatherLive } from './satellites.ts';

describe('gatherLive', () => {
  it('compacts the selected satellites into the target, preserving xyz order', () => {
    const source = Float32Array.from([
      1, 2, 3,
      4, 5, 6,
      7, 8, 9,
    ]);
    const target = new Float32Array(6);
    gatherLive(source, Uint32Array.from([0, 2]), target);
    expect(Array.from(target)).toEqual([1, 2, 3, 7, 8, 9]);
  });

  it('handles a single live satellite at the end of the source', () => {
    const source = Float32Array.from([1, 1, 1, 2, 2, 2, 3, 3, 3]);
    const target = new Float32Array(3);
    gatherLive(source, Uint32Array.from([2]), target);
    expect(Array.from(target)).toEqual([3, 3, 3]);
  });

  it('is identity when every satellite is live', () => {
    const source = Float32Array.from([1, 2, 3, 4, 5, 6]);
    const target = new Float32Array(6);
    gatherLive(source, Uint32Array.from([0, 1]), target);
    expect(Array.from(target)).toEqual(Array.from(source));
  });

  it('writes nothing when no satellite is live', () => {
    const target = new Float32Array(3).fill(-1);
    gatherLive(Float32Array.from([1, 2, 3]), new Uint32Array(0), target);
    expect(Array.from(target)).toEqual([-1, -1, -1]);
  });
});
