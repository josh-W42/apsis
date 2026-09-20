# apsis Phase 2 (Interaction) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click or search any of the 16,578 satellites and see its orbit trail, ground track, and a live detail panel — with constellation colour-coding and a Starlink control that makes the rest of the catalog visible.

**Architecture:** The worker sends a one-shot metadata index at `ready`, after which search and the detail panel run entirely on the main thread with no messaging. Live values (altitude, speed, ground point) derive from the position and velocity buffers the main thread already receives. GPU colour-ID picking maps a cursor position to a satellite through the same Hermite vertex path the visible render uses. Trails are the one post-`ready` worker request.

**Tech Stack:** TypeScript, Vite, React 19, vitest, Three.js 0.186.0, satellite.js 7.1.0, Node ≥23, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-19-satellite-globe-design.md` (revision 3, section *Phase 2 — interaction design*)

## Global Constraints

Everything in phase 1's Global Constraints still holds. Repeated here because this plan may be read alone:

- **Package manager is pnpm**, not npm and not bun. npm 11.2.0 crashes resolving vitest's peer set; pnpm also installs `darwin-x64` binaries matching the x64 Node here.
- **Node ≥23** — ingestion scripts are `.ts` run directly via native type stripping.
- **No `vi.mock`.** Every seam is dependency injection. Hard constraint.
- **Scope test commands to explicit paths** (`pnpm test` is already `vitest run src scripts`).
- **Never dispose the WASM runtime.** `runtime.dispose()` calls emscripten `_exit_runtime()` and kills the module process-wide.
- **A satellite whose SGP4 error byte is non-zero must never be rendered** or be selectable.
- All distances in kilometres, all times UTC.

New for phase 2:

- **Desktop only.** No responsive or mobile layouts. Do not add breakpoints.
- **Altitude is WGS84 geodetic height**, from `eciToGeodetic(...).height` — never `|r| - 6371`. Measured, they differ by 5.7 km for the ISS.
- **Three index spaces exist.** Catalog index `i ∈ [0, count)` indexes `index[]`, `positions[]` and `velocities[]`. Live index `j ∈ [0, liveIndices.length)` indexes the render buffers and is what picking returns. `i = liveIndices[j]`. Confusing them selects the wrong satellite with no error.
- **Picking must reuse the same Hermite vertex path as the visible render.** Separately computed positions disagree within a frame at 7.6 km/s.
- **`geo` (constellation bucket) and `GEO` (orbit regime) are different namespaces.** Bucket precedence is name-first, so 22 BeiDou geostationary satellites are `gnss`, not `geo`.

---

## File Structure

```
src/
├── catalog/
│   ├── types.ts            # MODIFY: + CatalogIndexEntry, + SatcatMeta.ownerName
│   ├── regime.ts           # NEW  orbit regime from apogee/perigee (pure)
│   ├── constellation.ts    # NEW  constellation bucket from name + orbit (pure)
│   ├── indexing.ts         # NEW  live-index <-> catalog-index mapping (pure)
│   └── search.ts           # NEW  ranked, capped search (pure)
├── math/
│   └── geodetic.ts         # NEW  altitude, speed, ground point (pure)
├── propagation/
│   ├── protocol.ts         # MODIFY: ready carries index; + trail request/response
│   ├── worker.ts           # MODIFY: build index; answer trail requests
│   ├── core.ts             # MODIFY: + propagateSeries for trails
│   └── client.ts           # MODIFY: expose index; requestTrail
├── render/
│   ├── earth.ts            # MODIFY: expose spinGroup for ground tracks
│   ├── scene.ts            # MODIFY: surface spinGroup on SceneHandle
│   ├── satellites.ts       # MODIFY: + bucket attribute, palette, starlink uniform
│   ├── pick-id.ts          # NEW  encode/decode pick colour ids (pure)
│   ├── picking.ts          # NEW  GPU colour-ID pass
│   └── trail.ts            # NEW  orbit trail + ground track geometry
├── ui/
│   ├── Rail.tsx            # NEW  left rail container
│   ├── SearchField.tsx     # NEW
│   ├── ResultList.tsx      # NEW  capped list + "and N more"
│   ├── DetailPanel.tsx     # NEW  mission-control tables
│   ├── ConstellationLegend.tsx # NEW  colour key + Starlink control
│   └── theme.ts            # NEW  mission-control tokens, shared with the shader palette
├── globe.ts                # MODIFY: selection state, trail wiring, throttled live state
└── App.tsx                 # MODIFY: render the rail

scripts/ingest/
├── parse-sources.ts        # NEW  Celestrak owner-code page -> Map<code, name>
├── ingest.ts               # MODIFY: fetch + join ownerName
└── join.ts                 # MODIFY: accept the owner map
```

`src/ui/theme.ts` is the single source of the palette. The shader reads the same
hex values, so the legend swatches and the dots cannot drift apart.

---

## Task 1: Owner-code expansion in ingestion

SATCAT owner codes are opaque and the catalog uses 99 of them. Celestrak publishes the authoritative list as HTML at `https://celestrak.org/satcat/sources.php`; it parses to 132 code/name pairs and resolves every code present.

**Files:**
- Create: `scripts/ingest/parse-sources.ts`
- Test: `scripts/ingest/parse-sources.test.ts`
- Modify: `src/catalog/types.ts`, `scripts/ingest/join.ts`, `scripts/ingest/ingest.ts`, `scripts/ingest/join.test.ts`, `scripts/ingest/ingest.test.ts`

**Interfaces:**
- Produces:
  - `SOURCES_URL = 'https://celestrak.org/satcat/sources.php'`
  - `parseSources(html: string): Map<string, string>` — throws `IngestError` below the pair threshold
  - `SatcatMeta` gains `ownerName: string | null`
  - `joinCatalog(omm, satcat, owners: Map<string, string>)` — third parameter is new

- [ ] **Step 1: Write the failing test**

`scripts/ingest/parse-sources.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseSources } from './parse-sources.ts';

const page = (rows: string) => `<!DOCTYPE html><html><body><table>
<tr><th>Source</th><th>Name</th></tr>${rows}</table></body></html>`;

/** 95 filler rows so realistic fixtures clear the 90-pair threshold. */
const filler = Array.from({ length: 95 }, (_, i) =>
  `<tr><td>C${i}</td><td>Country ${i}</td></tr>`).join('');

describe('parseSources', () => {
  it('extracts code/name pairs', () => {
    const map = parseSources(page(
      `<tr><td>CIS</td><td>Commonwealth of Independent States</td></tr>` +
      `<tr><td>PRC</td><td>People's Republic of China</td></tr>` + filler,
    ));
    expect(map.get('CIS')).toBe('Commonwealth of Independent States');
    expect(map.get('PRC')).toBe("People's Republic of China");
  });

  it('strips nested markup from cells', () => {
    const map = parseSources(page(
      `<tr><td><b>US</b></td><td><a href="/x">United States</a></td></tr>` + filler,
    ));
    expect(map.get('US')).toBe('United States');
  });

  it('ignores the header row and any row without a short code', () => {
    const map = parseSources(page(
      `<tr><td>A very long cell that is not a code</td><td>Nope</td></tr>` + filler,
    ));
    expect(map.has('Source')).toBe(false);
    expect(map.size).toBe(95);
  });

  it('throws below the pair threshold, so a page redesign fails the run loudly', () => {
    expect(() => parseSources(page(
      `<tr><td>US</td><td>United States</td></tr>`,
    ))).toThrow(/only 1 owner code/i);
  });

  it('throws on a page with no table at all', () => {
    expect(() => parseSources('<html><body>down for maintenance</body></html>'))
      .toThrow(/owner code/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run scripts/ingest/parse-sources.test.ts
```

Expected: FAIL — cannot resolve `./parse-sources.ts`.

- [ ] **Step 3: Write `scripts/ingest/parse-sources.ts`**

```ts
import { IngestError } from '../../src/catalog/types.ts';

export const SOURCES_URL = 'https://celestrak.org/satcat/sources.php';

/**
 * Minimum pairs a healthy page yields. The live page currently has 132.
 * Below this we assume the markup changed and fail rather than silently
 * shipping a catalog with unexpanded owner codes.
 */
const MIN_PAIRS = 90;

const stripTags = (html: string) => html.replace(/<[^>]+>/g, '').trim();

/**
 * Parse Celestrak's SATCAT sources page into a code -> name map.
 *
 * This is HTML, not a data file, so it can change shape without warning.
 * The pair threshold is what turns that from a silent regression into a
 * failed ingestion run that leaves the last good artifact in place.
 */
export function parseSources(html: string): Map<string, string> {
  const map = new Map<string, string>();

  for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((m) => stripTags(m[1] ?? ''));
    const [code, name] = cells;
    // Codes are short tokens; anything longer is prose or a header.
    if (!code || !name || code.length > 6 || code.toLowerCase() === 'source') continue;
    map.set(code, name);
  }

  if (map.size < MIN_PAIRS) {
    throw new IngestError(
      `Parsed only ${map.size} owner codes from ${SOURCES_URL} (expected at ` +
      `least ${MIN_PAIRS}). The page markup has probably changed. Refusing ` +
      `to emit a catalog with unexpanded owner codes.`,
    );
  }
  return map;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run scripts/ingest/parse-sources.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Add `ownerName` to `SatcatMeta`**

In `src/catalog/types.ts`, change the `SatcatMeta` interface to:

```ts
/** Metadata drawn from satcat.csv. Null when the object has no SATCAT row. */
export interface SatcatMeta {
  objectType: string | null;   // PAY | R/B | DEB | UNK
  owner: string | null;        // raw SATCAT code, e.g. "CIS"
  ownerName: string | null;    // expanded, e.g. "Commonwealth of Independent States"
  launchDate: string | null;   // ISO date
  apogeeKm: number | null;
  perigeeKm: number | null;
}
```

- [ ] **Step 6: Write the failing join test**

Append to `scripts/ingest/join.test.ts`:

```ts
describe('joinCatalog owner expansion', () => {
  const owners = new Map([['US', 'United States']]);

  it('expands a known owner code', () => {
    const out = joinCatalog([omm(1)], new Map([[1, row(null)]]), owners);
    expect(out[0]!.meta.owner).toBe('US');
    expect(out[0]!.meta.ownerName).toBe('United States');
  });

  it('leaves ownerName null for an unrecognised code rather than guessing', () => {
    const unknown: SatcatRow = {
      ...row(null),
      meta: { ...row(null).meta, owner: 'ZZZ', ownerName: null },
    };
    const out = joinCatalog([omm(1)], new Map([[1, unknown]]), owners);
    expect(out[0]!.meta.owner).toBe('ZZZ');
    expect(out[0]!.meta.ownerName).toBeNull();
  });

  it('leaves ownerName null when the object has no SATCAT row', () => {
    const out = joinCatalog([omm(9)], new Map(), owners);
    expect(out[0]!.meta.ownerName).toBeNull();
  });
});
```

Also update the existing `row` helper in that file to include `ownerName: null` in its `meta`, and the `EMPTY_META` expectation in the "keeps GP records absent from SATCAT" test to include `ownerName: null`.

- [ ] **Step 7: Run to verify it fails**

```bash
pnpm exec vitest run scripts/ingest/join.test.ts
```

Expected: FAIL — `joinCatalog` takes 2 arguments.

- [ ] **Step 8: Update `scripts/ingest/join.ts`**

Change `EMPTY_META` to include `ownerName: null`, then change the signature and body:

```ts
export function joinCatalog(
  omm: OmmRecord[],
  satcat: Map<number, SatcatRow>,
  owners: Map<string, string>,
): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const record of omm) {
    const row = satcat.get(record.NORAD_CAT_ID);
    if (row?.decayDate) continue;
    const meta = row
      ? { ...row.meta, ownerName: row.meta.owner ? owners.get(row.meta.owner) ?? null : null }
      : EMPTY_META;
    entries.push({ omm: trimOmm(record), meta });
  }
  entries.sort((a, b) => a.omm.NORAD_CAT_ID - b.omm.NORAD_CAT_ID);
  return entries;
}
```

In `scripts/ingest/parse-satcat.ts`, add `ownerName: null` to the `meta` object it builds — the parser does not know the expansion; the join supplies it.

- [ ] **Step 9: Fetch the sources page during ingestion**

In `scripts/ingest/ingest.ts`, import `SOURCES_URL` and `parseSources`, then change the fetch and join:

```ts
  const [gpBody, satcatBody, sourcesBody] = await Promise.all([
    deps.fetchText(GP_URL),
    deps.fetchText(SATCAT_URL),
    deps.fetchText(SOURCES_URL),
  ]);

  const omm = parseGpResponse(gpBody);
  const satcat = parseSatcat(satcatBody);
  const owners = parseSources(sourcesBody);
  const catalog = joinCatalog(omm, satcat, owners);
```

Re-export `SOURCES_URL` from `ingest.ts` so tests can stub it:

```ts
export { SOURCES_URL } from './parse-sources.ts';
```

- [ ] **Step 10: Update the ingest test's fake fetch**

In `scripts/ingest/ingest.test.ts`, import `SOURCES_URL`, add a `SOURCES` fixture built the same way as the `parse-sources` test's (a table with `US` plus 95 filler rows), and return it from `fetchText` when the url is `SOURCES_URL`. Add:

```ts
  it('expands owner codes into the artifact', async () => {
    const { catalog } = await runIngest(deps());
    expect(catalog[0]!.meta.ownerName).toBe('International Space Station');
  });
```

with the `SOURCES` fixture containing `<tr><td>ISS</td><td>International Space Station</td></tr>`.

- [ ] **Step 11: Run the full suite**

```bash
pnpm test && pnpm run typecheck
```

Expected: all tests pass, no type errors.

- [ ] **Step 12: Rebuild the artifact and confirm expansion**

```bash
pnpm run ingest
```

If Celestrak returns 403 it is rate-limiting; wait and retry. On success:

```bash
node -e "const c=require('./public/data/catalog.json');const i=c.find(e=>e.omm.NORAD_CAT_ID===25544);console.log(i.meta.owner,'->',i.meta.ownerName);console.log('unexpanded:',c.filter(e=>e.meta.owner&&!e.meta.ownerName).length)"
```

Expected: `ISS -> International Space Station`, and a *small* unexpanded
count. Measured on 2026-09-19 it is **5 objects across 3 codes** — `JOR`,
`KWT` and `SVK` are absent from Celestrak's page. The fallback renders the
raw code, which is the designed behaviour. A count in the hundreds would
mean the parse is broken.

- [ ] **Step 13: Commit**

```bash
git add scripts/ingest src/catalog/types.ts public/data
git commit -m "feat(ingest): expand SATCAT owner codes from Celestrak's source list"
```

---

## Task 2: Catalog index across the worker boundary

**Files:**
- Modify: `src/catalog/types.ts`, `src/propagation/protocol.ts`, `src/propagation/worker.ts`, `src/propagation/client.ts`
- Create: `src/catalog/indexing.ts`
- Test: `src/catalog/indexing.test.ts`, `src/propagation/client.test.ts`

**Interfaces:**
- Produces:
  - `interface CatalogIndexEntry { noradId, name, intlDesignator, objectType, owner, ownerName, launchDate, apogeeKm, perigeeKm, inclinationDeg, meanMotion }`
  - `buildIndexEntry(entry: CatalogEntry): CatalogIndexEntry`
  - `buildReverseMap(liveIndices: Uint32Array, count: number): Int32Array` — catalog index → live index, `-1` when not renderable
  - `catalogIndexFromLive(liveIndices: Uint32Array, liveIndex: number): number | null`
  - `liveIndexFromCatalog(reverseMap: Int32Array, catalogIndex: number): number | null`
  - `ReadyInfo` gains `index: CatalogIndexEntry[]`

- [ ] **Step 1: Write the failing mapping test**

`src/catalog/indexing.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  buildReverseMap, catalogIndexFromLive, liveIndexFromCatalog,
} from './indexing.ts';

// Catalog of 5; indices 1 and 3 failed SGP4 and are not renderable.
const LIVE = Uint32Array.from([0, 2, 4]);
const COUNT = 5;

describe('index space mapping', () => {
  it('maps every live index to its catalog index', () => {
    expect(catalogIndexFromLive(LIVE, 0)).toBe(0);
    expect(catalogIndexFromLive(LIVE, 1)).toBe(2);
    expect(catalogIndexFromLive(LIVE, 2)).toBe(4);
  });

  it('returns null for a live index outside the rendered set', () => {
    expect(catalogIndexFromLive(LIVE, 3)).toBeNull();
    expect(catalogIndexFromLive(LIVE, -1)).toBeNull();
  });

  it('maps catalog indices back to live indices', () => {
    const rev = buildReverseMap(LIVE, COUNT);
    expect(liveIndexFromCatalog(rev, 0)).toBe(0);
    expect(liveIndexFromCatalog(rev, 2)).toBe(1);
    expect(liveIndexFromCatalog(rev, 4)).toBe(2);
  });

  it('returns null for catalog entries that are not renderable', () => {
    const rev = buildReverseMap(LIVE, COUNT);
    expect(liveIndexFromCatalog(rev, 1)).toBeNull();
    expect(liveIndexFromCatalog(rev, 3)).toBeNull();
  });

  it('returns null outside the catalog entirely', () => {
    const rev = buildReverseMap(LIVE, COUNT);
    expect(liveIndexFromCatalog(rev, 99)).toBeNull();
    expect(liveIndexFromCatalog(rev, -1)).toBeNull();
  });

  it('round-trips every live index — the property that keeps selection honest', () => {
    const rev = buildReverseMap(LIVE, COUNT);
    for (let j = 0; j < LIVE.length; j++) {
      const i = catalogIndexFromLive(LIVE, j);
      expect(i).not.toBeNull();
      expect(liveIndexFromCatalog(rev, i!)).toBe(j);
    }
  });

  it('round-trips at catalog scale with a realistic sparse exclusion', () => {
    const count = 16_578;
    const live: number[] = [];
    for (let i = 0; i < count; i++) if (i % 997 !== 0) live.push(i);
    const liveIdx = Uint32Array.from(live);
    const rev = buildReverseMap(liveIdx, count);
    for (let j = 0; j < liveIdx.length; j += 37) {
      expect(liveIndexFromCatalog(rev, catalogIndexFromLive(liveIdx, j)!)).toBe(j);
    }
    expect(liveIndexFromCatalog(rev, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm exec vitest run src/catalog/indexing.test.ts
```

Expected: FAIL — cannot resolve `./indexing.ts`.

- [ ] **Step 3: Write `src/catalog/indexing.ts`**

```ts
import type { CatalogEntry, CatalogIndexEntry } from './types.ts';

/**
 * Three index spaces exist in this app and confusing them selects the wrong
 * satellite with no error at all:
 *
 *   catalog index i  in [0, count)                index[], positions[], velocities[]
 *   live index    j  in [0, liveIndices.length)   render buffers, picking
 *
 *   i = liveIndices[j]
 *
 * These helpers are the only sanctioned way to convert between them.
 */

export function catalogIndexFromLive(
  liveIndices: Uint32Array, liveIndex: number,
): number | null {
  if (liveIndex < 0 || liveIndex >= liveIndices.length) return null;
  return liveIndices[liveIndex]!;
}

/** Catalog index -> live index, with -1 marking "not renderable". */
export function buildReverseMap(
  liveIndices: Uint32Array, count: number,
): Int32Array {
  const reverse = new Int32Array(count).fill(-1);
  for (let j = 0; j < liveIndices.length; j++) reverse[liveIndices[j]!] = j;
  return reverse;
}

export function liveIndexFromCatalog(
  reverseMap: Int32Array, catalogIndex: number,
): number | null {
  if (catalogIndex < 0 || catalogIndex >= reverseMap.length) return null;
  const j = reverseMap[catalogIndex]!;
  return j < 0 ? null : j;
}

/** Project a catalog entry down to what the UI needs. */
export function buildIndexEntry(entry: CatalogEntry): CatalogIndexEntry {
  return {
    noradId: entry.omm.NORAD_CAT_ID,
    name: entry.omm.OBJECT_NAME,
    intlDesignator: entry.omm.OBJECT_ID,
    objectType: entry.meta.objectType,
    owner: entry.meta.owner,
    ownerName: entry.meta.ownerName,
    launchDate: entry.meta.launchDate,
    apogeeKm: entry.meta.apogeeKm,
    perigeeKm: entry.meta.perigeeKm,
    inclinationDeg: entry.omm.INCLINATION,
    meanMotion: entry.omm.MEAN_MOTION,
  };
}
```

- [ ] **Step 4: Add `CatalogIndexEntry` to `src/catalog/types.ts`**

```ts
/**
 * What the main thread needs about each object for search and the detail
 * panel. Sent once at `ready`; measured at 25.4 ms to structured-clone for
 * the full 16,578-object catalog, so it is not worth packing into typed
 * arrays.
 */
export interface CatalogIndexEntry {
  noradId: number;
  name: string;
  intlDesignator: string;
  objectType: string | null;
  owner: string | null;
  ownerName: string | null;
  launchDate: string | null;
  apogeeKm: number | null;
  perigeeKm: number | null;
  inclinationDeg: number;
  meanMotion: number;   // rev/day; period = 1440 / meanMotion
}
```

- [ ] **Step 5: Run to verify the mapping tests pass**

```bash
pnpm exec vitest run src/catalog/indexing.test.ts
```

Expected: 7 tests PASS.

- [ ] **Step 6: Extend the protocol**

`src/propagation/protocol.ts`:
```ts
import type { CatalogIndexEntry } from '../catalog/types.ts';

export type WorkerRequest =
  | { type: 'init'; catalogUrl: string }
  | { type: 'tick'; epochMs: number }
  | { type: 'trail'; catalogIndex: number; epochMs: number };

export type WorkerResponse =
  | {
      type: 'ready';
      count: number;
      liveIndices: Uint32Array;
      index: CatalogIndexEntry[];
    }
  | { type: 'frame'; positions: Float32Array; velocities: Float32Array; epochMs: number }
  | {
      type: 'trail';
      catalogIndex: number;
      /** ECI km, packed [x,y,z] per sample, one full orbital period. */
      samples: Float32Array;
      /** Wall-clock epoch of each sample, parallel to `samples`. */
      epochMs: Float64Array;
      periodMinutes: number;
    }
  | { type: 'error'; message: string };
```

The `trail` response is defined here but not produced until Task 8; defining it now keeps the protocol in one place.

- [ ] **Step 7: Send the index from the worker**

In `src/propagation/worker.ts`, import `buildIndexEntry`, keep the parsed catalog in a module-level variable so Task 8 can reuse it for trails, and change the `ready` post:

```ts
let catalog: CatalogEntry[] = [];
```

```ts
      catalog = (await response.json()) as CatalogEntry[];
      if (!Array.isArray(catalog) || catalog.length === 0) {
        throw new Error('catalog artifact was empty or malformed');
      }
      core = await createPropagationCore(catalog);
      core.tick(new Date());
      post({
        type: 'ready',
        count: core.count,
        liveIndices: core.liveIndices,
        index: catalog.map(buildIndexEntry),
      });
```

- [ ] **Step 8: Write the failing client test**

Append to `src/propagation/client.test.ts`:

```ts
import type { CatalogIndexEntry } from '../catalog/types.ts';

const entry = (noradId: number, name: string): CatalogIndexEntry => ({
  noradId, name, intlDesignator: '1998-067A', objectType: 'PAY',
  owner: 'ISS', ownerName: 'International Space Station',
  launchDate: '1998-11-20', apogeeKm: 422, perigeeKm: 416,
  inclinationDeg: 51.63, meanMotion: 15.5,
});

describe('createPropagationClient index', () => {
  it('surfaces the catalog index from ready', async () => {
    const { worker, emit } = fakeWorker();
    const client = createPropagationClient(worker);
    const ready = client.init('/data/catalog.json');
    const index = [entry(25544, 'ISS (ZARYA)'), entry(44713, 'STARLINK-1007')];
    emit({ type: 'ready', count: 2, liveIndices: Uint32Array.from([0, 1]), index });

    const info = await ready;
    expect(info.index).toHaveLength(2);
    expect(info.index[0]!.name).toBe('ISS (ZARYA)');
    expect(info.index[1]!.noradId).toBe(44713);
  });
});
```

- [ ] **Step 9: Run to verify it fails**

```bash
pnpm exec vitest run src/propagation/client.test.ts
```

Expected: FAIL — `index` missing from `ReadyInfo`.

- [ ] **Step 10: Extend `ReadyInfo` in `src/propagation/client.ts`**

```ts
import type { CatalogIndexEntry } from '../catalog/types.ts';

export interface ReadyInfo {
  count: number;
  liveIndices: Uint32Array;
  index: CatalogIndexEntry[];
}
```

and in the `'ready'` case of the message handler:

```ts
      case 'ready':
        resolveReady?.({
          count: message.count,
          liveIndices: message.liveIndices,
          index: message.index,
        });
        break;
```

Fix the existing `ready` emissions in that test file by adding `index: []`.

- [ ] **Step 11: Run the suite and typecheck**

```bash
pnpm test && pnpm run typecheck
```

Expected: all pass. `globe.ts` still destructures only `count` and `liveIndices`, which remains valid.

- [ ] **Step 12: Commit**

```bash
git add src/catalog src/propagation
git commit -m "feat(propagation): send a catalog index to the main thread at ready"
```

---

## Task 3: Regime and constellation classification

Two classifiers with overlapping vocabulary and different jobs. `classifyRegime` drives the panel's prose; `classifyConstellation` drives colour. They disagree by design.

**Files:**
- Create: `src/catalog/regime.ts`, `src/catalog/constellation.ts`
- Test: `src/catalog/regime.test.ts`, `src/catalog/constellation.test.ts`

**Interfaces:**
- Produces:
  - `type OrbitRegime = 'LEO' | 'MEO' | 'GEO' | 'HEO' | 'UNKNOWN'`
  - `classifyRegime(apogeeKm: number | null, perigeeKm: number | null): OrbitRegime`
  - `regimeLabel(regime: OrbitRegime): string`
  - `type ConstellationBucket = 'starlink' | 'oneweb' | 'gnss' | 'geo' | 'other'`
  - `BUCKETS: readonly ConstellationBucket[]` — canonical order; the shader palette indexes into this
  - `classifyConstellation(name: string, apogeeKm: number | null, perigeeKm: number | null): ConstellationBucket`
  - `bucketIndex(bucket: ConstellationBucket): number`

- [ ] **Step 1: Write the failing regime test**

`src/catalog/regime.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { classifyRegime, regimeLabel } from './regime.ts';

describe('classifyRegime', () => {
  it('calls the ISS low earth orbit', () => {
    expect(classifyRegime(422, 416)).toBe('LEO');
  });

  it('calls a geostationary satellite GEO', () => {
    expect(classifyRegime(35800, 35780)).toBe('GEO');
  });

  it('calls a GPS satellite MEO', () => {
    expect(classifyRegime(20200, 20180)).toBe('MEO');
  });

  it('calls a Molniya-type orbit HEO on eccentricity, not altitude', () => {
    // Apogee is above GEO but the defining feature is the 39,000 km spread.
    expect(classifyRegime(39900, 500)).toBe('HEO');
  });

  it('prefers HEO over GEO for an eccentric orbit that happens to reach GEO altitude', () => {
    expect(classifyRegime(35800, 300)).toBe('HEO');
  });

  it('returns UNKNOWN when SATCAT has no row — a freshly launched object', () => {
    expect(classifyRegime(null, null)).toBe('UNKNOWN');
    expect(classifyRegime(500, null)).toBe('UNKNOWN');
    expect(classifyRegime(null, 500)).toBe('UNKNOWN');
  });

  it('produces human labels for the panel', () => {
    expect(regimeLabel('LEO')).toBe('Low Earth orbit');
    expect(regimeLabel('GEO')).toBe('Geostationary orbit');
    expect(regimeLabel('UNKNOWN')).toBe('Unknown orbit');
  });
});
```

- [ ] **Step 2: Write the failing constellation test**

`src/catalog/constellation.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { BUCKETS, bucketIndex, classifyConstellation } from './constellation.ts';

describe('classifyConstellation', () => {
  it('buckets Starlink by name', () => {
    expect(classifyConstellation('STARLINK-1007', 551, 540)).toBe('starlink');
    expect(classifyConstellation('STARLINK-30123', 340, 330)).toBe('starlink');
  });

  it('buckets OneWeb by name', () => {
    expect(classifyConstellation('ONEWEB-0012', 1200, 1190)).toBe('oneweb');
  });

  it('buckets every GNSS family by name', () => {
    for (const n of ['GPS BIIF-2', 'NAVSTAR 81', 'GLONASS-K1 17L', 'GALILEO 23', 'BEIDOU-3 M12']) {
      expect(classifyConstellation(n, 20200, 20180)).toBe('gnss');
    }
  });

  it('buckets an unnamed geostationary object as the GEO belt', () => {
    expect(classifyConstellation('INTELSAT 901', 35800, 35780)).toBe('geo');
  });

  it('puts a geostationary BeiDou in gnss, not geo — name beats orbit', () => {
    // 22 real objects hit this. It is intentional, and it is why the geo
    // bucket is 555 rather than the 577 objects at GEO regime.
    expect(classifyConstellation('BEIDOU-3 G4', 35800, 35780)).toBe('gnss');
  });

  it('falls back to other', () => {
    expect(classifyConstellation('ISS (ZARYA)', 422, 416)).toBe('other');
    expect(classifyConstellation('COSMOS 2558', 700, 690)).toBe('other');
  });

  it('is case insensitive', () => {
    expect(classifyConstellation('starlink-1007', 551, 540)).toBe('starlink');
  });

  it('does not match a name that merely contains a family name mid-word', () => {
    expect(classifyConstellation('SUPERSTARLINKER 1', 500, 490)).toBe('other');
  });

  it('handles null orbit data without throwing', () => {
    expect(classifyConstellation('UNKNOWN OBJECT', null, null)).toBe('other');
    expect(classifyConstellation('STARLINK-1', null, null)).toBe('starlink');
  });

  it('gives every bucket a stable index for the shader palette', () => {
    expect(BUCKETS).toHaveLength(5);
    for (const b of BUCKETS) {
      expect(bucketIndex(b)).toBe(BUCKETS.indexOf(b));
    }
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

```bash
pnpm exec vitest run src/catalog/regime.test.ts src/catalog/constellation.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 4: Write `src/catalog/regime.ts`**

```ts
export type OrbitRegime = 'LEO' | 'MEO' | 'GEO' | 'HEO' | 'UNKNOWN';

/** Geostationary altitude, km. */
const GEO_ALTITUDE = 35_786;
/** How close to GEO altitude both apsides must sit to count as geostationary. */
const GEO_TOLERANCE = 500;
/** Apogee-perigee spread above which an orbit is highly elliptical. */
const HEO_SPREAD = 5_000;
/** Apogee below which an orbit is low earth. */
const LEO_CEILING = 2_000;

/**
 * Classify an orbit from its apsides.
 *
 * Eccentricity is tested before altitude: a Molniya orbit reaches GEO
 * altitude at apogee but is not geostationary, and calling it GEO would be
 * actively misleading in the panel.
 */
export function classifyRegime(
  apogeeKm: number | null, perigeeKm: number | null,
): OrbitRegime {
  if (apogeeKm === null || perigeeKm === null) return 'UNKNOWN';
  if (apogeeKm - perigeeKm > HEO_SPREAD) return 'HEO';
  if (Math.abs(apogeeKm - GEO_ALTITUDE) < GEO_TOLERANCE &&
      Math.abs(perigeeKm - GEO_ALTITUDE) < GEO_TOLERANCE) return 'GEO';
  if (apogeeKm < LEO_CEILING) return 'LEO';
  return 'MEO';
}

const LABELS: Record<OrbitRegime, string> = {
  LEO: 'Low Earth orbit',
  MEO: 'Medium Earth orbit',
  GEO: 'Geostationary orbit',
  HEO: 'Highly elliptical orbit',
  UNKNOWN: 'Unknown orbit',
};

export function regimeLabel(regime: OrbitRegime): string {
  return LABELS[regime];
}
```

- [ ] **Step 5: Write `src/catalog/constellation.ts`**

```ts
import { classifyRegime } from './regime.ts';

export type ConstellationBucket =
  | 'starlink' | 'oneweb' | 'gnss' | 'geo' | 'other';

/**
 * Canonical order. The shader palette is an array indexed by this order, so
 * changing it changes the colours — keep them in step.
 */
export const BUCKETS: readonly ConstellationBucket[] = [
  'starlink', 'oneweb', 'gnss', 'geo', 'other',
];

export function bucketIndex(bucket: ConstellationBucket): number {
  return BUCKETS.indexOf(bucket);
}

/**
 * Constellation prefixes are anchored so "SUPERSTARLINKER" does not match
 * "STARLINK".
 */
const STARLINK = /^STARLINK\b/;
const ONEWEB = /^ONEWEB\b/;

/**
 * GNSS is deliberately NOT anchored, only word-bounded. GLONASS and Galileo
 * fly under other designations with the family name in a bracketed suffix —
 * "COSMOS 2433 [GLONASS-M]", "GSAT0101 (GALILEO-PFM)". Anchoring drops 61
 * real GNSS satellites into `other`.
 */
const GNSS = /\b(GPS|NAVSTAR|GLONASS|GALILEO|BEIDOU)\b/;

/**
 * Bucket an object for colour-coding.
 *
 * Precedence is name first, orbit second. That ordering is deliberate and it
 * makes this disagree with `classifyRegime`: 22 BeiDou satellites sit at
 * geostationary altitude but bucket as `gnss`, because as a visual grouping
 * they belong with the rest of their constellation.
 *
 * Name matching is inherently fragile — new constellations launch and naming
 * changes. It degrades to `other` rather than failing.
 */
export function classifyConstellation(
  name: string, apogeeKm: number | null, perigeeKm: number | null,
): ConstellationBucket {
  const n = name.toUpperCase();
  if (STARLINK.test(n)) return 'starlink';
  if (ONEWEB.test(n)) return 'oneweb';
  if (GNSS.test(n)) return 'gnss';
  if (classifyRegime(apogeeKm, perigeeKm) === 'GEO') return 'geo';
  return 'other';
}
```

- [ ] **Step 6: Run to verify they pass**

```bash
pnpm exec vitest run src/catalog/regime.test.ts src/catalog/constellation.test.ts
```

Expected: 7 + 10 tests PASS.

- [ ] **Step 7: Verify the classifiers against the real catalog**

```bash
node --input-type=module -e "
import { classifyConstellation } from './src/catalog/constellation.ts';
import { createRequire } from 'node:module';
const c = createRequire(import.meta.url)('./public/data/catalog.json');
const t = {};
for (const e of c) {
  const b = classifyConstellation(e.omm.OBJECT_NAME, e.meta.apogeeKm, e.meta.perigeeKm);
  t[b] = (t[b] || 0) + 1;
}
console.log(t);
"
```

Expected, matching the spec's measured table: `starlink 11114, other 4101, oneweb 651, geo 555, gnss 157`. A material difference means a regex changed behaviour — investigate before continuing.

- [ ] **Step 8: Commit**

```bash
git add src/catalog/regime.ts src/catalog/constellation.ts src/catalog/regime.test.ts src/catalog/constellation.test.ts
git commit -m "feat(catalog): orbit regime and constellation classification"
```

---

## Task 4: Ranked, capped search

"starlink" matches 11,114 objects. The cap is not a nicety.

**Files:**
- Create: `src/catalog/search.ts`
- Test: `src/catalog/search.test.ts`

**Interfaces:**
- Consumes: `CatalogIndexEntry`
- Produces:
  - `interface SearchHit { catalogIndex: number; entry: CatalogIndexEntry }`
  - `interface SearchOutcome { hits: SearchHit[]; totalMatches: number; truncated: boolean }`
  - `searchCatalog(index: CatalogIndexEntry[], query: string, limit?: number): SearchOutcome` — `limit` defaults to 20

- [ ] **Step 1: Write the failing test**

`src/catalog/search.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { searchCatalog } from './search.ts';
import type { CatalogIndexEntry } from './types.ts';

const make = (noradId: number, name: string, intlDesignator = '2020-001A'): CatalogIndexEntry => ({
  noradId, name, intlDesignator, objectType: 'PAY', owner: 'US',
  ownerName: 'United States', launchDate: '2020-01-01',
  apogeeKm: 550, perigeeKm: 540, inclinationDeg: 53, meanMotion: 15.1,
});

const INDEX: CatalogIndexEntry[] = [
  make(25544, 'ISS (ZARYA)', '1998-067A'),
  make(44713, 'STARLINK-1007'),
  make(44714, 'STARLINK-1008'),
  make(48274, 'ONEWEB-0123'),
  make(11111, 'COSMOS 2558'),
];

describe('searchCatalog', () => {
  it('returns nothing for an empty or whitespace query', () => {
    expect(searchCatalog(INDEX, '').hits).toHaveLength(0);
    expect(searchCatalog(INDEX, '   ').hits).toHaveLength(0);
    expect(searchCatalog(INDEX, '').totalMatches).toBe(0);
  });

  it('matches a NORAD id exactly and ranks it first', () => {
    const out = searchCatalog(INDEX, '25544');
    expect(out.hits[0]!.entry.noradId).toBe(25544);
    expect(out.hits[0]!.catalogIndex).toBe(0);
  });

  it('matches an international designator', () => {
    expect(searchCatalog(INDEX, '1998-067A').hits[0]!.entry.noradId).toBe(25544);
  });

  it('is case insensitive on names and designators', () => {
    expect(searchCatalog(INDEX, 'iss').hits[0]!.entry.name).toBe('ISS (ZARYA)');
    expect(searchCatalog(INDEX, '1998-067a').hits[0]!.entry.noradId).toBe(25544);
  });

  it('ranks a name prefix above a mid-string substring', () => {
    const index = [make(1, 'DEEP STARLINK PROBE'), make(2, 'STARLINK-9')];
    const hits = searchCatalog(index, 'starlink').hits;
    expect(hits[0]!.entry.name).toBe('STARLINK-9');
  });

  it('reports the true total even when results are capped', () => {
    const many = Array.from({ length: 500 }, (_, i) => make(1000 + i, `STARLINK-${i}`));
    const out = searchCatalog(many, 'starlink', 20);
    expect(out.hits).toHaveLength(20);
    expect(out.totalMatches).toBe(500);
    expect(out.truncated).toBe(true);
  });

  it('does not mark a short result set as truncated', () => {
    const out = searchCatalog(INDEX, 'oneweb', 20);
    expect(out.hits).toHaveLength(1);
    expect(out.totalMatches).toBe(1);
    expect(out.truncated).toBe(false);
  });

  it('carries the catalog index so selection can find the position', () => {
    expect(searchCatalog(INDEX, 'oneweb').hits[0]!.catalogIndex).toBe(3);
  });

  it('returns an empty outcome for no match rather than throwing', () => {
    const out = searchCatalog(INDEX, 'zzzznope');
    expect(out.hits).toHaveLength(0);
    expect(out.totalMatches).toBe(0);
    expect(out.truncated).toBe(false);
  });

  it('stays under 20 ms at catalog scale for the worst-case query', () => {
    // Measured ~1.6 ms for a full scan of 16,578 names; this is a generous
    // ceiling that still catches an accidental O(n^2).
    const many = Array.from({ length: 16_578 }, (_, i) => make(i, `STARLINK-${i}`));
    const t = performance.now();
    searchCatalog(many, 'starlink');
    expect(performance.now() - t).toBeLessThan(20);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm exec vitest run src/catalog/search.test.ts
```

Expected: FAIL — cannot resolve `./search.ts`.

- [ ] **Step 3: Write `src/catalog/search.ts`**

```ts
import type { CatalogIndexEntry } from './types.ts';

export interface SearchHit {
  catalogIndex: number;
  entry: CatalogIndexEntry;
}

export interface SearchOutcome {
  hits: SearchHit[];
  /** Matches before the cap — what "and N more" is computed from. */
  totalMatches: number;
  truncated: boolean;
}

const DEFAULT_LIMIT = 20;

// Lower rank sorts first.
const RANK_NORAD = 0;
const RANK_DESIGNATOR = 1;
const RANK_NAME_PREFIX = 2;
const RANK_NAME_SUBSTRING = 3;

function rankOf(entry: CatalogIndexEntry, query: string): number | null {
  if (String(entry.noradId) === query) return RANK_NORAD;
  if (entry.intlDesignator.toUpperCase() === query) return RANK_DESIGNATOR;
  const name = entry.name.toUpperCase();
  if (name.startsWith(query)) return RANK_NAME_PREFIX;
  if (name.includes(query)) return RANK_NAME_SUBSTRING;
  return null;
}

/**
 * Rank, cap and count.
 *
 * A single query can match most of the catalog — "starlink" hits 11,114 of
 * 16,578 — so the cap is load-bearing, and `totalMatches` is what lets the UI
 * say "and 11,094 more" instead of rendering a wall.
 *
 * A full scan measures ~1.6 ms over the real catalog, so there is no index
 * structure here and none is needed.
 */
export function searchCatalog(
  index: CatalogIndexEntry[], query: string, limit = DEFAULT_LIMIT,
): SearchOutcome {
  const q = query.trim().toUpperCase();
  if (q.length === 0) return { hits: [], totalMatches: 0, truncated: false };

  const ranked: { rank: number; hit: SearchHit }[] = [];
  let totalMatches = 0;

  for (let i = 0; i < index.length; i++) {
    const entry = index[i]!;
    const rank = rankOf(entry, q);
    if (rank === null) continue;
    totalMatches++;
    ranked.push({ rank, hit: { catalogIndex: i, entry } });
  }

  // Stable within a rank: catalog order, which is ascending NORAD id.
  ranked.sort((a, b) => a.rank - b.rank);

  return {
    hits: ranked.slice(0, limit).map((r) => r.hit),
    totalMatches,
    truncated: totalMatches > limit,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm exec vitest run src/catalog/search.test.ts
```

Expected: 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/catalog/search.ts src/catalog/search.test.ts
git commit -m "feat(catalog): ranked and capped catalog search"
```

---

## Task 5: Live derived state

**Files:**
- Create: `src/math/geodetic.ts`
- Test: `src/math/geodetic.test.ts`

**Interfaces:**
- Produces:
  - `interface LiveState { altitudeKm: number; speedKmS: number; latDeg: number; lonDeg: number }`
  - `liveState(positionEciKm: Vec3, velocityEciKmS: Vec3, date: Date): LiveState`
  - `periodMinutes(meanMotion: number): number`
  - `type Vec3 = { x: number; y: number; z: number }`

- [ ] **Step 1: Write the failing test**

`src/math/geodetic.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { json2satrec } from 'satellite.js';
import { liveState, periodMinutes } from './geodetic.ts';
import { stateAt } from '../test-support/state.ts';
import type { TrimmedOmm } from '../catalog/types.ts';

const ISS: TrimmedOmm = {
  OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', NORAD_CAT_ID: 25544,
  EPOCH: '2026-09-19T12:00:00.000000', MEAN_MOTION: 15.50103472,
  ECCENTRICITY: 0.0004364, INCLINATION: 51.6412, RA_OF_ASC_NODE: 247.4627,
  ARG_OF_PERICENTER: 130.5360, MEAN_ANOMALY: 325.0288, BSTAR: 0.00023844,
  MEAN_MOTION_DOT: 0.00012353, MEAN_MOTION_DDOT: 0, ELEMENT_SET_NO: 999,
};
const AT = new Date('2026-09-19T13:30:00.000Z');

describe('liveState', () => {
  it('reports a plausible ISS altitude', () => {
    const { p, v } = stateAt(json2satrec(ISS), AT);
    const s = liveState(p, v, AT);
    expect(s.altitudeKm).toBeGreaterThan(380);
    expect(s.altitudeKm).toBeLessThan(460);
  });

  it('uses WGS84 geodetic height, not the spherical approximation', () => {
    // These differ by ~5.7 km for the ISS. Showing |r|-6371 in the panel
    // would be visibly wrong, so this asserts they are NOT equal.
    const { p, v } = stateAt(json2satrec(ISS), AT);
    const spherical = Math.hypot(p.x, p.y, p.z) - 6371;
    expect(Math.abs(liveState(p, v, AT).altitudeKm - spherical)).toBeGreaterThan(1);
  });

  it('reports orbital speed matching the velocity vector magnitude', () => {
    const { p, v } = stateAt(json2satrec(ISS), AT);
    expect(liveState(p, v, AT).speedKmS).toBeCloseTo(Math.hypot(v.x, v.y, v.z), 9);
  });

  it('keeps the ground point inside the orbit inclination band', () => {
    // A 51.64 degree inclination orbit can never be over a higher latitude.
    const rec = json2satrec(ISS);
    for (let m = 0; m < 95; m += 5) {
      const t = new Date(AT.getTime() + m * 60_000);
      const { p, v } = stateAt(rec, t);
      expect(Math.abs(liveState(p, v, t).latDeg)).toBeLessThanOrEqual(52.2);
    }
  });

  it('keeps longitude in [-180, 180]', () => {
    const rec = json2satrec(ISS);
    for (let m = 0; m < 95; m += 5) {
      const t = new Date(AT.getTime() + m * 60_000);
      const { p, v } = stateAt(rec, t);
      const lon = liveState(p, v, t).lonDeg;
      expect(lon).toBeGreaterThanOrEqual(-180);
      expect(lon).toBeLessThanOrEqual(180);
    }
  });

  it('moves the ground point westward relative to inertial space as earth turns', () => {
    // Same inertial position, one hour apart: the ground point must shift
    // about 15 degrees in longitude because the earth rotated beneath it.
    const { p, v } = stateAt(json2satrec(ISS), AT);
    const a = liveState(p, v, AT);
    const b = liveState(p, v, new Date(AT.getTime() + 3_600_000));
    let d = a.lonDeg - b.lonDeg;
    while (d < -180) d += 360;
    while (d > 180) d -= 360;
    expect(Math.abs(d)).toBeGreaterThan(14);
    expect(Math.abs(d)).toBeLessThan(16);
  });
});

describe('periodMinutes', () => {
  it('converts the ISS mean motion to about 93 minutes', () => {
    expect(periodMinutes(15.50103472)).toBeCloseTo(92.9, 1);
  });

  it('gives a geostationary satellite roughly a sidereal day', () => {
    expect(periodMinutes(1.0027)).toBeCloseTo(1436, 0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm exec vitest run src/math/geodetic.test.ts
```

Expected: FAIL — cannot resolve `./geodetic.ts`.

- [ ] **Step 3: Write `src/math/geodetic.ts`**

```ts
import { degreesLat, degreesLong, eciToGeodetic, gstime } from 'satellite.js';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface LiveState {
  /** WGS84 geodetic height above the ellipsoid, km. */
  altitudeKm: number;
  speedKmS: number;
  latDeg: number;
  lonDeg: number;
}

/**
 * Derive the values the detail panel shows live.
 *
 * Altitude is the geodetic height from `eciToGeodetic`, not `|r| - 6371`.
 * The earth is an ellipsoid and the two differ by about 5.7 km for the ISS —
 * enough to be visibly wrong in a panel that quotes a number.
 */
export function liveState(
  positionEciKm: Vec3, velocityEciKmS: Vec3, date: Date,
): LiveState {
  const geodetic = eciToGeodetic(positionEciKm, gstime(date));
  return {
    altitudeKm: geodetic.height,
    speedKmS: Math.hypot(velocityEciKmS.x, velocityEciKmS.y, velocityEciKmS.z),
    latDeg: degreesLat(geodetic.latitude),
    lonDeg: degreesLong(geodetic.longitude),
  };
}

/** Orbital period from SGP4 mean motion in revolutions per day. */
export function periodMinutes(meanMotion: number): number {
  return 1440 / meanMotion;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm exec vitest run src/math/geodetic.test.ts
```

Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/math/geodetic.ts src/math/geodetic.test.ts
git commit -m "feat(math): geodetic live state and orbital period"
```

---

## Task 6: Theme, formatters, and the left rail

**A deliberate testing decision, stated up front:** this project has no DOM-testing dependencies and phase 1 added none. Rather than pull in `@testing-library/react` and `jsdom` for three presentational components, all display logic is extracted into pure functions in `src/ui/format.ts` and tested there, leaving the JSX thin enough to review by eye. If the UI later grows real interaction logic, adding those dependencies becomes the right call — it is not yet.

**Files:**
- Create: `src/ui/theme.ts`, `src/ui/format.ts`, `src/ui/SearchField.tsx`, `src/ui/ResultList.tsx`, `src/ui/Rail.tsx`
- Test: `src/ui/format.test.ts`

**Interfaces:**
- Consumes: `SearchOutcome`, `SearchHit`, `CatalogIndexEntry`, `LiveState`, `OrbitRegime`, `ConstellationBucket`
- Produces:
  - `theme` — colour and type tokens
  - `BUCKET_COLORS: Record<ConstellationBucket, string>` and `BUCKET_COLOR_LIST: string[]` in `BUCKETS` order
  - `formatKm(v: number | null, digits?: number): string`
  - `formatLatLon(latDeg: number, lonDeg: number): string`
  - `formatPeriod(minutes: number): string`
  - `resultSummary(outcome: SearchOutcome): string | null`
  - `type TrackingStatus = 'TRACKING' | 'ERROR' | 'STALE'`
  - `<SearchField value onChange />`, `<ResultList outcome selectedCatalogIndex onSelect />`, `<Rail … />`

- [ ] **Step 1: Write the failing formatter test**

`src/ui/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatKm, formatLatLon, formatPeriod, resultSummary } from './format.ts';
import type { SearchOutcome } from '../catalog/search.ts';

const outcome = (n: number, total: number, truncated: boolean): SearchOutcome => ({
  hits: Array.from({ length: n }, () => ({ catalogIndex: 0, entry: {} as never })),
  totalMatches: total,
  truncated,
});

describe('formatKm', () => {
  it('formats with one decimal by default', () => {
    expect(formatKm(419.3421)).toBe('419.3 km');
  });

  it('honours a digit count', () => {
    expect(formatKm(7.66312, 3)).toBe('7.663 km');
  });

  it('renders null as an em dash rather than "null km"', () => {
    expect(formatKm(null)).toBe('—');
  });

  it('groups thousands so GEO altitudes stay readable', () => {
    expect(formatKm(35786)).toBe('35,786.0 km');
  });
});

describe('formatLatLon', () => {
  it('uses hemisphere letters, not signs', () => {
    expect(formatLatLon(-12.404, 147.881)).toBe('12.404°S 147.881°E');
    expect(formatLatLon(51.63, -0.12)).toBe('51.630°N 0.120°W');
  });

  it('treats the equator and prime meridian as positive hemispheres', () => {
    expect(formatLatLon(0, 0)).toBe('0.000°N 0.000°E');
  });
});

describe('formatPeriod', () => {
  it('shows minutes for a LEO orbit', () => {
    expect(formatPeriod(92.95)).toBe('92.9 min');
  });

  it('adds an hour breakdown once the period passes two hours', () => {
    expect(formatPeriod(1436)).toBe('1436.0 min (23h 56m)');
  });
});

describe('resultSummary', () => {
  it('is null when nothing was truncated — no noise for small results', () => {
    expect(resultSummary(outcome(3, 3, false))).toBeNull();
  });

  it('reports the remainder when truncated', () => {
    expect(resultSummary(outcome(20, 11114, true))).toBe('and 11,094 more');
  });

  it('uses the singular for exactly one more', () => {
    expect(resultSummary(outcome(20, 21, true))).toBe('and 1 more');
  });

  it('is null for an empty outcome', () => {
    expect(resultSummary(outcome(0, 0, false))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm exec vitest run src/ui/format.test.ts
```

Expected: FAIL — cannot resolve `./format.ts`.

- [ ] **Step 3: Write `src/ui/theme.ts`**

```ts
import { BUCKETS, type ConstellationBucket } from '../catalog/constellation.ts';

/**
 * Mission-control tokens. Monospace, dense, muted blue-grey on the dark
 * field, green reserved for live values so the eye finds them immediately.
 */
export const theme = {
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  bg: '#080c14',
  bgRaised: '#0c1320',
  border: '#1d3347',
  rule: '#16283a',
  label: '#4e7ea3',
  labelDim: '#3d6180',
  text: '#cfe9ff',
  textDim: '#a8c8e0',
  live: '#9fe0a8',
  warn: '#ffd98a',
  error: '#ff9b9b',
  railWidth: 300,
} as const;

/**
 * Constellation palette. Starlink is deliberately the most muted: it is 67%
 * of the catalog and must recede so everything else is visible at all.
 *
 * The shader reads BUCKET_COLOR_LIST in BUCKETS order, so the legend
 * swatches and the dots cannot drift apart.
 */
export const BUCKET_COLORS: Record<ConstellationBucket, string> = {
  starlink: '#3d5a73',
  oneweb: '#c9a227',
  gnss: '#7ec8a9',
  geo: '#d98c5f',
  other: '#8fd6ff',
};

export const BUCKET_LABELS: Record<ConstellationBucket, string> = {
  starlink: 'Starlink',
  oneweb: 'OneWeb',
  gnss: 'GNSS',
  geo: 'GEO belt',
  other: 'Other',
};

export const BUCKET_COLOR_LIST: string[] = BUCKETS.map((b) => BUCKET_COLORS[b]);
```

- [ ] **Step 4: Write `src/ui/format.ts`**

```ts
import type { SearchOutcome } from '../catalog/search.ts';

export type TrackingStatus = 'TRACKING' | 'ERROR' | 'STALE';

const EM_DASH = '—';

export function formatKm(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH;
  return `${value.toLocaleString('en-US', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  })} km`;
}

/** Hemisphere letters rather than signs — easier to read at a glance. */
export function formatLatLon(latDeg: number, lonDeg: number): string {
  const lat = `${Math.abs(latDeg).toFixed(3)}°${latDeg < 0 ? 'S' : 'N'}`;
  const lon = `${Math.abs(lonDeg).toFixed(3)}°${lonDeg < 0 ? 'W' : 'E'}`;
  return `${lat} ${lon}`;
}

export function formatPeriod(minutes: number): string {
  const base = `${minutes.toFixed(1)} min`;
  if (minutes < 120) return base;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return `${base} (${h}h ${m}m)`;
}

/**
 * The "and N more" line. Null when nothing was cut, so a three-result search
 * does not carry a pointless footer.
 */
export function resultSummary(outcome: SearchOutcome): string | null {
  if (!outcome.truncated) return null;
  const remainder = outcome.totalMatches - outcome.hits.length;
  if (remainder <= 0) return null;
  return `and ${remainder.toLocaleString('en-US')} more`;
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
pnpm exec vitest run src/ui/format.test.ts
```

Expected: 12 tests PASS.

- [ ] **Step 6: Write `src/ui/SearchField.tsx`**

```tsx
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
```

- [ ] **Step 7: Write `src/ui/ResultList.tsx`**

```tsx
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
```

- [ ] **Step 8: Write `src/ui/Rail.tsx`**

```tsx
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
```

- [ ] **Step 9: Typecheck**

```bash
pnpm run typecheck
```

Expected: no errors. Nothing renders the rail yet; that happens in Task 8.

- [ ] **Step 10: Commit**

```bash
git add src/ui
git commit -m "feat(ui): mission-control theme, formatters, search field and result list"
```

---

## Task 7: GPU colour-ID picking

**Files:**
- Create: `src/render/pick-id.ts`, `src/render/picking.ts`
- Modify: `src/render/satellites.ts` (expose geometry and the shared uniforms)
- Test: `src/render/pick-id.test.ts`

**Interfaces:**
- Consumes: `SatellitesHandle`
- Produces:
  - `encodePickId(liveIndex: number): [number, number, number]` — 0-255 channels
  - `decodePickId(r: number, g: number, b: number): number | null` — null for the background
  - `MAX_PICKABLE = 16_777_214`
  - `interface PickerHandle { pick(cssX: number, cssY: number): number | null; dispose(): void }`
  - `createPicker(deps: PickerDeps): PickerHandle`
  - `SatellitesHandle` gains `geometry: THREE.BufferGeometry` and `uniforms: Record<string, THREE.IUniform>`

- [ ] **Step 1: Write the failing encode/decode test**

`src/render/pick-id.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { decodePickId, encodePickId, MAX_PICKABLE } from './pick-id.ts';

describe('pick id codec', () => {
  it('reserves black for the background', () => {
    expect(decodePickId(0, 0, 0)).toBeNull();
  });

  it('round-trips the first index', () => {
    const [r, g, b] = encodePickId(0);
    expect([r, g, b]).not.toEqual([0, 0, 0]);
    expect(decodePickId(r, g, b)).toBe(0);
  });

  it('round-trips across byte boundaries, where off-by-ones hide', () => {
    for (const i of [0, 1, 254, 255, 256, 257, 65_534, 65_535, 65_536, 16_576, 16_577]) {
      const [r, g, b] = encodePickId(i);
      expect(decodePickId(r, g, b), `index ${i}`).toBe(i);
    }
  });

  it('round-trips every index across the real catalog size', () => {
    for (let i = 0; i < 16_578; i++) {
      const [r, g, b] = encodePickId(i);
      expect(decodePickId(r, g, b)).toBe(i);
    }
  });

  it('keeps every channel inside a byte', () => {
    for (const i of [0, 12_345, 16_577, MAX_PICKABLE - 1]) {
      for (const c of encodePickId(i)) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
        expect(Number.isInteger(c)).toBe(true);
      }
    }
  });

  it('rejects an index the encoding cannot represent', () => {
    expect(() => encodePickId(-1)).toThrow(/range/i);
    expect(() => encodePickId(MAX_PICKABLE)).toThrow(/range/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm exec vitest run src/render/pick-id.test.ts
```

Expected: FAIL — cannot resolve `./pick-id.ts`.

- [ ] **Step 3: Write `src/render/pick-id.ts`**

```ts
/**
 * Live indices are encoded as RGB so the GPU can report which satellite is
 * under the cursor.
 *
 * Index 0 must be representable, and the cleared background reads as black,
 * so everything is stored offset by one and (0,0,0) means "nothing here".
 */

/** Exclusive upper bound on encodable indices. */
export const MAX_PICKABLE = 0xff_ff_ff - 1;

export function encodePickId(liveIndex: number): [number, number, number] {
  if (!Number.isInteger(liveIndex) || liveIndex < 0 || liveIndex >= MAX_PICKABLE) {
    throw new RangeError(`pick id ${liveIndex} out of range [0, ${MAX_PICKABLE})`);
  }
  const v = liveIndex + 1;
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];
}

export function decodePickId(r: number, g: number, b: number): number | null {
  const v = r | (g << 8) | (b << 16);
  return v === 0 ? null : v - 1;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm exec vitest run src/render/pick-id.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: Expose geometry and uniforms from `src/render/satellites.ts`**

Add to the `SatellitesHandle` interface:

```ts
  /** Exposed so the picker can build a parallel material over the same buffers. */
  geometry: THREE.BufferGeometry;
  uniforms: Record<string, THREE.IUniform>;
```

and return them from `createSatellites`:

```ts
  return {
    points,
    geometry,
    uniforms: material.uniforms,
    pushFrame(frame) { /* unchanged */ },
    setAlpha(alpha) { /* unchanged */ },
    dispose() { /* unchanged */ },
  };
```

Also export the vertex shader's Hermite body so the picker cannot drift from it. Replace the inline `vertexShader` constant with:

```ts
/**
 * The Hermite position computation, shared verbatim between the visible
 * material and the picking material. Picking against a separately written
 * copy of this would disagree with the screen within a frame at 7.6 km/s
 * and select the wrong satellite.
 */
export const HERMITE_VERTEX_BODY = /* glsl */ `
  float s  = uAlpha;
  float s2 = s * s;
  float s3 = s2 * s;
  float h00 =  2.0 * s3 - 3.0 * s2 + 1.0;
  float h10 =        s3 - 2.0 * s2 + s;
  float h01 = -2.0 * s3 + 3.0 * s2;
  float h11 =        s3 -       s2;

  vec3 p = h00 * position + h10 * uH * velA
         + h01 * posB     + h11 * uH * velB;

  vec4 mv = modelViewMatrix * vec4(p * uScale, 1.0);
  gl_Position = projectionMatrix * mv;
`;

export const HERMITE_ATTRIBUTES = /* glsl */ `
  attribute vec3 velA;
  attribute vec3 posB;
  attribute vec3 velB;
  uniform float uAlpha;
  uniform float uH;
  uniform float uScale;
  uniform float uPointSize;
`;

const vertexShader = /* glsl */ `
  ${HERMITE_ATTRIBUTES}
  void main() {
    ${HERMITE_VERTEX_BODY}
    gl_PointSize = clamp(uPointSize / max(-mv.z, 0.001), 1.0, 5.0);
  }
`;
```

- [ ] **Step 6: Write `src/render/picking.ts`**

```ts
import * as THREE from 'three';
import { decodePickId } from './pick-id.ts';
import { HERMITE_ATTRIBUTES, HERMITE_VERTEX_BODY } from './satellites.ts';

export interface PickerDeps {
  renderer: THREE.WebGLRenderer;
  camera: THREE.Camera;
  /** The satellite point cloud's geometry — picking renders the same buffers. */
  geometry: THREE.BufferGeometry;
  /** The visible material's uniforms, shared so interpolation stays in step. */
  uniforms: Record<string, THREE.IUniform>;
}

export interface PickerHandle {
  /** CSS pixel coordinates relative to the canvas. Null when nothing is hit. */
  pick(cssX: number, cssY: number): number | null;
  dispose(): void;
}

/**
 * GPU colour-ID picking.
 *
 * Renders only the points layer into a 1x1 scissored target at the cursor and
 * reads back one pixel. Exact at any density with no spatial index to rebuild
 * as 16,577 objects move.
 *
 * The picking material shares the visible material's uniform objects, so
 * `uAlpha` is identical for both. That is what guarantees the picked position
 * is the drawn position.
 */
export function createPicker(deps: PickerDeps): PickerHandle {
  const { renderer, camera, geometry, uniforms } = deps;

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${HERMITE_ATTRIBUTES}
      attribute vec3 pickColor;
      varying vec3 vPickColor;
      void main() {
        vPickColor = pickColor;
        ${HERMITE_VERTEX_BODY}
        // Slightly larger than the visible point so thin targets stay clickable.
        gl_PointSize = clamp(uPointSize / max(-mv.z, 0.001), 3.0, 8.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vPickColor;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        if (dot(d, d) > 0.25) discard;
        gl_FragColor = vec4(vPickColor, 1.0);
      }
    `,
  });

  const scene = new THREE.Scene();
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);

  const target = new THREE.WebGLRenderTarget(1, 1, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
  });
  const pixel = new Uint8Array(4);

  return {
    pick(cssX, cssY) {
      const size = renderer.getSize(new THREE.Vector2());
      const dpr = renderer.getPixelRatio();
      // Read the one device pixel under the cursor. WebGL's origin is bottom
      // left; CSS coordinates come in top left.
      const px = Math.floor(cssX * dpr);
      const py = Math.floor((size.y - cssY) * dpr);
      if (px < 0 || py < 0 || px >= size.x * dpr || py >= size.y * dpr) return null;

      const previousTarget = renderer.getRenderTarget();
      const previousScissorTest = renderer.getScissorTest();

      camera.setViewOffset(size.x * dpr, size.y * dpr, px, size.y * dpr - py - 1, 1, 1);
      renderer.setRenderTarget(target);
      renderer.setScissorTest(false);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);

      camera.clearViewOffset();
      renderer.setRenderTarget(previousTarget);
      renderer.setScissorTest(previousScissorTest);

      return decodePickId(pixel[0]!, pixel[1]!, pixel[2]!);
    },
    dispose() {
      material.dispose();
      target.dispose();
    },
  };
}
```

`camera.setViewOffset` is `PerspectiveCamera`-specific; type `camera` as `THREE.PerspectiveCamera` in `PickerDeps` if the compiler objects.

- [ ] **Step 7: Add the `pickColor` attribute in `createSatellites`**

In `src/render/satellites.ts`, after the other attributes:

```ts
  // Per-point pick id, written once — live indices never change after ready.
  const pickColor = new Float32Array(n * 3);
  for (let j = 0; j < n; j++) {
    const [r, g, b] = encodePickId(j);
    pickColor[j * 3 + 0] = r / 255;
    pickColor[j * 3 + 1] = g / 255;
    pickColor[j * 3 + 2] = b / 255;
  }
  geometry.setAttribute('pickColor', new THREE.BufferAttribute(pickColor, 3));
```

with `import { encodePickId } from './pick-id.ts';` at the top.

- [ ] **Step 8: Typecheck and run the suite**

```bash
pnpm test && pnpm run typecheck
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/render
git commit -m "feat(render): GPU colour-id picking sharing the hermite vertex path"
```

---

## Task 8: Selection, the detail panel, and the live throttle

**Files:**
- Create: `src/ui/DetailPanel.tsx`, `src/ui/throttle.ts`
- Test: `src/ui/throttle.test.ts`
- Modify: `src/globe.ts`, `src/App.tsx`, `src/render/scene.ts`

**Interfaces:**
- Consumes: `createPicker`, `liveState`, `searchCatalog`, `classifyRegime`, `regimeLabel`, `periodMinutes`, `catalogIndexFromLive`, `buildReverseMap`, `liveIndexFromCatalog`
- Produces:
  - `createThrottle(intervalMs: number, now?: () => number): (fn: () => void) => void`
  - `interface Selection { catalogIndex: number; renderable: boolean }`
  - `GlobeHandle` gains `index`, `select(catalogIndex: number | null)`, `onSelection(cb: (s: Selection | null) => void)`, `onLiveState(cb)`
  - `SceneHandle` gains `canvas: HTMLCanvasElement`
  - `<DetailPanel entry liveState status />`

- [ ] **Step 1: Write the failing throttle test**

`src/ui/throttle.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createThrottle } from './throttle.ts';

describe('createThrottle', () => {
  it('runs the first call immediately', () => {
    let t = 1000;
    const throttle = createThrottle(250, () => t);
    let runs = 0;
    throttle(() => runs++);
    expect(runs).toBe(1);
  });

  it('suppresses calls inside the interval', () => {
    let t = 1000;
    const throttle = createThrottle(250, () => t);
    let runs = 0;
    throttle(() => runs++);
    t = 1100; throttle(() => runs++);
    t = 1249; throttle(() => runs++);
    expect(runs).toBe(1);
  });

  it('runs again once the interval has elapsed', () => {
    let t = 1000;
    const throttle = createThrottle(250, () => t);
    let runs = 0;
    throttle(() => runs++);
    t = 1250; throttle(() => runs++);
    t = 1500; throttle(() => runs++);
    expect(runs).toBe(3);
  });

  it('keeps 60fps callers down to the interval rate', () => {
    // 60 frames over one second against a 250 ms throttle: 1 + 4 boundaries.
    let t = 0;
    const throttle = createThrottle(250, () => t);
    let runs = 0;
    for (let f = 0; f <= 60; f++) { t = f * (1000 / 60); throttle(() => runs++); }
    expect(runs).toBeLessThanOrEqual(5);
    expect(runs).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then write `src/ui/throttle.ts`**

```bash
pnpm exec vitest run src/ui/throttle.test.ts
```

Expected: FAIL. Then:

```ts
/**
 * Leading-edge throttle.
 *
 * Live values arrive at 60 fps; the panel writes to the DOM at 4 Hz. Digits
 * changing sixty times a second are unreadable, and re-rendering React that
 * often for numbers nobody can follow is pure waste.
 *
 * `now` is injected so this is testable without timers or `vi.mock`.
 */
export function createThrottle(
  intervalMs: number, now: () => number = () => performance.now(),
): (fn: () => void) => void {
  let last = Number.NEGATIVE_INFINITY;
  return (fn) => {
    const t = now();
    if (t - last < intervalMs) return;
    last = t;
    fn();
  };
}
```

- [ ] **Step 3: Verify it passes**

```bash
pnpm exec vitest run src/ui/throttle.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 4: Write `src/ui/DetailPanel.tsx`**

```tsx
import type { CatalogIndexEntry } from '../catalog/types.ts';
import { classifyRegime, regimeLabel } from '../catalog/regime.ts';
import { classifyConstellation } from '../catalog/constellation.ts';
import type { LiveState } from '../math/geodetic.ts';
import { periodMinutes } from '../math/geodetic.ts';
import { formatKm, formatLatLon, formatPeriod, type TrackingStatus } from './format.ts';
import { BUCKET_COLORS, BUCKET_LABELS, theme } from './theme.ts';

const STATUS_COLOR: Record<TrackingStatus, string> = {
  TRACKING: theme.live, ERROR: theme.error, STALE: theme.warn,
};

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
      <span style={{ color: theme.label }}>{label}</span>
      <span style={{ color: accent ?? theme.textDim }}>{value}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{
      font: `9px ${theme.mono}`, letterSpacing: '.14em', color: theme.labelDim,
      borderBottom: `1px solid ${theme.rule}`, paddingBottom: 3, margin: '9px 0 6px',
    }}>
      {children}
    </div>
  );
}

export function DetailPanel({
  entry, live, status,
}: {
  entry: CatalogIndexEntry;
  live: LiveState | null;
  status: TrackingStatus;
}) {
  const regime = classifyRegime(entry.apogeeKm, entry.perigeeKm);
  const bucket = classifyConstellation(entry.name, entry.apogeeKm, entry.perigeeKm);

  return (
    <div style={{ font: `11px ${theme.mono}`, overflowY: 'auto', flex: 1 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '7px 10px', borderBottom: `1px solid ${theme.border}`,
        background: theme.bgRaised,
      }}>
        <span style={{ font: `10px ${theme.mono}`, letterSpacing: '.14em', color: theme.label }}>
          OBJ {entry.noradId}
        </span>
        <span style={{
          font: `9px ${theme.mono}`, color: STATUS_COLOR[status],
          border: `1px solid ${STATUS_COLOR[status]}55`, padding: '1px 5px',
        }}>
          {status}
        </span>
      </div>

      <div style={{ padding: 10 }}>
        <div style={{ font: `13px ${theme.mono}`, color: theme.text, letterSpacing: '.04em' }}>
          {entry.name}
        </div>
        <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', background: BUCKET_COLORS[bucket],
          }} />
          <span style={{ font: `9px ${theme.mono}`, color: theme.label }}>
            {BUCKET_LABELS[bucket]} · {regimeLabel(regime)}
          </span>
        </div>

        <SectionLabel>LIVE</SectionLabel>
        {live ? (
          <>
            <Row label="ALT" value={formatKm(live.altitudeKm)} accent={theme.live} />
            <Row label="VEL" value={`${live.speedKmS.toFixed(3)} km/s`} accent={theme.live} />
            <Row label="POS" value={formatLatLon(live.latDeg, live.lonDeg)} accent={theme.live} />
          </>
        ) : (
          <Row label="ALT" value="—" />
        )}

        <SectionLabel>ORBIT</SectionLabel>
        <Row label="APO" value={formatKm(entry.apogeeKm, 0)} />
        <Row label="PER" value={formatKm(entry.perigeeKm, 0)} />
        <Row label="INC" value={`${entry.inclinationDeg.toFixed(3)}°`} />
        <Row label="PRD" value={formatPeriod(periodMinutes(entry.meanMotion))} />

        <SectionLabel>IDENTITY</SectionLabel>
        <Row label="INTL" value={entry.intlDesignator} />
        <Row label="TYPE" value={entry.objectType ?? '—'} />
        <Row label="OWNER" value={entry.ownerName ?? entry.owner ?? '—'} />
        <Row label="LAUNCH" value={entry.launchDate ?? '—'} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Expose the canvas from `src/render/scene.ts`**

Add `canvas: HTMLCanvasElement;` to `SceneHandle`, and return `canvas: renderer.domElement` from `createScene`. Click handling needs it and reaching through `renderer.domElement` from `globe.ts` would leak renderer details.

- [ ] **Step 6: Wire selection in `src/globe.ts`**

Add these imports:

```ts
import { buildReverseMap, catalogIndexFromLive, liveIndexFromCatalog } from './catalog/indexing.ts';
import type { CatalogIndexEntry } from './catalog/types.ts';
import { liveState, type LiveState } from './math/geodetic.ts';
import { createPicker } from './render/picking.ts';
import { createThrottle } from './ui/throttle.ts';
```

Extend the handle:

```ts
export interface Selection {
  catalogIndex: number;
  /**
   * False when SGP4 gave this object a non-zero error byte. It is still
   * searchable and still shown, but it has no trustworthy position — so no
   * dot, no trail, and no live values.
   */
  renderable: boolean;
}

export interface GlobeHandle {
  stop: () => void;
  staleSince: string | null;
  index: CatalogIndexEntry[];
  /** Select by catalog index, or null to clear. */
  select(catalogIndex: number | null): void;
  onSelection(listener: (selection: Selection | null) => void): void;
  /** Throttled to 4 Hz. Null when nothing selected, or when not renderable. */
  onLiveState(listener: (state: LiveState | null) => void): void;
}
```

Change the existing destructure to pull in the index, and extend the log so
the excluded objects can actually be found by hand — there is only one, and
without its id the ERROR path is untestable:

```ts
  const { count, liveIndices, index } = await client.init('/data/catalog.json');

  const excluded: number[] = [];
  {
    const live = new Set(liveIndices);
    for (let i = 0; i < count; i++) if (!live.has(i)) excluded.push(index[i]!.noradId);
  }
  console.info(
    `[apsis] ${liveIndices.length} of ${count} objects renderable` +
    (excluded.length ? ` — excluded NORAD ${excluded.join(', ')}` : ''),
  );
```

Then, still inside `startGlobe`:

```ts
  const reverseMap = buildReverseMap(liveIndices, count);
  let selected: Selection | null = null;
  const selectionListeners: ((s: Selection | null) => void)[] = [];
  const liveStateListeners: ((s: LiveState | null) => void)[] = [];

  const setSelection = (catalogIndex: number | null) => {
    if (catalogIndex === (selected?.catalogIndex ?? null)) return;

    if (catalogIndex === null) {
      selected = null;
    } else {
      // Objects excluded by a non-zero SGP4 error are still in the index and
      // still findable by search, so they must be selectable — otherwise
      // their search result is a dead row that silently does nothing. They
      // are shown with an ERROR badge and no live values instead.
      const renderable = liveIndexFromCatalog(reverseMap, catalogIndex) !== null;
      selected = { catalogIndex, renderable };
    }

    for (const l of selectionListeners) l(selected);
    if (selected === null || !selected.renderable) {
      for (const l of liveStateListeners) l(null);
    }
  };
```

Keep the latest frame so live state can be derived on demand:

```ts
  let latestFrame: Frame | null = null;
```

and set `latestFrame = frame;` inside the existing `client.onFrame` callback.

After the picker is available, add click handling and the throttled live-state pump:

```ts
  const picker = createPicker({
    renderer: view.renderer,
    camera: view.camera,
    geometry: satellites.geometry,
    uniforms: satellites.uniforms,
  });

  const onClick = (event: MouseEvent) => {
    const rect = view.canvas.getBoundingClientRect();
    const liveIndex = picker.pick(event.clientX - rect.left, event.clientY - rect.top);
    setSelection(liveIndex === null ? null : catalogIndexFromLive(liveIndices, liveIndex));
  };
  view.canvas.addEventListener('click', onClick);

  const pumpLiveState = createThrottle(250);
  view.onFrame(() => {
    if (epochB <= epochA) return;
    satellites.setAlpha(alphaFor(Date.now(), epochA, epochB));

    pumpLiveState(() => {
      if (selected === null || !selected.renderable || latestFrame === null) return;
      const i = selected.catalogIndex;
      const { positions, velocities } = latestFrame;
      const s = liveState(
        { x: positions[i * 3]!, y: positions[i * 3 + 1]!, z: positions[i * 3 + 2]! },
        { x: velocities[i * 3]!, y: velocities[i * 3 + 1]!, z: velocities[i * 3 + 2]! },
        new Date(),
      );
      for (const l of liveStateListeners) l(s);
    });
  });
```

Replace the existing `view.onFrame` block with the one above rather than adding a second.

Extend the returned handle:

```ts
    index,
    select: setSelection,
    onSelection(listener) { selectionListeners.push(listener); },
    onLiveState(listener) { liveStateListeners.push(listener); },
```

and add `view.canvas.removeEventListener('click', onClick); picker.dispose();` to `stop`.

- [ ] **Step 7: Render the rail in `src/App.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { searchCatalog } from './catalog/search.ts';
import type { CatalogIndexEntry } from './catalog/types.ts';
import { startGlobe, type GlobeHandle, type Selection } from './globe.ts';
import type { LiveState } from './math/geodetic.ts';
import { DetailPanel } from './ui/DetailPanel.tsx';
import { Rail } from './ui/Rail.tsx';
import { ResultList } from './ui/ResultList.tsx';
import type { TrackingStatus } from './ui/format.ts';
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
      <div ref={ref} style={{
        position: 'absolute', inset: 0, left: theme.railWidth,
      }} />
      {staleSince && <StaleBanner generatedAt={staleSince} />}
      <Rail>
        <SearchField value={query} onChange={setQuery} />
        <ResultList
          outcome={outcome}
          selectedCatalogIndex={selected?.catalogIndex ?? null}
          onSelect={(i) => globeRef.current?.select(i)}
        />
        {entry
          ? <DetailPanel entry={entry} live={live} status={status} />
          : (
            <div style={{
              padding: 12, font: `11px ${theme.mono}`, color: theme.labelDim, lineHeight: 1.7,
            }}>
              {index.length.toLocaleString('en-US')} objects tracked.<br />
              Click a satellite or search by name.
            </div>
          )}
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
```

Note the globe container is inset by `theme.railWidth` so the rail never covers it.

- [ ] **Step 8: Suite and typecheck**

```bash
pnpm test && pnpm run typecheck
```

Expected: all pass.

- [ ] **Step 9: Verify in the browser**

```bash
pnpm run dev
```

Check, in order:

1. The rail renders on the left with the object count and prompt.
2. Typing `iss` shows `ISS (ZARYA)` near the top; clicking the row selects it and the panel appears with live values updating a few times a second, not every frame.
3. Typing `starlink` shows 20 rows and a footer reading roughly `and 11,094 more`.
4. Clicking a dot on the globe selects it and the panel matches the dot you clicked — spot-check by clicking a satellite in the GEO ring and confirming the panel reports an altitude near 35,786 km. **If the panel reports a LEO satellite, the index-space mapping is inverted** — that is the failure this design is most exposed to.
5. Clicking empty space clears the selection.
6. **Search the excluded NORAD id from the startup log and click its row.**
   The panel must open with an `ERROR` badge, identity and orbit filled in,
   and live values showing em dashes. A dead row that does nothing means the
   selection guard is still refusing non-renderable objects.
7. No console errors.

- [ ] **Step 10: Commit**

```bash
git add src/globe.ts src/App.tsx src/render/scene.ts src/ui
git commit -m "feat: satellite selection, detail panel, and throttled live state"
```

---

## Task 9: Orbit trails and ground tracks

The only post-`ready` worker request. One satellite over one period is cheap — roughly 200 `propagate` calls, well under a millisecond — so this uses plain `propagate` rather than a second `BulkPropagator`.

**Files:**
- Create: `src/render/trail.ts`
- Test: `src/propagation/series.test.ts`
- Modify: `src/propagation/core.ts`, `src/propagation/worker.ts`, `src/propagation/client.ts`, `src/render/earth.ts`, `src/render/scene.ts`, `src/globe.ts`

**Interfaces:**
- Consumes: `periodMinutes`, `liveState`, `SCENE_SCALE`
- Produces:
  - `PropagationCore` gains `series(catalogIndex: number, startMs: number, sampleCount: number): TrailSeries | null`
  - `interface TrailSeries { samples: Float32Array; epochMs: Float64Array; periodMinutes: number }`
  - `PropagationClient` gains `requestTrail(catalogIndex: number)` and `onTrail(listener)`
  - `EarthHandle` and `SceneHandle` gain `spinGroup: THREE.Group`
  - `createTrail(spinGroup: THREE.Group, eciGroup: THREE.Group): TrailHandle`
  - `interface TrailHandle { set(series: TrailSeries): void; clear(): void; dispose(): void }`

- [ ] **Step 1: Write the failing series test**

`src/propagation/series.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { createPropagationCore } from './core.ts';
import { periodMinutes } from '../math/geodetic.ts';
import type { CatalogEntry, TrimmedOmm } from '../catalog/types.ts';

const ISS: TrimmedOmm = {
  OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', NORAD_CAT_ID: 25544,
  EPOCH: '2026-09-19T12:00:00.000000', MEAN_MOTION: 15.50103472,
  ECCENTRICITY: 0.0004364, INCLINATION: 51.6412, RA_OF_ASC_NODE: 247.4627,
  ARG_OF_PERICENTER: 130.5360, MEAN_ANOMALY: 325.0288, BSTAR: 0.00023844,
  MEAN_MOTION_DOT: 0.00012353, MEAN_MOTION_DDOT: 0, ELEMENT_SET_NO: 999,
};
const entry = (omm: TrimmedOmm): CatalogEntry => ({
  omm,
  meta: { objectType: null, owner: null, ownerName: null, launchDate: null, apogeeKm: null, perigeeKm: null },
});
const START = Date.parse('2026-09-19T13:30:00.000Z');

describe('PropagationCore.series', () => {
  it('returns the requested number of samples', async () => {
    const core = await createPropagationCore([entry(ISS)]);
    const s = core.series(0, START, 200)!;
    expect(s.samples).toHaveLength(200 * 3);
    expect(s.epochMs).toHaveLength(200);
    core.dispose();
  });

  it('spans one full orbital period', async () => {
    const core = await createPropagationCore([entry(ISS)]);
    const s = core.series(0, START, 200)!;
    expect(s.periodMinutes).toBeCloseTo(periodMinutes(ISS.MEAN_MOTION), 3);
    const spanMin = (s.epochMs[199]! - s.epochMs[0]!) / 60_000;
    expect(spanMin).toBeCloseTo(s.periodMinutes, 0);
    core.dispose();
  });

  it('closes the loop — last sample returns near the first', async () => {
    const core = await createPropagationCore([entry(ISS)]);
    const s = core.series(0, START, 200)!;
    const d = Math.hypot(
      s.samples[597]! - s.samples[0]!,
      s.samples[598]! - s.samples[1]!,
      s.samples[599]! - s.samples[2]!,
    );
    // One sample step of travel, not a wild discontinuity.
    expect(d).toBeLessThan(400);
    core.dispose();
  });

  it('keeps every sample at a plausible orbital radius', async () => {
    const core = await createPropagationCore([entry(ISS)]);
    const s = core.series(0, START, 200)!;
    for (let i = 0; i < 200; i++) {
      const r = Math.hypot(s.samples[i * 3]!, s.samples[i * 3 + 1]!, s.samples[i * 3 + 2]!);
      expect(r).toBeGreaterThan(6600);
      expect(r).toBeLessThan(6900);
    }
    core.dispose();
  });

  it('returns null for an out-of-range catalog index rather than throwing', async () => {
    const core = await createPropagationCore([entry(ISS)]);
    expect(core.series(99, START, 200)).toBeNull();
    expect(core.series(-1, START, 200)).toBeNull();
    core.dispose();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm exec vitest run src/propagation/series.test.ts
```

Expected: FAIL — `core.series` is not a function.

- [ ] **Step 3: Add `series` to `src/propagation/core.ts`**

Add `propagate` to the satellite.js import and
`import { periodMinutes } from '../math/geodetic.ts';` — the conversion lives
in one place. Add the type and interface member:

```ts
export interface TrailSeries {
  /** ECI km, packed [x,y,z] per sample. */
  samples: Float32Array;
  /** Wall-clock epoch of each sample, parallel to `samples`. */
  epochMs: Float64Array;
  periodMinutes: number;
}
```

```ts
  /** Sample one satellite across a full orbital period, for trail drawing. */
  series(catalogIndex: number, startMs: number, sampleCount: number): TrailSeries | null;
```

and implement it inside the returned object, using the `satrecs` array already in scope:

```ts
    series(catalogIndex, startMs, sampleCount) {
      const satrec = satrecs[catalogIndex];
      if (!satrec) return null;

      const period = periodMinutes(catalog[catalogIndex]!.omm.MEAN_MOTION);
      const stepMs = (period * 60_000) / (sampleCount - 1);

      const samples = new Float32Array(sampleCount * 3);
      const epochMs = new Float64Array(sampleCount);

      for (let i = 0; i < sampleCount; i++) {
        const t = startMs + i * stepMs;
        epochMs[i] = t;
        const pv = propagate(satrec, new Date(t));
        if (pv === null) continue;   // leave a zero; the renderer skips it
        samples[i * 3 + 0] = pv.position.x;
        samples[i * 3 + 1] = pv.position.y;
        samples[i * 3 + 2] = pv.position.z;
      }
      return { samples, epochMs, periodMinutes: period };
    },
```

`createPropagationCore` must keep its `catalog` parameter in scope for the mean motion lookup — it already receives it.

- [ ] **Step 4: Verify the series tests pass**

```bash
pnpm exec vitest run src/propagation/series.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Handle the trail request in `src/propagation/worker.ts`**

Inside the message handler, after the `tick` branch:

```ts
    if (request.type === 'trail') {
      if (!core) throw new Error('trail before init');
      const series = core.series(request.catalogIndex, request.epochMs, 200);
      if (!series) return;
      post(
        {
          type: 'trail',
          catalogIndex: request.catalogIndex,
          samples: series.samples,
          epochMs: series.epochMs,
          periodMinutes: series.periodMinutes,
        },
        [series.samples.buffer, series.epochMs.buffer],
      );
    }
```

- [ ] **Step 6: Add trail plumbing to `src/propagation/client.ts`**

```ts
export interface Trail {
  catalogIndex: number;
  samples: Float32Array;
  epochMs: Float64Array;
  periodMinutes: number;
}
```

Add to `PropagationClient`:

```ts
  requestTrail(catalogIndex: number): void;
  onTrail(listener: (trail: Trail) => void): void;
```

Add a `trailListeners` array, a `'trail'` case in the message handler that fans out to it, and the two methods:

```ts
    requestTrail(catalogIndex) {
      send({ type: 'trail', catalogIndex, epochMs: Date.now() });
    },
    onTrail(listener) { trailListeners.push(listener); },
```

- [ ] **Step 7: Expose the spin group**

In `src/render/earth.ts`, add `spinGroup: THREE.Group;` to `EarthHandle` and return `spinGroup: spin`. In `src/render/scene.ts`, add `spinGroup: THREE.Group;` to `SceneHandle` and return `spinGroup: earth.spinGroup`.

The ground track is parented to the spin group so it stays fixed to geography as the globe turns. The orbit trail is parented to the scene, because it lives in the inertial frame.

- [ ] **Step 8: Write `src/render/trail.ts`**

```ts
import * as THREE from 'three';
import { degreesLat, degreesLong, eciToGeodetic, gstime } from 'satellite.js';
import type { TrailSeries } from '../propagation/core.ts';
import { SCENE_SCALE } from './earth.ts';

export interface TrailHandle {
  set(series: TrailSeries): void;
  clear(): void;
  dispose(): void;
}

const TRAIL_COLOR = 0x8fd6ff;
const TRACK_COLOR = 0x9fe0a8;
/** Lift the ground track clear of the surface so it does not z-fight. */
const TRACK_LIFT = 1.002;

/**
 * Orbit trail and ground track for the selected satellite.
 *
 * The trail is inertial and belongs in the scene. The ground track is
 * geographic and belongs in the spin group, so it stays over the same
 * terrain while the earth turns beneath the orbit.
 */
export function createTrail(
  scene: THREE.Object3D, spinGroup: THREE.Object3D,
): TrailHandle {
  const trailGeometry = new THREE.BufferGeometry();
  const trail = new THREE.Line(
    trailGeometry,
    new THREE.LineBasicMaterial({ color: TRAIL_COLOR, transparent: true, opacity: 0.75 }),
  );
  trail.frustumCulled = false;
  trail.visible = false;
  scene.add(trail);

  const trackGeometry = new THREE.BufferGeometry();
  const track = new THREE.Line(
    trackGeometry,
    new THREE.LineBasicMaterial({ color: TRACK_COLOR, transparent: true, opacity: 0.55 }),
  );
  track.frustumCulled = false;
  track.visible = false;
  spinGroup.add(track);

  return {
    set(series) {
      const n = series.epochMs.length;

      const trailPoints = new Float32Array(n * 3);
      for (let i = 0; i < n * 3; i++) trailPoints[i] = series.samples[i]! * SCENE_SCALE;
      trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPoints, 3));
      trailGeometry.computeBoundingSphere();
      trail.visible = true;

      // Ground track: project each inertial sample to its sub-satellite
      // point using that sample's own GMST, then place it on the sphere in
      // the earth-fixed frame.
      const trackPoints = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const date = new Date(series.epochMs[i]!);
        const geo = eciToGeodetic(
          {
            x: series.samples[i * 3]!,
            y: series.samples[i * 3 + 1]!,
            z: series.samples[i * 3 + 2]!,
          },
          gstime(date),
        );
        const lat = degreesLat(geo.latitude) * (Math.PI / 180);
        const lon = degreesLong(geo.longitude) * (Math.PI / 180);
        // The spin group applies GMST, and the tilt group maps the sphere's
        // pole onto +Z, so build the point in that same local frame.
        trackPoints[i * 3 + 0] = TRACK_LIFT * Math.cos(lat) * Math.cos(lon);
        trackPoints[i * 3 + 1] = TRACK_LIFT * Math.cos(lat) * Math.sin(lon);
        trackPoints[i * 3 + 2] = TRACK_LIFT * Math.sin(lat);
      }
      trackGeometry.setAttribute('position', new THREE.BufferAttribute(trackPoints, 3));
      trackGeometry.computeBoundingSphere();
      track.visible = true;
    },
    clear() {
      trail.visible = false;
      track.visible = false;
    },
    dispose() {
      trail.removeFromParent();
      track.removeFromParent();
      trailGeometry.dispose();
      trackGeometry.dispose();
      (trail.material as THREE.Material).dispose();
      (track.material as THREE.Material).dispose();
    },
  };
}
```

- [ ] **Step 9: Wire trails into `src/globe.ts`**

```ts
import { createTrail } from './render/trail.ts';
```

After the satellites are added:

```ts
  const trail = createTrail(view.scene, view.spinGroup);
  client.onTrail((t) => {
    // A trail that arrived after the selection changed is stale.
    if (t.catalogIndex !== selected?.catalogIndex) return;
    trail.set(t);
  });
```

Inside `setSelection`, after the listeners fire:

```ts
    if (selected === null || !selected.renderable) trail.clear();
    else client.requestTrail(selected.catalogIndex);
```

Add `trail.dispose();` to `stop`.

- [ ] **Step 10: Suite, typecheck, browser**

```bash
pnpm test && pnpm run typecheck && pnpm run dev
```

Check:

1. Selecting the ISS draws a closed blue loop through it and a green track on the surface.
2. **The ground track stays over the same geography as the globe rotates** — this is the assertion that proves the spin-group parenting is right. If it slides, the track was parented to the scene instead.
3. The trail does not rotate with the earth.
4. Selecting a GEO satellite draws a small loop and a ground track that stays near one longitude.
5. Clearing the selection removes both.

- [ ] **Step 11: Commit**

```bash
git add src/propagation src/render src/globe.ts
git commit -m "feat: orbit trails and earth-fixed ground tracks"
```

---

## Task 10: Constellation colour and the Starlink control

**Files:**
- Create: `src/ui/ConstellationLegend.tsx`
- Modify: `src/render/satellites.ts`, `src/globe.ts`, `src/App.tsx`
- Test: `src/render/bucket-attribute.test.ts`

**Interfaces:**
- Consumes: `BUCKETS`, `bucketIndex`, `classifyConstellation`, `BUCKET_COLOR_LIST`, `CatalogIndexEntry`
- Produces:
  - `buildBucketAttribute(index: CatalogIndexEntry[], liveIndices: Uint32Array): Float32Array`
  - `type StarlinkMode = 'show' | 'dim' | 'hide'`
  - `createSatellites(liveIndices, buckets: Float32Array)` — second parameter is new
  - `SatellitesHandle` gains `setStarlinkMode(mode: StarlinkMode)`
  - `GlobeHandle` gains `setStarlinkMode(mode: StarlinkMode)`

- [ ] **Step 1: Write the failing attribute test**

`src/render/bucket-attribute.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildBucketAttribute } from './satellites.ts';
import { bucketIndex } from '../catalog/constellation.ts';
import type { CatalogIndexEntry } from '../catalog/types.ts';

const make = (name: string, apogeeKm: number | null = 550, perigeeKm: number | null = 540):
  CatalogIndexEntry => ({
  noradId: 1, name, intlDesignator: '2020-001A', objectType: 'PAY',
  owner: 'US', ownerName: 'United States', launchDate: '2020-01-01',
  apogeeKm, perigeeKm, inclinationDeg: 53, meanMotion: 15.1,
});

describe('buildBucketAttribute', () => {
  it('writes one value per live satellite, in live order', () => {
    const index = [make('STARLINK-1'), make('ISS (ZARYA)'), make('ONEWEB-2')];
    const attr = buildBucketAttribute(index, Uint32Array.from([0, 1, 2]));
    expect(attr).toHaveLength(3);
    expect(attr[0]).toBe(bucketIndex('starlink'));
    expect(attr[1]).toBe(bucketIndex('other'));
    expect(attr[2]).toBe(bucketIndex('oneweb'));
  });

  it('follows liveIndices rather than catalog order — the index-space trap', () => {
    const index = [make('STARLINK-1'), make('ISS (ZARYA)'), make('ONEWEB-2')];
    // Catalog entry 1 is not renderable.
    const attr = buildBucketAttribute(index, Uint32Array.from([0, 2]));
    expect(attr).toHaveLength(2);
    expect(attr[0]).toBe(bucketIndex('starlink'));
    expect(attr[1]).toBe(bucketIndex('oneweb'));
  });

  it('buckets a geostationary object into the GEO belt', () => {
    const attr = buildBucketAttribute([make('INTELSAT 901', 35800, 35780)], Uint32Array.from([0]));
    expect(attr[0]).toBe(bucketIndex('geo'));
  });

  it('returns an empty attribute for an empty live set', () => {
    expect(buildBucketAttribute([make('STARLINK-1')], new Uint32Array(0))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails, then implement**

```bash
pnpm exec vitest run src/render/bucket-attribute.test.ts
```

Expected: FAIL. Then add to `src/render/satellites.ts`:

```ts
import { bucketIndex, classifyConstellation } from '../catalog/constellation.ts';
import type { CatalogIndexEntry } from '../catalog/types.ts';
import { BUCKET_COLOR_LIST } from '../ui/theme.ts';

export type StarlinkMode = 'show' | 'dim' | 'hide';

/**
 * One bucket index per renderable satellite, in live-index order.
 *
 * Indexed by live index, not catalog index — the render buffers are
 * compacted, and writing this in catalog order would colour the wrong dots.
 */
export function buildBucketAttribute(
  index: CatalogIndexEntry[], liveIndices: Uint32Array,
): Float32Array {
  const out = new Float32Array(liveIndices.length);
  for (let j = 0; j < liveIndices.length; j++) {
    const entry = index[liveIndices[j]!];
    if (!entry) continue;
    out[j] = bucketIndex(
      classifyConstellation(entry.name, entry.apogeeKm, entry.perigeeKm),
    );
  }
  return out;
}

const STARLINK_BUCKET = bucketIndex('starlink');
const MODE_VALUE: Record<StarlinkMode, number> = { show: 0, dim: 1, hide: 2 };
```

- [ ] **Step 3: Add the attribute, palette and mode uniform to the material**

Change the signature:

```ts
export function createSatellites(
  liveIndices: Uint32Array, buckets: Float32Array,
): SatellitesHandle {
```

Add to `HERMITE_ATTRIBUTES`:

```glsl
  attribute float bucket;
```

Add to the visible vertex shader, after the Hermite body:

```glsl
    vBucket = bucket;
```

with `varying float vBucket;` declared in both the vertex and fragment shaders, and in the fragment shader:

```glsl
  uniform vec3 uPalette[5];
  uniform float uStarlinkMode;   // 0 show, 1 dim, 2 hide
  uniform float uStarlinkBucket;
  varying float vBucket;

  void main() {
    float isStarlink = step(abs(vBucket - uStarlinkBucket), 0.5);
    if (isStarlink > 0.5 && uStarlinkMode > 1.5) discard;

    vec2 d = gl_PointCoord - vec2(0.5);
    float r = dot(d, d);
    if (r > 0.25) discard;

    vec3 color = uPalette[int(vBucket + 0.5)];
    float alpha = smoothstep(0.25, 0.0, r);
    if (isStarlink > 0.5 && uStarlinkMode > 0.5) alpha *= 0.18;
    gl_FragColor = vec4(color, alpha);
  }
```

Register the attribute and uniforms:

```ts
  geometry.setAttribute('bucket', new THREE.BufferAttribute(buckets, 1));
```

```ts
      uPalette: { value: BUCKET_COLOR_LIST.map((hex) => new THREE.Color(hex)) },
      uStarlinkMode: { value: MODE_VALUE.show },
      uStarlinkBucket: { value: STARLINK_BUCKET },
```

Drop the now-unused `uColor` uniform. Add to the handle:

```ts
    setStarlinkMode(mode) {
      material.uniforms.uStarlinkMode!.value = MODE_VALUE[mode];
    },
```

and `setStarlinkMode(mode: StarlinkMode): void;` to `SatellitesHandle`.

- [ ] **Step 4: Verify tests pass**

```bash
pnpm exec vitest run src/render/bucket-attribute.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Write `src/ui/ConstellationLegend.tsx`**

```tsx
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
```

- [ ] **Step 6: Wire it through `src/globe.ts` and `src/App.tsx`**

In `globe.ts`, import `buildBucketAttribute` and `type StarlinkMode`, build the attribute and pass it in:

```ts
  const buckets = buildBucketAttribute(index, liveIndices);
  const satellites = createSatellites(liveIndices, buckets);
```

Add `setStarlinkMode(mode: StarlinkMode): void;` to `GlobeHandle` and `setStarlinkMode: satellites.setStarlinkMode,` to the returned object.

In `App.tsx`, add state and render the legend at the bottom of the rail:

```tsx
  const [starlinkMode, setStarlinkMode] = useState<StarlinkMode>('show');
```

```tsx
        <ConstellationLegend
          mode={starlinkMode}
          onModeChange={(m) => { setStarlinkMode(m); globeRef.current?.setStarlinkMode(m); }}
        />
```

placed as the last child of `<Rail>`, with `marginTop: 'auto'` achieved by giving the detail panel `flex: 1` (it already has it).

- [ ] **Step 7: Full suite, typecheck, browser**

```bash
pnpm test && pnpm run typecheck && pnpm run dev
```

Check:

1. Dots are no longer uniformly blue: Starlink is muted grey-blue, the GEO belt reads as a distinct orange ring, GNSS shells are green.
2. **Setting Starlink to `hide` reveals the GEO ring and GNSS shells clearly.** This is the payoff the whole decision was made for — if the globe looks much the same, the bucket attribute is not reaching the shader.
3. `dim` leaves Starlink faintly visible.
4. Legend swatches match the dot colours (both read `BUCKET_COLORS`).
5. Selection, trails and the panel still work in every mode.
6. Frame rate is unchanged — the mode is a uniform, not a buffer rebuild.

- [ ] **Step 8: Commit**

```bash
git add src/render src/ui src/globe.ts src/App.tsx
git commit -m "feat: constellation colour-coding with a starlink dim/hide control"
```

---

## Definition of Done

- `pnpm test` passes with everything scoped under `src` and `scripts`
- `pnpm run typecheck` is clean
- Clicking any dot selects that satellite, verified against a GEO object reporting ~35,786 km
- Searching `starlink` returns 20 rows and an "and 11,094 more" footer
- The detail panel shows live altitude, speed and ground point updating at ~4 Hz
- Orbit trails and ground tracks draw, and the ground track stays over its geography as the globe turns
- Hiding Starlink visibly reveals the GEO ring and GNSS shells
- Owner codes render expanded (`International Space Station`, not `ISS`)
- The one SGP4-excluded object is searchable, selectable, and shows an `ERROR`
  badge with no live values
- No console errors, frame rate unchanged from phase 1

## Deliberately Not In Phase 2

Observer mode, pass prediction and the sky view are phase 3. Time scrubbing remains deferred. Earth textures remain the marked follow-on from phase 1. No mobile or responsive layout. No filter panel beyond the single Starlink control.
