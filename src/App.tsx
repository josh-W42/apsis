import { useEffect, useMemo, useRef, useState } from 'react';
import { searchCatalog } from './catalog/search.ts';
import type { CatalogIndexEntry } from './catalog/types.ts';
import { startGlobe, type GlobeHandle, type Selection } from './globe.ts';
import type { LiveState } from './math/geodetic.ts';
import type { StarlinkMode } from './render/satellites.ts';
import { ConstellationLegend } from './ui/ConstellationLegend.tsx';
import { DetailPanel } from './ui/DetailPanel.tsx';
import type { TrackingStatus } from './ui/format.ts';
import { Rail } from './ui/Rail.tsx';
import { ResultList } from './ui/ResultList.tsx';
import { SearchField } from './ui/SearchField.tsx';
import { StaleBanner } from './ui/StaleBanner.tsx';
import { theme } from './ui/theme.ts';

export function App() {
  const ref = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeHandle | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [staleSince, setStaleSince] = useState<string | null>(null);
  const [index, setIndex] = useState<CatalogIndexEntry[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Selection | null>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [starlinkMode, setStarlinkMode] = useState<StarlinkMode>('show');
  const [follow, setFollow] = useState(false);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    let teardown: (() => void) | undefined;
    let cancelled = false;

    startGlobe(container)
      .then((handle) => {
        if (cancelled) { handle.stop(); return; }
        globeRef.current = handle;
        teardown = handle.stop;
        setStaleSince(handle.staleSince);
        setIndex(handle.index);
        handle.onSelection(setSelected);
        handle.onLiveState(setLive);
        handle.onFollowChange(setFollow);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));

    return () => { cancelled = true; globeRef.current = null; teardown?.(); };
  }, []);

  const outcome = useMemo(() => searchCatalog(index, query), [index, query]);
  const entry = selected === null ? null : index[selected.catalogIndex] ?? null;
  // ERROR outranks STALE: a broken solution is a stronger caveat than an
  // ageing catalog, and it is specific to the object on screen.
  const status: TrackingStatus =
    selected && !selected.renderable ? 'ERROR' : staleSince ? 'STALE' : 'TRACKING';

  return (
    <>
      <div ref={ref} style={{ position: 'absolute', inset: 0, left: theme.railWidth }} />
      {staleSince && <StaleBanner generatedAt={staleSince} />}
      <Rail>
        <SearchField value={query} onChange={setQuery} />
        <ResultList
          outcome={outcome}
          selectedCatalogIndex={selected?.catalogIndex ?? null}
          onSelect={(i) => {
            globeRef.current?.select(i);
            // Selecting from search means "show me this one", so follow it.
            // Clicking a dot on the globe does not, since you are already
            // looking at where it is.
            globeRef.current?.setFollow(true);
          }}
        />
        {entry
          ? (
            <DetailPanel
              entry={entry} live={live} status={status}
              follow={follow}
              onFollowChange={(f) => globeRef.current?.setFollow(f)}
            />
          )
          : (
            <div style={{
              padding: 12, font: `11px ${theme.mono}`, color: theme.labelDim, lineHeight: 1.7,
            }}>
              {index.length.toLocaleString('en-US')} objects tracked.<br />
              Click a satellite or search by name.
            </div>
          )}
        <ConstellationLegend
          mode={starlinkMode}
          onModeChange={(m) => { setStarlinkMode(m); globeRef.current?.setStarlinkMode(m); }}
        />
      </Rail>
      {error && (
        <div style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          color: theme.error, font: `14px ${theme.mono}`, textAlign: 'center', padding: 24,
        }}>
          Could not start the globe: {error}
        </div>
      )}
    </>
  );
}
