import { describe, expect, it } from 'vitest';
import { checkDeployManifest } from './check.ts';

const good = JSON.stringify({
  generatedAt: '2026-09-25T11:39:42.135Z',
  objectCount: 16619,
  source: 'https://celestrak.org/',
  checksum: 'a8ba',
});

describe('checkDeployManifest', () => {
  it('accepts a manifest with objects and returns it', () => {
    expect(checkDeployManifest(good).objectCount).toBe(16619);
  });

  it('rejects a missing manifest', () => {
    expect(() => checkDeployManifest(undefined)).toThrow(/missing/);
  });

  it('rejects invalid JSON', () => {
    expect(() => checkDeployManifest('{not json')).toThrow(/not valid JSON/);
  });

  it('rejects zero objects', () => {
    const empty = JSON.stringify({ ...JSON.parse(good), objectCount: 0 });
    expect(() => checkDeployManifest(empty)).toThrow(/0 objects/);
  });

  it('rejects a manifest without an objectCount', () => {
    expect(() => checkDeployManifest('{}')).toThrow(/objects/);
  });

  it('rejects a manifest without generatedAt', () => {
    const noDate = JSON.stringify({ ...JSON.parse(good), generatedAt: undefined });
    expect(() => checkDeployManifest(noDate)).toThrow(/generatedAt/);
  });
});
