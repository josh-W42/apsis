import { BUCKETS, type ConstellationBucket } from '../catalog/constellation.ts';

/** Reference backgrounds the palette has to survive. */
export const NIGHT_EARTH = '#0d1a2a';
export const SPACE = '#05070d';

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
 * Constellation palette.
 *
 * Starlink is 67% of the catalog and has to recede — but the first attempt
 * did that with darkness (#3d5a73, 2.43:1 against the night side) and the
 * dots simply vanished over the unlit globe. It recedes by desaturation and
 * a smaller point size instead; see BUCKET_SIZE_SCALE. `palette.test.ts`
 * enforces a contrast floor so this cannot regress.
 *
 * The shader reads BUCKET_COLOR_LIST in BUCKETS order, so the legend
 * swatches and the dots cannot drift apart.
 */
export const BUCKET_COLORS: Record<ConstellationBucket, string> = {
  starlink: '#9ab3c9',
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

/**
 * Point-size multiplier per bucket. This is how Starlink recedes without
 * becoming invisible: smaller, not darker.
 */
export const BUCKET_SIZE_SCALE: Record<ConstellationBucket, number> = {
  starlink: 0.75,
  oneweb: 1,
  gnss: 1,
  geo: 1,
  other: 1,
};

export const BUCKET_COLOR_LIST: string[] = BUCKETS.map((b) => BUCKET_COLORS[b]);
export const BUCKET_SIZE_LIST: number[] = BUCKETS.map((b) => BUCKET_SIZE_SCALE[b]);
