import { useEffect, useState } from 'react';
import { isNarrow } from '../input/pointer-profile.ts';

/**
 * Whether the viewport is too narrow for the fixed 300px rail.
 *
 * Width-driven on purpose, and separate from pointer profile: a narrow
 * desktop window has this problem too, not just phones.
 */
export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window === 'undefined' ? false : isNarrow(window.innerWidth),
  );

  useEffect(() => {
    const update = () => setNarrow(isNarrow(window.innerWidth));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return narrow;
}
