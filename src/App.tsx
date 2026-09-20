import { useEffect, useMemo, useRef, useState } from 'react';
import { searchCatalog } from './catalog/search.ts';
import type { CatalogIndexEntry } from './catalog/types.ts';
import { startGlobe, type GlobeHandle, type Selection } from './globe.ts';
import type { LiveState } from './math/geodetic.ts';
import type { StarlinkMode } from './render/satellites.ts';
import { ConstellationLegend } from './ui/ConstellationLegend.tsx';
import { DrawerToggle } from './ui/DrawerToggle.tsx';
import { MobileCard } from './ui/MobileCard.tsx';
import { useIsNarrow } from './ui/useLayoutMode.ts';
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
  const narrow = useIsNarrow();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cardExpanded, setCardExpanded] = useState(false);

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
        // Install the dev probe for the instance we actually keep. Doing it
        // inside startGlobe let StrictMode's discarded first globe win the
        // global and report zeros for everything.
        if (import.meta.env.DEV && handle.debug) {
          (globalThis as unknown as Record<string, unknown>).__apsis = handle.debug;
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));

    return () => {
      cancelled = true;
      globeRef.current = null;
      if (import.meta.env.DEV) {
        delete (globalThis as unknown as Record<string, unknown>).__apsis;
      }
      teardown?.();
    };
  }, []);

  const outcome = useMemo(() => searchCatalog(index, query), [index, query]);
  const entry = selected === null ? null : index[selected.catalogIndex] ?? null;
  // ERROR outranks STALE: a broken solution is a stronger caveat than an
  // ageing catalog, and it is specific to the object on screen.
  const status: TrackingStatus =
    selected && !selected.renderable ? 'ERROR' : staleSince ? 'STALE' : 'TRACKING';

  return (
    <>
      <div
        ref={ref}
        style={{ position: 'absolute', inset: 0, left: narrow ? 0 : theme.railWidth }}
      />
      {narrow && (
        <DrawerToggle open={drawerOpen} onToggle={() => setDrawerOpen((v) => !v)} />
      )}
      {staleSince && <StaleBanner generatedAt={staleSince} />}
      <Rail drawer={narrow} open={!narrow || drawerOpen}>
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
            // On a phone the drawer covers the globe, so get out of the way
            // of the thing the user just asked to see.
            if (narrow) setDrawerOpen(false);
          }}
        />
        {/* On narrow screens the detail moves to the bottom card. */}
        {!narrow && entry && (
          <DetailPanel
            entry={entry} live={live} status={status}
            follow={follow}
            onFollowChange={(f) => globeRef.current?.setFollow(f)}
          />
        )}
        {!narrow && !entry && (
          <div style={{
            padding: 12, font: `11px ${theme.mono}`, color: theme.labelDim, lineHeight: 1.7,
          }}>
            {index.length.toLocaleString('en-US')} objects tracked.<br />
            Click a satellite or search by name.
          </div>
        )}
        <div style={{ marginTop: 'auto' }}>
          <ConstellationLegend
            mode={starlinkMode}
            onModeChange={(m) => { setStarlinkMode(m); globeRef.current?.setStarlinkMode(m); }}
          />
        </div>
      </Rail>

      {narrow && entry && (
        <MobileCard
          entry={entry} live={live} status={status}
          expanded={cardExpanded}
          onToggleExpanded={() => setCardExpanded((v) => !v)}
        >
          <DetailPanel
            entry={entry} live={live} status={status}
            follow={follow}
            onFollowChange={(f) => globeRef.current?.setFollow(f)}
          />
        </MobileCard>
      )}
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
