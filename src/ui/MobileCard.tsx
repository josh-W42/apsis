import type { CatalogIndexEntry } from '../catalog/types.ts';
import type { LiveState } from '../math/geodetic.ts';
import { formatKm, type TrackingStatus } from './format.ts';
import { theme } from './theme.ts';

const STATUS_COLOR: Record<TrackingStatus, string> = {
  TRACKING: theme.live, ERROR: theme.error, STALE: theme.warn,
};

/**
 * Collapsed detail for narrow viewports.
 *
 * The full panel lives in the drawer on desktop, but on a phone the drawer
 * covers the globe — and selection is a visual act. This docks the essentials
 * at the bottom so the dot and its numbers are on screen together.
 */
export function MobileCard({
  entry, live, status, expanded, onToggleExpanded, children,
}: {
  entry: CatalogIndexEntry;
  live: LiveState | null;
  status: TrackingStatus;
  expanded: boolean;
  onToggleExpanded: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 15,
      background: '#080c14f5', borderTop: `1px solid ${theme.border}`,
      maxHeight: expanded ? '70vh' : undefined,
      overflowY: expanded ? 'auto' : 'visible',
      font: `11px ${theme.mono}`,
    }}>
      <button
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        style={{
          display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
          background: 'transparent', border: 0, padding: '10px 12px',
          color: theme.text, font: `11px ${theme.mono}`,
        }}
      >
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ font: `12px ${theme.mono}` }}>{entry.name}</span>
          <span style={{
            font: `9px ${theme.mono}`, color: STATUS_COLOR[status],
            border: `1px solid ${STATUS_COLOR[status]}55`, padding: '1px 5px',
          }}>
            {status}
          </span>
        </span>

        <span style={{ display: 'flex', gap: 18, marginTop: 8, alignItems: 'flex-end' }}>
          <span>
            <span style={{ font: `15px ${theme.mono}`, color: theme.live }}>
              {live ? formatKm(live.altitudeKm, 0).replace(' km', '') : '—'}
            </span>
            <span style={{ font: `9px ${theme.mono}`, color: theme.labelDim }}> KM ALT</span>
          </span>
          <span>
            <span style={{ font: `15px ${theme.mono}`, color: theme.live }}>
              {live ? live.speedKmS.toFixed(2) : '—'}
            </span>
            <span style={{ font: `9px ${theme.mono}`, color: theme.labelDim }}> KM/S</span>
          </span>
          <span style={{ marginLeft: 'auto', font: `9px ${theme.mono}`, color: theme.label }}>
            {expanded ? 'less ▾' : 'more ▴'}
          </span>
        </span>
      </button>

      {expanded && <div style={{ borderTop: `1px solid ${theme.rule}` }}>{children}</div>}
    </div>
  );
}
