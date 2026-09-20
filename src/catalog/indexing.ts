import type { CatalogEntry, CatalogIndexEntry } from './types.ts';

/**
 * Three index spaces exist in this app and confusing them selects the wrong
 * satellite with no error at all:
 *
 *   catalog index i  in [0, count)                index[], positions[], velocities[]
 *   live index    j  in [0, liveIndices.length)   render buffers, picking
 *
 *   i = liveIndices[j]
 *
 * These helpers are the only sanctioned way to convert between them.
 */

export function catalogIndexFromLive(
  liveIndices: Uint32Array, liveIndex: number,
): number | null {
  if (liveIndex < 0 || liveIndex >= liveIndices.length) return null;
  return liveIndices[liveIndex]!;
}

/** Catalog index -> live index, with -1 marking "not renderable". */
export function buildReverseMap(
  liveIndices: Uint32Array, count: number,
): Int32Array {
  const reverse = new Int32Array(count).fill(-1);
  for (let j = 0; j < liveIndices.length; j++) reverse[liveIndices[j]!] = j;
  return reverse;
}

export function liveIndexFromCatalog(
  reverseMap: Int32Array, catalogIndex: number,
): number | null {
  if (catalogIndex < 0 || catalogIndex >= reverseMap.length) return null;
  const j = reverseMap[catalogIndex]!;
  return j < 0 ? null : j;
}

/** Project a catalog entry down to what the UI needs. */
export function buildIndexEntry(entry: CatalogEntry): CatalogIndexEntry {
  return {
    noradId: entry.omm.NORAD_CAT_ID,
    name: entry.omm.OBJECT_NAME,
    intlDesignator: entry.omm.OBJECT_ID,
    objectType: entry.meta.objectType,
    owner: entry.meta.owner,
    ownerName: entry.meta.ownerName,
    launchDate: entry.meta.launchDate,
    apogeeKm: entry.meta.apogeeKm,
    perigeeKm: entry.meta.perigeeKm,
    inclinationDeg: entry.omm.INCLINATION,
    meanMotion: entry.omm.MEAN_MOTION,
  };
}
