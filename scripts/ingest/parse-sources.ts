import { IngestError } from '../../src/catalog/types.ts';

export const SOURCES_URL = 'https://celestrak.org/satcat/sources.php';

/**
 * Minimum pairs a healthy page yields. The live page currently has 132.
 * Below this we assume the markup changed and fail rather than silently
 * shipping a catalog with unexpanded owner codes.
 */
const MIN_PAIRS = 90;

const stripTags = (html: string) => html.replace(/<[^>]+>/g, '').trim();

/**
 * Parse Celestrak's SATCAT sources page into a code -> name map.
 *
 * This is HTML, not a data file, so it can change shape without warning.
 * The pair threshold is what turns that from a silent regression into a
 * failed ingestion run that leaves the last good artifact in place.
 */
export function parseSources(html: string): Map<string, string> {
  const map = new Map<string, string>();

  for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((m) => stripTags(m[1] ?? ''));
    const [code, name] = cells;
    // Codes are short tokens; anything longer is prose or a header.
    if (!code || !name || code.length > 6 || code.toLowerCase() === 'source') continue;
    map.set(code, name);
  }

  if (map.size < MIN_PAIRS) {
    throw new IngestError(
      `Parsed only ${map.size} owner codes from ${SOURCES_URL} (expected at ` +
      `least ${MIN_PAIRS}). The page markup has probably changed. Refusing ` +
      `to emit a catalog with unexpanded owner codes.`,
    );
  }
  return map;
}
