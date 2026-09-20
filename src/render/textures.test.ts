import { describe, expect, it, vi } from 'vitest';
import { EARTH_TEXTURES, loadEarthTextures, type TextureLoaderLike } from './textures.ts';

/** Hand-written loader fake — injected, no module mocking. */
function fakeLoader(behaviour: Record<string, 'ok' | 'fail'>): TextureLoaderLike & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    // Signature matches THREE.TextureLoader: (url, onLoad, onProgress, onError)
    load(url, onLoad, _onProgress, onError) {
      asked.push(url);
      queueMicrotask(() => {
        if (behaviour[url] === 'fail') onError?.(new Error(`404 ${url}`));
        else onLoad({ url } as never);
      });
    },
  };
}

describe('EARTH_TEXTURES', () => {
  it('points at files under the served textures directory', () => {
    for (const url of [EARTH_TEXTURES.day2k, EARTH_TEXTURES.day5k, EARTH_TEXTURES.night]) {
      expect(url).toMatch(/^\/textures\/.+\.jpg$/);
    }
  });

  it('keeps the progressive pair distinct', () => {
    expect(EARTH_TEXTURES.day2k).not.toBe(EARTH_TEXTURES.day5k);
  });
});

describe('loadEarthTextures', () => {
  it('resolves the base pair before requesting the upgrade', async () => {
    const loader = fakeLoader({});
    const result = await loadEarthTextures(loader);
    expect(result.day).toBeTruthy();
    expect(result.night).toBeTruthy();
    // Only the base pair is fetched up front; the upgrade is separate.
    expect(loader.asked).toContain(EARTH_TEXTURES.day2k);
    expect(loader.asked).toContain(EARTH_TEXTURES.night);
    expect(loader.asked).not.toContain(EARTH_TEXTURES.day5k);
  });

  it('returns nulls rather than throwing when a texture is missing', async () => {
    const loader = fakeLoader({
      [EARTH_TEXTURES.day2k]: 'fail',
      [EARTH_TEXTURES.night]: 'fail',
    });
    const result = await loadEarthTextures(loader);
    expect(result.day).toBeNull();
    expect(result.night).toBeNull();
  });

  it('keeps whichever half succeeded', async () => {
    const loader = fakeLoader({ [EARTH_TEXTURES.night]: 'fail' });
    const result = await loadEarthTextures(loader);
    expect(result.day).toBeTruthy();
    expect(result.night).toBeNull();
  });

  it('delivers the high-resolution upgrade through the callback', async () => {
    const loader = fakeLoader({});
    const onUpgrade = vi.fn();
    await loadEarthTextures(loader, onUpgrade);
    await new Promise((r) => setTimeout(r, 0));
    expect(loader.asked).toContain(EARTH_TEXTURES.day5k);
    expect(onUpgrade).toHaveBeenCalledTimes(1);
  });

  it('does not call the upgrade callback when the upgrade fails', async () => {
    const loader = fakeLoader({ [EARTH_TEXTURES.day5k]: 'fail' });
    const onUpgrade = vi.fn();
    await loadEarthTextures(loader, onUpgrade);
    await new Promise((r) => setTimeout(r, 0));
    expect(onUpgrade).not.toHaveBeenCalled();
  });

  it('skips the upgrade entirely when the base day map failed', async () => {
    // Upgrading a globe that never got its base texture would pop a
    // high-res map onto a flat-coloured sphere.
    const loader = fakeLoader({ [EARTH_TEXTURES.day2k]: 'fail' });
    const onUpgrade = vi.fn();
    await loadEarthTextures(loader, onUpgrade);
    await new Promise((r) => setTimeout(r, 0));
    expect(loader.asked).not.toContain(EARTH_TEXTURES.day5k);
    expect(onUpgrade).not.toHaveBeenCalled();
  });
});
