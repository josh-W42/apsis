import { describe, expect, it } from 'vitest';
import { classifyRegime, regimeLabel } from './regime.ts';

describe('classifyRegime', () => {
  it('calls the ISS low earth orbit', () => {
    expect(classifyRegime(422, 416)).toBe('LEO');
  });

  it('calls a geostationary satellite GEO', () => {
    expect(classifyRegime(35800, 35780)).toBe('GEO');
  });

  it('calls a GPS satellite MEO', () => {
    expect(classifyRegime(20200, 20180)).toBe('MEO');
  });

  it('calls a Molniya-type orbit HEO on eccentricity, not altitude', () => {
    expect(classifyRegime(39900, 500)).toBe('HEO');
  });

  it('prefers HEO over GEO for an eccentric orbit that happens to reach GEO altitude', () => {
    expect(classifyRegime(35800, 300)).toBe('HEO');
  });

  it('returns UNKNOWN when SATCAT has no row — a freshly launched object', () => {
    expect(classifyRegime(null, null)).toBe('UNKNOWN');
    expect(classifyRegime(500, null)).toBe('UNKNOWN');
    expect(classifyRegime(null, 500)).toBe('UNKNOWN');
  });

  it('produces human labels for the panel', () => {
    expect(regimeLabel('LEO')).toBe('Low Earth orbit');
    expect(regimeLabel('GEO')).toBe('Geostationary orbit');
    expect(regimeLabel('UNKNOWN')).toBe('Unknown orbit');
  });
});
