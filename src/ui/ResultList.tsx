import type { SearchOutcome } from '../catalog/search.ts';
import { resultSummary } from './format.ts';
import { theme } from './theme.ts';

export function ResultList({
  outcome, selectedCatalogIndex, onSelect,
}: {
  outcome: SearchOutcome;
  selectedCatalogIndex: number | null;
  onSelect: (catalogIndex: number) => void;
}) {
  const summary = resultSummary(outcome);
  if (outcome.hits.length === 0) return null;

  return (
    <div style={{ borderBottom: `1px solid ${theme.border}`, maxHeight: '38vh', overflowY: 'auto' }}>
      <div style={{
        padding: '5px 8px', font: `9px ${theme.mono}`,
        letterSpacing: '.12em', color: theme.labelDim,
      }}>
        {outcome.hits.length} OF {outcome.totalMatches.toLocaleString('en-US')}
      </div>
      {outcome.hits.map((hit) => {
        const selected = hit.catalogIndex === selectedCatalogIndex;
        return (
          <button
            key={hit.catalogIndex}
            onClick={() => onSelect(hit.catalogIndex)}
            style={{
              display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
              background: selected ? '#10203a' : 'transparent',
              borderLeft: `2px solid ${selected ? theme.text : 'transparent'}`,
              borderTop: 0, borderRight: 0, borderBottom: 0,
              color: selected ? theme.text : theme.textDim,
              font: `11px ${theme.mono}`, padding: '3px 8px',
            }}
          >
            {hit.entry.name}
            <span style={{ float: 'right', color: theme.label }}>{hit.entry.noradId}</span>
          </button>
        );
      })}
      {summary && (
        <div style={{
          padding: '5px 8px', font: `10px ${theme.mono}`, color: theme.labelDim,
        }}>
          {summary}
        </div>
      )}
    </div>
  );
}
