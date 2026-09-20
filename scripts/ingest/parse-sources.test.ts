import { describe, expect, it } from 'vitest';
import { parseSources } from './parse-sources.ts';

const page = (rows: string) => `<!DOCTYPE html><html><body><table>
<tr><th>Source</th><th>Name</th></tr>${rows}</table></body></html>`;

/** 95 filler rows so realistic fixtures clear the 90-pair threshold. */
const filler = Array.from({ length: 95 }, (_, i) =>
  `<tr><td>C${i}</td><td>Country ${i}</td></tr>`).join('');

describe('parseSources', () => {
  it('extracts code/name pairs', () => {
    const map = parseSources(page(
      `<tr><td>CIS</td><td>Commonwealth of Independent States</td></tr>` +
      `<tr><td>PRC</td><td>People's Republic of China</td></tr>` + filler,
    ));
    expect(map.get('CIS')).toBe('Commonwealth of Independent States');
    expect(map.get('PRC')).toBe("People's Republic of China");
  });

  it('strips nested markup from cells', () => {
    const map = parseSources(page(
      `<tr><td><b>US</b></td><td><a href="/x">United States</a></td></tr>` + filler,
    ));
    expect(map.get('US')).toBe('United States');
  });

  it('ignores the header row and any row without a short code', () => {
    const map = parseSources(page(
      `<tr><td>A very long cell that is not a code</td><td>Nope</td></tr>` + filler,
    ));
    expect(map.has('Source')).toBe(false);
    expect(map.size).toBe(95);
  });

  it('throws below the pair threshold, so a page redesign fails the run loudly', () => {
    expect(() => parseSources(page(
      `<tr><td>US</td><td>United States</td></tr>`,
    ))).toThrow(/only 1 owner code/i);
  });

  it('throws on a page with no table at all', () => {
    expect(() => parseSources('<html><body>down for maintenance</body></html>'))
      .toThrow(/owner code/i);
  });
});
