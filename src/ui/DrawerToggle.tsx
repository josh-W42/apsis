import { theme } from './theme.ts';

export function DrawerToggle(
  { open, onToggle }: { open: boolean; onToggle: () => void },
) {
  return (
    <button
      onClick={onToggle}
      aria-label={open ? 'Close panel' : 'Open panel'}
      aria-expanded={open}
      style={{
        position: 'absolute', top: 10, left: 10, zIndex: 20,
        width: 40, height: 40,          // 40px square: a comfortable touch target
        background: '#080c14ee', border: `1px solid ${theme.border}`,
        color: theme.text, font: `16px ${theme.mono}`,
        cursor: 'pointer', lineHeight: 1,
      }}
    >
      {open ? '×' : '☰'}
    </button>
  );
}
