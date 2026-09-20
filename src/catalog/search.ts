import type { CatalogIndexEntry } from './types.ts';

export interface SearchHit {
  catalogIndex: number;
  entry: CatalogIndexEntry;
}

export interface SearchOutcome {
  hits: SearchHit[];
  /** Matches before the cap — what "and N more" is computed from. */
  totalMatches: number;
  truncated: boolean;
}

const DEFAULT_LIMIT = 20;

// Lower rank sorts first.
const RANK_NORAD = 0;
const RANK_DESIGNATOR = 1;
const RANK_NAME_PREFIX = 2;
const RANK_NAME_SUBSTRING = 3;

function rankOf(entry: CatalogIndexEntry, query: string): number | null {
  if (String(entry.noradId) === query) return RANK_NORAD;
  if (entry.intlDesignator.toUpperCase() === query) return RANK_DESIGNATOR;
  const name = entry.name.toUpperCase();
  if (name.startsWith(query)) return RANK_NAME_PREFIX;
  if (name.includes(query)) return RANK_NAME_SUBSTRING;
  return null;
}

/**
 * Rank, cap and count.
 *
 * A single query can match most of the catalog — "starlink" hits 11,114 of
 * 16,578 — so the cap is load-bearing, and `totalMatches` is what lets the UI
 * say "and 11,094 more" instead of rendering a wall.
 *
 * A full scan measures ~1.6 ms over the real catalog, so there is no index
 * structure here and none is needed.
 */
export function searchCatalog(
  index: CatalogIndexEntry[], query: string, limit = DEFAULT_LIMIT,
): SearchOutcome {
  const q = query.trim().toUpperCase();
  if (q.length === 0) return { hits: [], totalMatches: 0, truncated: false };

  // One bucket per rank, each capped at `limit`. A query can match most of
  // the catalog, and materialising all 11,114 Starlink hits just to return
  // 20 of them cost ~13 ms per keystroke. Bucketing keeps at most
  // 4 * limit objects alive and removes the sort entirely.
  const buckets: SearchHit[][] = [[], [], [], []];
  let totalMatches = 0;

  for (let i = 0; i < index.length; i++) {
    const entry = index[i]!;
    const rank = rankOf(entry, q);
    if (rank === null) continue;
    totalMatches++;
    const bucket = buckets[rank]!;
    // Catalog order is ascending NORAD id, so first-come is a stable order
    // within a rank and later entries can be dropped outright.
    if (bucket.length < limit) bucket.push({ catalogIndex: i, entry });
  }

  const hits: SearchHit[] = [];
  for (const bucket of buckets) {
    for (const hit of bucket) {
      if (hits.length >= limit) break;
      hits.push(hit);
    }
    if (hits.length >= limit) break;
  }

  return { hits, totalMatches, truncated: totalMatches > limit };
}
