import type { CatalogEntry, OmmRecord, SatcatMeta } from '../../src/catalog/types.ts';
import type { SatcatRow } from './parse-satcat.ts';

const EMPTY_META: SatcatMeta = {
  objectType: null, owner: null, launchDate: null,
  apogeeKm: null, perigeeKm: null,
};

/**
 * Join GP elements to SATCAT metadata.
 *
 * Objects with a DECAY_DATE are dropped: they have re-entered, and SGP4 will
 * propagate them to meaningless positions. GP records with no SATCAT row are
 * kept with null metadata — newly launched objects appear in GP first, and
 * must not disappear from the globe while SATCAT catches up.
 *
 * Output is sorted by NORAD id so the artifact is byte-stable across runs
 * when the inputs have not changed.
 */
export function joinCatalog(
  omm: OmmRecord[],
  satcat: Map<number, SatcatRow>,
): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const record of omm) {
    const row = satcat.get(record.NORAD_CAT_ID);
    if (row?.decayDate) continue;
    entries.push({ omm: record, meta: row?.meta ?? EMPTY_META });
  }
  entries.sort((a, b) => a.omm.NORAD_CAT_ID - b.omm.NORAD_CAT_ID);
  return entries;
}
