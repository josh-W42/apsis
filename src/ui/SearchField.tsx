import { theme } from './theme.ts';

export function SearchField(
  { value, onChange }: { value: string; onChange: (v: string) => void },
) {
  return (
    <div style={{ padding: 8, borderBottom: `1px solid ${theme.border}` }}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="search name or NORAD id"
        aria-label="Search satellites"
        spellCheck={false}
        style={{
          width: '100%', boxSizing: 'border-box',
          background: theme.bgRaised, border: `1px solid ${theme.border}`,
          color: theme.text, font: `12px ${theme.mono}`,
          padding: '5px 8px', outline: 'none',
        }}
      />
    </div>
  );
}
