import { IngestError, type OmmRecord } from '../../src/catalog/types.ts';

/** Fields SGP4 cannot run without. */
const REQUIRED: readonly (keyof OmmRecord)[] = [
  'NORAD_CAT_ID', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION',
  'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR',
  'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT',
];

/**
 * Parse a Celestrak GP JSON response.
 *
 * Celestrak serves HTTP 200 with a plain-text refusal ("GP data has not
 * updated since your last successful download...") when the catalog is
 * unchanged. A 200 status is therefore not sufficient to assume JSON.
 */
export function parseGpResponse(body: string): OmmRecord[] {
  const trimmed = body.trim();
  if (trimmed.length === 0) throw new IngestError('GP response body was empty');

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const preview = trimmed.slice(0, 120).replace(/\s+/g, ' ');
    throw new IngestError(`GP response was not valid JSON. Body began: "${preview}"`);
  }

  if (!Array.isArray(parsed)) {
    throw new IngestError('GP response was valid JSON but not an array');
  }
  if (parsed.length === 0) {
    throw new IngestError('GP response contained zero objects');
  }

  for (const record of parsed as OmmRecord[]) {
    for (const field of REQUIRED) {
      if (record[field] === undefined || record[field] === null) {
        throw new IngestError(
          `GP record ${record.NORAD_CAT_ID ?? '<no id>'} is missing ${field}`,
        );
      }
    }
  }
  return parsed as OmmRecord[];
}
