import { createHash } from 'node:crypto';
import { IngestError, type CatalogEntry, type Manifest } from '../../src/catalog/types.ts';
import { joinCatalog } from './join.ts';
import { parseGpResponse } from './parse-gp.ts';
import { parseSatcat } from './parse-satcat.ts';
import { SOURCES_URL, parseSources } from './parse-sources.ts';

export { SOURCES_URL } from './parse-sources.ts';

export const GP_URL =
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json';
export const SATCAT_URL = 'https://celestrak.org/pub/satcat.csv';

export interface IngestDeps {
  fetchText(url: string): Promise<string>;
  now(): Date;
}

export interface IngestResult {
  catalog: CatalogEntry[];
  manifest: Manifest;
  catalogJson: string;
}

/**
 * Fetch, validate, join and trim the catalog. Performs no I/O directly —
 * all collaborators arrive through `deps`, which is what keeps this testable
 * without module mocking.
 */
export async function runIngest(deps: IngestDeps): Promise<IngestResult> {
  const [gpBody, satcatBody, sourcesBody] = await Promise.all([
    deps.fetchText(GP_URL),
    deps.fetchText(SATCAT_URL),
    deps.fetchText(SOURCES_URL),
  ]);

  const omm = parseGpResponse(gpBody);
  const satcat = parseSatcat(satcatBody);
  const owners = parseSources(sourcesBody);
  const catalog = joinCatalog(omm, satcat, owners);

  if (catalog.length === 0) {
    throw new IngestError(
      `Catalog contained zero objects after joining ${omm.length} GP records ` +
      `against ${satcat.size} SATCAT rows. Refusing to emit an empty artifact.`,
    );
  }

  const catalogJson = JSON.stringify(catalog);
  const checksum = createHash('sha256').update(catalogJson).digest('hex');

  return {
    catalog,
    catalogJson,
    manifest: {
      generatedAt: deps.now().toISOString(),
      objectCount: catalog.length,
      source: GP_URL,
      checksum,
    },
  };
}
