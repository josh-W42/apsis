import type * as THREE from 'three';

/**
 * NASA Visible Earth imagery, public domain.
 *
 *   day2k  land_shallow_topo_2048.jpg      2048x1024  Blue Marble
 *   day5k  world.200406.3x5400x2700.jpg    5400x2700  Blue Marble Next Generation
 *   night  earth_lights_lrg.jpg            2400x1200  Earth's City Lights
 */
export const EARTH_TEXTURES = {
  day2k: '/textures/day-2k.jpg',
  day5k: '/textures/day-5k.jpg',
  night: '/textures/night.jpg',
} as const;

/** The slice of THREE.TextureLoader this module needs, so it can be faked. */
export interface TextureLoaderLike {
  load(
    url: string,
    onLoad: (texture: THREE.Texture) => void,
    onProgress?: undefined,
    onError?: (error: unknown) => void,
  ): unknown;
}

export interface EarthTextures {
  day: THREE.Texture | null;
  night: THREE.Texture | null;
}

/** Resolve to the texture, or to null if it fails — never reject. */
function loadOrNull(
  loader: TextureLoaderLike, url: string,
): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    // A synchronous throw (no DOM, e.g. under node) would otherwise become a
    // rejection, breaking the promise above.
    try {
      loader.load(url, (texture) => resolve(texture), undefined, () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

/**
 * Load the base day/night pair, then fetch the high-resolution day map in
 * the background and hand it back through `onUpgrade`.
 *
 * Nothing here rejects. A missing texture leaves the globe on its flat
 * fallback colour rather than breaking the page, which matters because the
 * textures are 3 MB of optional polish, not load-bearing data.
 */
export async function loadEarthTextures(
  loader: TextureLoaderLike,
  onUpgrade?: (day: THREE.Texture) => void,
): Promise<EarthTextures> {
  const [day, night] = await Promise.all([
    loadOrNull(loader, EARTH_TEXTURES.day2k),
    loadOrNull(loader, EARTH_TEXTURES.night),
  ]);

  // Only chase the upgrade if the base map arrived. Swapping a high-res
  // texture onto a globe that never got its base one would pop detail onto
  // a flat-coloured sphere.
  if (day && onUpgrade) {
    void loadOrNull(loader, EARTH_TEXTURES.day5k).then((hi) => {
      if (hi) onUpgrade(hi);
    });
  }

  return { day, night };
}
