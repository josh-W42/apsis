import type { ReactNode } from 'react';
import { theme } from './theme.ts';

/**
 * The left rail: search, results and settings in one column.
 *
 * Below the narrow breakpoint it becomes a drawer that slides out of the
 * way, because a fixed 300px rail leaves a 375px phone a 75px strip of
 * globe. Above it, behaviour is unchanged.
 */
export function Rail(
  { children, drawer = false, open = true }:
  { children: ReactNode; drawer?: boolean; open?: boolean },
) {
  return (
    <div
      // Hidden from assistive tech when slid away, so a closed drawer is
      // not still reachable by keyboard or screen reader.
      aria-hidden={drawer && !open}
      style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: theme.railWidth,
        maxWidth: drawer ? '85vw' : undefined,
        background: theme.bg, borderRight: `1px solid ${theme.border}`,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', zIndex: 18,
        transform: drawer && !open ? 'translateX(-100%)' : 'translateX(0)',
        transition: 'transform 180ms ease-out',
        boxShadow: drawer && open ? '6px 0 24px rgba(0,0,0,.5)' : undefined,
        visibility: drawer && !open ? 'hidden' : 'visible',
      }}
    >
      {children}
    </div>
  );
}
