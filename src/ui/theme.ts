import { BUCKETS, type ConstellationBucket } from '../catalog/constellation.ts';

/**
 * Mission-control tokens. Monospace, dense, muted blue-grey on the dark
 * field, green reserved for live values so the eye finds them immediately.
 */
export const theme = {
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  bg: '#080c14',
  bgRaised: '#0c1320',
  border: '#1d3347',
  rule: '#16283a',
  label: '#4e7ea3',
  labelDim: '#3d6180',
  text: '#cfe9ff',
  textDim: '#a8c8e0',
  live: '#9fe0a8',
  warn: '#ffd98a',
  error: '#ff9b9b',
  railWidth: 300,
} as const;

/**
 * Constellation palette. Starlink is deliberately the most muted: it is 67%
 * of the catalog and must recede so everything else is visible at all.
 *
 * The shader reads BUCKET_COLOR_LIST in BUCKETS order, so the legend
 * swatches and the dots cannot drift apart.
 */
export const BUCKET_COLORS: Record<ConstellationBucket, string> = {
  starlink: '#3d5a73',
  oneweb: '#c9a227',
  gnss: '#7ec8a9',
  geo: '#d98c5f',
  other: '#8fd6ff',
};

export const BUCKET_LABELS: Record<ConstellationBucket, string> = {
  starlink: 'Starlink',
  oneweb: 'OneWeb',
  gnss: 'GNSS',
  geo: 'GEO belt',
  other: 'Other',
};

export const BUCKET_COLOR_LIST: string[] = BUCKETS.map((b) => BUCKET_COLORS[b]);
