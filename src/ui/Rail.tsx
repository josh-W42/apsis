import type { ReactNode } from 'react';
import { theme } from './theme.ts';

/**
 * The left rail: search, results and detail in one column.
 *
 * Desktop only by design — at phone width this leaves no globe, and a
 * bottom-sheet variant is explicitly out of scope.
 */
export function Rail({ children }: { children: ReactNode }) {
  return (
    <div style={{
      position: 'absolute', left: 0, top: 0, bottom: 0,
      width: theme.railWidth,
      background: theme.bg, borderRight: `1px solid ${theme.border}`,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden', zIndex: 5,
    }}>
      {children}
    </div>
  );
}
