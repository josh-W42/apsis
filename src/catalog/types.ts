/** A Celestrak GP (OMM) record, as served by gp.php?FORMAT=json. */
export interface OmmRecord {
  OBJECT_NAME: string;
  OBJECT_ID: string;
  NORAD_CAT_ID: number;
  EPOCH: string;
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  BSTAR: number;
  MEAN_MOTION_DOT: number;
  MEAN_MOTION_DDOT: number;
  EPHEMERIS_TYPE: number;
  CLASSIFICATION_TYPE: string;
  ELEMENT_SET_NO: number;
  REV_AT_EPOCH: number;
}

/** Metadata drawn from satcat.csv. Null when the object has no SATCAT row. */
export interface SatcatMeta {
  objectType: string | null;   // PAY | R/B | DEB | UNK
  owner: string | null;        // raw SATCAT code, e.g. "CIS"
  ownerName: string | null;    // expanded, e.g. "Commonwealth of Independent States"
  launchDate: string | null;   // ISO date
  apogeeKm: number | null;
  perigeeKm: number | null;
}

/**
 * The subset of an OMM record that anything downstream actually reads:
 * the eleven fields `json2satrec` consumes, plus name and id for display.
 *
 * EPHEMERIS_TYPE, CLASSIFICATION_TYPE and REV_AT_EPOCH are deliberately
 * absent — verified against satellite.js 7.1.0's io.js, which reads none of
 * them, and nothing in the UI shows them.
 */
export type TrimmedOmm = Pick<
  OmmRecord,
  | 'NORAD_CAT_ID' | 'EPOCH' | 'MEAN_MOTION' | 'ECCENTRICITY' | 'INCLINATION'
  | 'RA_OF_ASC_NODE' | 'ARG_OF_PERICENTER' | 'MEAN_ANOMALY' | 'BSTAR'
  | 'MEAN_MOTION_DOT' | 'MEAN_MOTION_DDOT' | 'OBJECT_NAME' | 'OBJECT_ID'
  // Required by satellite.js's OMMJsonObject type though json2satrec never
  // reads it. Kept to satisfy the declared contract rather than casting
  // around it; the value repeats, so gzip costs us almost nothing.
  | 'ELEMENT_SET_NO'
>;

/** Field list backing the trim, kept beside the type so they cannot drift. */
export const TRIMMED_OMM_FIELDS: readonly (keyof TrimmedOmm)[] = [
  'NORAD_CAT_ID', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION',
  'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR',
  'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT', 'OBJECT_NAME', 'OBJECT_ID',
  'ELEMENT_SET_NO',
];

/** One catalog entry: the trimmed SGP4 elements plus display metadata. */
export interface CatalogEntry {
  omm: TrimmedOmm;
  meta: SatcatMeta;
}

export interface Manifest {
  generatedAt: string;   // ISO timestamp
  objectCount: number;
  source: string;
  checksum: string;      // sha256 of catalog.json
}

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestError';
  }
}
