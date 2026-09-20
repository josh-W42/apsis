import { describe, expect, it } from 'vitest';
import { alignEpoch, alphaFor, isStaleWindow, nextEpochFor } from './schedule.ts';

const TICK = 1000;

describe('nextEpochFor', () => {
  it('returns the next tick boundary strictly ahead of now', () => {
    expect(nextEpochFor(10_000, TICK)).toBe(11_000);
    expect(nextEpochFor(10_001, TICK)).toBe(11_000);
    expect(nextEpochFor(10_999, TICK)).toBe(11_000);
  });

  it('is derived from now, not accumulated — a late start cannot fall behind', () => {
    // Simulate startup at t=0 followed by 4.3 s of worker init. A counter
    // seeded before init would still be requesting epoch 1000; deriving from
    // the clock asks for 5000. This is the bug this function exists to stop.
    expect(nextEpochFor(4_300, TICK)).toBe(5_000);
  });
});

describe('alphaFor', () => {
  it('walks 0 to 1 across the window', () => {
    expect(alphaFor(10_000, 10_000, 11_000)).toBe(0);
    expect(alphaFor(10_500, 10_000, 11_000)).toBe(0.5);
    expect(alphaFor(11_000, 10_000, 11_000)).toBe(1);
  });

  it('clamps rather than extrapolating past the newest frame', () => {
    expect(alphaFor(12_700, 10_000, 11_000)).toBe(1);
    expect(alphaFor(9_000, 10_000, 11_000)).toBe(0);
  });

  it('returns 0 for a degenerate window instead of NaN or Infinity', () => {
    expect(alphaFor(10_000, 5_000, 5_000)).toBe(0);
    expect(alphaFor(10_000, 0, 0)).toBe(0);
    expect(Number.isNaN(alphaFor(10_000, 5_000, 5_000))).toBe(false);
  });

  it('stays within [0,1] across a simulated run with a slow start', () => {
    // 300 ms of init, then pump every tick off the wall clock.
    let lastRequested = alignEpoch(300, TICK);
    const delivered = [lastRequested];
    let epochA = 0, epochB = 0;

    for (let now = 300; now <= 20_000; now += 50) {
      const target = nextEpochFor(now, TICK);
      if (target > lastRequested) {
        lastRequested = target;
        delivered.push(target);
      }
      // Frames arrive in order; take the newest two.
      if (delivered.length >= 2) {
        epochA = delivered[delivered.length - 2]!;
        epochB = delivered[delivered.length - 1]!;
      }
      const a = alphaFor(now, epochA, epochB);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it('never saturates at 1 for a whole tick during steady state', () => {
    // The stutter symptom: alpha pinned at 1 means frozen dots.
    let saturated = 0;
    for (let now = 10_000; now < 14_000; now += 50) {
      const epochB = nextEpochFor(now, TICK);
      const epochA = epochB - TICK;
      if (alphaFor(now, epochA, epochB) >= 1) saturated++;
    }
    expect(saturated).toBe(0);
  });
});

describe('isStaleWindow', () => {
  it('flags a gap larger than two ticks, as a backgrounded tab produces', () => {
    expect(isStaleWindow(60_000, 10_000, TICK)).toBe(true);
  });

  it('accepts a normal one-tick advance', () => {
    expect(isStaleWindow(11_000, 10_000, TICK)).toBe(false);
  });

  it('does not flag the very first frame', () => {
    expect(isStaleWindow(99_000, 0, TICK)).toBe(false);
  });
});
