import { describe, expect, it } from 'vitest';
import { contrastRatio, relativeLuminance } from './contrast.ts';

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 6);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6);
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white — the WCAG maximum', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2);
  });

  it('is 1:1 for a colour against itself', () => {
    expect(contrastRatio('#8fd6ff', '#8fd6ff')).toBeCloseTo(1, 6);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#3d5a73', '#0d1a2a'))
      .toBeCloseTo(contrastRatio('#0d1a2a', '#3d5a73'), 9);
  });

  it('matches a known WCAG pair — #767676 on white is the 4.5:1 boundary', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThan(4.45);
    expect(contrastRatio('#767676', '#ffffff')).toBeLessThan(4.6);
  });

  it('accepts shorthand and uppercase hex', () => {
    expect(contrastRatio('#FFF', '#000')).toBeCloseTo(21, 2);
  });
});
