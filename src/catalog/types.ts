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
  owner: string | null;
  launchDate: string | null;   // ISO date
  apogeeKm: number | null;
  perigeeKm: number | null;
}

/** One catalog entry: the SGP4 elements plus display metadata. */
export interface CatalogEntry {
  omm: OmmRecord;
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
