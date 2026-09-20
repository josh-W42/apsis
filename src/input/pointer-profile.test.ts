import { describe, expect, it } from 'vitest';
import {
  clickSlopCss, detectPointerProfile, isNarrow,
  NARROW_BREAKPOINT_PX, pickRadiusCss,
} from './pointer-profile.ts';

/** Injected matchMedia stub — no jsdom, no vi.mock. */
const mm = (matching: string[]) => (query: string) => ({ matches: matching.includes(query) });

describe('detectPointerProfile', () => {
  it('reports coarse when the primary pointer is coarse', () => {
    expect(detectPointerProfile(mm(['(pointer: coarse)']))).toBe('coarse');
  });

  it('reports fine otherwise', () => {
    expect(detectPointerProfile(mm([]))).toBe('fine');
  });

  it('falls back to fine when matchMedia is unavailable', () => {
    // Server-side render or an old browser must not crash the app.
    expect(detectPointerProfile(undefined)).toBe('fine');
  });
});

describe('pickRadiusCss', () => {
  it('keeps the measured desktop tolerance for a mouse', () => {
    expect(pickRadiusCss('fine')).toBe(8);
  });

  it('gives a fingertip a target of at least 44px across', () => {
    // 44 CSS px is the usual accessibility floor for touch targets.
    expect(pickRadiusCss('coarse') * 2).toBeGreaterThanOrEqual(44);
  });

  it('never shrinks the target on touch', () => {
    expect(pickRadiusCss('coarse')).toBeGreaterThan(pickRadiusCss('fine'));
  });
});

describe('clickSlopCss', () => {
  it('keeps the tight desktop slop for a mouse', () => {
    expect(clickSlopCss('fine')).toBe(4);
  });

  it('tolerates finger tremor on touch', () => {
    // A 4px slop reads ordinary taps as drags, so they silently do nothing.
    expect(clickSlopCss('coarse')).toBeGreaterThanOrEqual(8);
  });

  it('stays below the pick radius so slop cannot swallow a deliberate drag', () => {
    for (const p of ['fine', 'coarse'] as const) {
      expect(clickSlopCss(p)).toBeLessThan(pickRadiusCss(p) * 2);
    }
  });
});

describe('isNarrow', () => {
  it('treats a phone as narrow', () => {
    expect(isNarrow(375)).toBe(true);
  });

  it('treats a desktop window as wide', () => {
    expect(isNarrow(1440)).toBe(false);
  });

  it('switches at the breakpoint, inclusive below', () => {
    expect(isNarrow(NARROW_BREAKPOINT_PX - 1)).toBe(true);
    expect(isNarrow(NARROW_BREAKPOINT_PX)).toBe(false);
  });

  it('leaves the 300px rail at most a third of the screen when wide', () => {
    // The rail is fixed at 300px; below this it starts crowding the globe.
    expect(300 / NARROW_BREAKPOINT_PX).toBeLessThanOrEqual(0.34);
  });
});
