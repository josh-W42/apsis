import { useEffect, useRef, useState } from 'react';
import { startGlobe } from './globe.ts';
import { StaleBanner } from './ui/StaleBanner.tsx';

export function App() {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [staleSince, setStaleSince] = useState<string | null>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    let teardown: (() => void) | undefined;
    let cancelled = false;

    startGlobe(container)
      .then(({ stop, staleSince: since }) => {
        if (cancelled) stop();
        else { teardown = stop; setStaleSince(since); }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });

    return () => { cancelled = true; teardown?.(); };
  }, []);

  return (
    <>
      <div ref={ref} style={{ width: '100%', height: '100%' }} />
      {staleSince && <StaleBanner generatedAt={staleSince} />}
      {error && (
        <div style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          color: '#ff9b9b', font: '14px system-ui', textAlign: 'center', padding: 24,
        }}>
          Could not start the globe: {error}
        </div>
      )}
    </>
  );
}
