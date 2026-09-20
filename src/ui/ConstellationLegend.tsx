import { BUCKETS } from '../catalog/constellation.ts';
import type { StarlinkMode } from '../render/satellites.ts';
import { BUCKET_COLORS, BUCKET_LABELS, theme } from './theme.ts';

const MODES: StarlinkMode[] = ['show', 'dim', 'hide'];

export function ConstellationLegend({
  mode, onModeChange,
}: { mode: StarlinkMode; onModeChange: (m: StarlinkMode) => void }) {
  return (
    <div style={{
      borderTop: `1px solid ${theme.border}`, padding: '8px 10px',
      font: `10px ${theme.mono}`,
    }}>
      <div style={{ letterSpacing: '.14em', color: theme.labelDim, marginBottom: 6 }}>
        CONSTELLATION
      </div>
      {BUCKETS.map((b) => (
        <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0' }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', background: BUCKET_COLORS[b],
          }} />
          <span style={{ color: theme.textDim }}>{BUCKET_LABELS[b]}</span>
        </div>
      ))}

      <div style={{ letterSpacing: '.14em', color: theme.labelDim, margin: '9px 0 5px' }}>
        STARLINK
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {MODES.map((m) => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            style={{
              flex: 1, cursor: 'pointer', textTransform: 'uppercase',
              background: m === mode ? '#10203a' : 'transparent',
              border: `1px solid ${m === mode ? theme.label : theme.border}`,
              color: m === mode ? theme.text : theme.label,
              font: `9px ${theme.mono}`, padding: '3px 0', letterSpacing: '.1em',
            }}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}
