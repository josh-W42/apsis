import { classifyConstellation } from '../catalog/constellation.ts';
import { classifyRegime, regimeLabel } from '../catalog/regime.ts';
import type { CatalogIndexEntry } from '../catalog/types.ts';
import { periodMinutes, type LiveState } from '../math/geodetic.ts';
import { formatKm, formatLatLon, formatPeriod, type TrackingStatus } from './format.ts';
import { BUCKET_COLORS, BUCKET_LABELS, theme } from './theme.ts';

const STATUS_COLOR: Record<TrackingStatus, string> = {
  TRACKING: theme.live, ERROR: theme.error, STALE: theme.warn,
};

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
      <span style={{ color: theme.label }}>{label}</span>
      <span style={{ color: accent ?? theme.textDim }}>{value}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{
      font: `9px ${theme.mono}`, letterSpacing: '.14em', color: theme.labelDim,
      borderBottom: `1px solid ${theme.rule}`, paddingBottom: 3, margin: '9px 0 6px',
    }}>
      {children}
    </div>
  );
}

export function DetailPanel({
  entry, live, status,
}: {
  entry: CatalogIndexEntry;
  live: LiveState | null;
  status: TrackingStatus;
}) {
  const regime = classifyRegime(entry.apogeeKm, entry.perigeeKm);
  const bucket = classifyConstellation(entry.name, entry.apogeeKm, entry.perigeeKm);

  return (
    <div style={{ font: `11px ${theme.mono}`, overflowY: 'auto', flex: 1 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '7px 10px', borderBottom: `1px solid ${theme.border}`,
        background: theme.bgRaised,
      }}>
        <span style={{ font: `10px ${theme.mono}`, letterSpacing: '.14em', color: theme.label }}>
          OBJ {entry.noradId}
        </span>
        <span style={{
          font: `9px ${theme.mono}`, color: STATUS_COLOR[status],
          border: `1px solid ${STATUS_COLOR[status]}55`, padding: '1px 5px',
        }}>
          {status}
        </span>
      </div>

      <div style={{ padding: 10 }}>
        <div style={{ font: `13px ${theme.mono}`, color: theme.text, letterSpacing: '.04em' }}>
          {entry.name}
        </div>
        <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', background: BUCKET_COLORS[bucket],
          }} />
          <span style={{ font: `9px ${theme.mono}`, color: theme.label }}>
            {BUCKET_LABELS[bucket]} · {regimeLabel(regime)}
          </span>
        </div>

        <SectionLabel>LIVE</SectionLabel>
        {live ? (
          <>
            <Row label="ALT" value={formatKm(live.altitudeKm)} accent={theme.live} />
            <Row label="VEL" value={`${live.speedKmS.toFixed(3)} km/s`} accent={theme.live} />
            <Row label="POS" value={formatLatLon(live.latDeg, live.lonDeg)} accent={theme.live} />
          </>
        ) : (
          <Row label="ALT" value="—" />
        )}

        <SectionLabel>ORBIT</SectionLabel>
        <Row label="APO" value={formatKm(entry.apogeeKm, 0)} />
        <Row label="PER" value={formatKm(entry.perigeeKm, 0)} />
        <Row label="INC" value={`${entry.inclinationDeg.toFixed(3)}°`} />
        <Row label="PRD" value={formatPeriod(periodMinutes(entry.meanMotion))} />

        <SectionLabel>IDENTITY</SectionLabel>
        <Row label="INTL" value={entry.intlDesignator} />
        <Row label="TYPE" value={entry.objectType ?? '—'} />
        <Row label="OWNER" value={entry.ownerName ?? entry.owner ?? '—'} />
        <Row label="LAUNCH" value={entry.launchDate ?? '—'} />
      </div>
    </div>
  );
}
