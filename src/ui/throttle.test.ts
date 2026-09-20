import { describe, expect, it } from 'vitest';
import { createThrottle } from './throttle.ts';

describe('createThrottle', () => {
  it('runs the first call immediately', () => {
    let t = 1000;
    const throttle = createThrottle(250, () => t);
    let runs = 0;
    throttle(() => runs++);
    expect(runs).toBe(1);
  });

  it('suppresses calls inside the interval', () => {
    let t = 1000;
    const throttle = createThrottle(250, () => t);
    let runs = 0;
    throttle(() => runs++);
    t = 1100; throttle(() => runs++);
    t = 1249; throttle(() => runs++);
    expect(runs).toBe(1);
  });

  it('runs again once the interval has elapsed', () => {
    let t = 1000;
    const throttle = createThrottle(250, () => t);
    let runs = 0;
    throttle(() => runs++);
    t = 1250; throttle(() => runs++);
    t = 1500; throttle(() => runs++);
    expect(runs).toBe(3);
  });

  it('keeps 60fps callers down to the interval rate', () => {
    let t = 0;
    const throttle = createThrottle(250, () => t);
    let runs = 0;
    for (let f = 0; f <= 60; f++) { t = f * (1000 / 60); throttle(() => runs++); }
    expect(runs).toBeLessThanOrEqual(5);
    expect(runs).toBeGreaterThanOrEqual(4);
  });
});
