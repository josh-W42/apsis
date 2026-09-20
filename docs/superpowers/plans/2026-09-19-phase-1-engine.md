# apsis Phase 1 (Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed static web page that renders all 16,578 active satellites as a live 3D globe, with positions propagated correctly from build-time-ingested orbital elements.

**Architecture:** A GitHub Actions cron job fetches Celestrak GP + SATCAT, joins and trims them into a static `catalog.json`. The browser loads that artifact into a single Web Worker, which builds SGP4 satrecs and ticks satellite.js's WASM `BulkPropagator` once per second. Position and velocity buffers are uploaded to a single Three.js `Points` draw call whose vertex shader Hermite-interpolates between ticks, so the GPU renders at 60 fps while the CPU propagates at 1 Hz.

**Tech Stack:** TypeScript, Vite, React, vitest, Three.js 0.186.0, satellite.js 7.1.0, Node ≥23, pnpm, Cloudflare Pages, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-19-satellite-globe-design.md` (revision 2)

## Global Constraints

- **Package manager is pnpm, not npm and not bun.** Two independent reasons:
  - npm 11.2.0 crashes with `Cannot read properties of null (reading 'edgesOut')` while resolving vitest 4 or 5's peer set. Reproduced in a clean directory; it is an npm arborist bug, not a package problem. pnpm resolves the same tree without complaint.
  - Local Node is `x64` (Rosetta). An arm64 bun installing arm64 native binaries against an x64 Node breaks rollup/esbuild. pnpm installs `darwin-x64` binaries matching the running Node — verified.
- **pnpm is 6.11.0** (the version installed on this machine). `corepack use pnpm@latest` was attempted and failed with `MODULE_NOT_FOUND`, so there is no `packageManager` field. Upgrading pnpm is a worthwhile follow-up but is not a phase-1 blocker.
- **Node ≥23** — the ingestion scripts are `.ts` run directly by `node` via native type stripping. Verified on v23.10.0. If CI Node is older, add `tsx` and run through it.
- **No `vi.mock`.** All seams are dependency injection: functions take their collaborators as arguments. This is a hard constraint, not a style preference.
- **Scope test commands to explicit paths.** A bare runner will pull in sibling workspace packages.
- **satellite.js pinned to 7.1.0**, three pinned to `0.186.0`.
- **Use `createSingleThreadRuntime()`, never `createMultiThreadRuntime()`.** The pthreads build requires `SharedArrayBuffer` and therefore COOP/COEP headers. The single-thread build is ~50x under budget and needs neither.
- **Always pass `communityDecayCheckEnabled: true`** to `EciBaseCalculator` run parameters.
- **A satellite whose `error` byte is non-zero must never be rendered.**
- All distances in kilometres, all times UTC.

---

## File Structure

```
apsis/
├── .github/workflows/ingest.yml      # cron: fetch, ingest, commit artifact
├── scripts/ingest/
│   ├── parse-gp.ts                   # Celestrak GP response -> OmmRecord[]  (validates)
│   ├── parse-satcat.ts               # satcat.csv -> Map<number, SatcatRow>
│   ├── join.ts                       # OMM + SATCAT -> CatalogEntry[]        (pure)
│   ├── ingest.ts                     # orchestration, fetch injected         (pure-ish)
│   └── run.ts                        # CLI entrypoint: real fetch + fs
├── src/
│   ├── catalog/types.ts              # CatalogEntry, Manifest — shared by both halves
│   ├── propagation/
│   │   ├── core.ts                   # buildSatrecs + tick; no Worker, no DOM
│   │   ├── worker.ts                 # thin Worker shell around core
│   │   ├── client.ts                 # main-thread wrapper; Worker injected
│   │   └── protocol.ts               # message types
│   ├── math/
│   │   ├── hermite.ts                # pure cubic Hermite (JS reference for the shader)
│   │   └── sun.ts                    # sun direction in ECI for a given date
│   ├── render/
│   │   ├── scene.ts                  # renderer, camera, controls, loop
│   │   ├── earth.ts                  # sphere, textures, lighting
│   │   └── satellites.ts             # Points geometry + Hermite shader
│   └── App.tsx
└── public/data/                      # ingestion output, committed
    ├── catalog.json
    └── manifest.json
```

`src/catalog/types.ts` is the only module imported by both the ingestion scripts and the browser code. It is the contract.

**`src/test-support/state.ts`** holds `stateAt(rec, date)`, which propagates
and throws on null. `propagate` returns `PositionAndVelocity | null`, and its
members are non-optional — so tests need one null check, not the per-member
casts an earlier draft of this plan used.

**Why the math lives in `src/math/`:** Three.js cannot render in jsdom, so anything tested under vitest must be free of WebGL. Extracting Hermite and sun-position as pure functions makes the only logic that can silently produce wrong output testable, and leaves `src/render/` as thin wiring verified in a real browser.

---

## Task 1: Project scaffold and test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`
- Create: `src/main.tsx`, `src/App.tsx`
- Test: `src/scaffold.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a working `pnpm test` and `pnpm run dev`; all later tasks depend on this harness

- [x] **Step 1: Create `package.json`**

```json
{
  "name": "apsis",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run src scripts",
    "ingest": "node scripts/ingest/run.ts"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "satellite.js": "7.1.0",
    "three": "0.186.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/node": "^24.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/three": "0.186.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.7.0",
    "vite": "^6.4.0",
    "vitest": "^5.0.1"
  }
}
```

Note `"test": "vitest run src scripts"` — explicitly scoped, per Global Constraints.

- [x] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src", "scripts", "vite.config.ts"]
}
```

- [x] **Step 3: Create `vite.config.ts`, `index.html`, `.gitignore`**

`vite.config.ts`:
```ts
// defineConfig comes from vitest/config, not vite — vite's own defineConfig
// has no `test` key and will fail typecheck.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  test: { environment: 'node' },
});
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>apsis</title>
    <style>
      html, body, #root { margin: 0; height: 100%; background: #05070d; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`.gitignore`:
```
node_modules
dist
.DS_Store
```

Note: `public/data/` is deliberately NOT ignored — the ingestion artifact is committed.

- [x] **Step 4: Create the React shell**

`src/App.tsx`:
```tsx
export function App() {
  return <div id="globe-root" style={{ width: '100%', height: '100%' }} />;
}
```

`src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);
```

- [x] **Step 5: Write the scaffold test**

`src/scaffold.test.ts`:
```ts
import { describe, expect, it } from 'vitest';

describe('scaffold', () => {
  it('runs typescript under vitest', () => {
    const x: number = 1 + 1;
    expect(x).toBe(2);
  });
});
```

- [x] **Step 6: Install and verify**

```bash
pnpm install
ppnpm test
```

Expected: 1 test passes. If rollup or esbuild fails to load a native binary, the wrong architecture was installed — remove `node_modules` and reinstall with pnpm, and confirm `node -p process.arch` matches the binaries under `node_modules/.pnpm`.

- [x] **Step 7: Verify typecheck and dev server**

```bash
pnpm run typecheck
```

Expected: no errors.

- [x] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold vite + react + typescript + vitest"
```

---

## Task 2: Ingestion — parse and validate the Celestrak GP response

Celestrak returns **HTTP 200 with a plain-text body** when data has not changed since your last successful download. A 200 is not a guarantee of JSON. This task exists because that failure silently corrupted a benchmark during design.

**Files:**
- Create: `src/catalog/types.ts`
- Create: `scripts/ingest/parse-gp.ts`
- Test: `scripts/ingest/parse-gp.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type OmmRecord` — raw Celestrak GP record
  - `parseGpResponse(body: string): OmmRecord[]` — throws `IngestError` on any non-JSON or empty body

- [x] **Step 1: Write the failing test**

`scripts/ingest/parse-gp.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseGpResponse } from './parse-gp.ts';

const valid = JSON.stringify([
  { OBJECT_NAME: 'CALSPHERE 1', NORAD_CAT_ID: 900, EPOCH: '2026-09-19T17:48:10.854720',
    MEAN_MOTION: 13.76707938, ECCENTRICITY: 0.0026146, INCLINATION: 90.2179,
    RA_OF_ASC_NODE: 73.9588, ARG_OF_PERICENTER: 10.5867, MEAN_ANOMALY: 121.006,
    BSTAR: 0.00042544, MEAN_MOTION_DOT: 4.28e-6, MEAN_MOTION_DDOT: 0,
    EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', ELEMENT_SET_NO: 999,
    REV_AT_EPOCH: 8443, OBJECT_ID: '1964-063C' },
]);

describe('parseGpResponse', () => {
  it('parses a valid GP array', () => {
    const out = parseGpResponse(valid);
    expect(out).toHaveLength(1);
    expect(out[0]!.NORAD_CAT_ID).toBe(900);
  });

  it('rejects the Celestrak "not updated" plain-text refusal served with HTTP 200', () => {
    const refusal =
      'GP data has not updated since your last successful\n' +
      'download of GROUP=active at 2026-09-20 01:16:54 UTC.\n';
    expect(() => parseGpResponse(refusal)).toThrow(/not valid JSON/i);
  });

  it('rejects an empty body', () => {
    expect(() => parseGpResponse('')).toThrow(/empty/i);
  });

  it('rejects a JSON object that is not an array', () => {
    expect(() => parseGpResponse('{"error":"nope"}')).toThrow(/array/i);
  });

  it('rejects an empty array — a zero-object catalog is always a fault', () => {
    expect(() => parseGpResponse('[]')).toThrow(/zero/i);
  });

  it('rejects a record missing a field SGP4 requires, naming that field', () => {
    // Omit exactly one required field so the assertion isolates it. A fixture
    // missing everything would only ever report whichever field is checked
    // first, which tests the check order rather than the contract.
    const complete = JSON.parse(valid)[0] as Record<string, unknown>;
    delete complete.MEAN_MOTION;
    expect(() => parseGpResponse(JSON.stringify([complete]))).toThrow(/MEAN_MOTION/);
  });

  it('names the object whose record is incomplete', () => {
    const complete = JSON.parse(valid)[0] as Record<string, unknown>;
    delete complete.INCLINATION;
    expect(() => parseGpResponse(JSON.stringify([complete]))).toThrow(/900/);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run scripts/ingest/parse-gp.test.ts
```

Expected: FAIL — cannot resolve `./parse-gp.ts`.

- [x] **Step 3: Write `src/catalog/types.ts`**

```ts
/** A Celestrak GP (OMM) record, as served by gp.php?FORMAT=json. */
export interface OmmRecord {
  OBJECT_NAME: string;
  OBJECT_ID: string;
  NORAD_CAT_ID: number;
  EPOCH: string;
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  BSTAR: number;
  MEAN_MOTION_DOT: number;
  MEAN_MOTION_DDOT: number;
  EPHEMERIS_TYPE: number;
  CLASSIFICATION_TYPE: string;
  ELEMENT_SET_NO: number;
  REV_AT_EPOCH: number;
}

/** Metadata drawn from satcat.csv. Null when the object has no SATCAT row. */
export interface SatcatMeta {
  objectType: string | null;   // PAY | R/B | DEB | UNK
  owner: string | null;
  launchDate: string | null;   // ISO date
  apogeeKm: number | null;
  perigeeKm: number | null;
}

/** One catalog entry: the SGP4 elements plus display metadata. */
export interface CatalogEntry {
  omm: OmmRecord;
  meta: SatcatMeta;
}

export interface Manifest {
  generatedAt: string;   // ISO timestamp
  objectCount: number;
  source: string;
  checksum: string;      // sha256 of catalog.json
}

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestError';
  }
}
```

- [x] **Step 4: Write `scripts/ingest/parse-gp.ts`**

```ts
import { IngestError, type OmmRecord } from '../../src/catalog/types.ts';

/** Fields SGP4 cannot run without. */
const REQUIRED: readonly (keyof OmmRecord)[] = [
  'NORAD_CAT_ID', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION',
  'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR',
  'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT',
];

/**
 * Parse a Celestrak GP JSON response.
 *
 * Celestrak serves HTTP 200 with a plain-text refusal ("GP data has not
 * updated since your last successful download...") when the catalog is
 * unchanged. A 200 status is therefore not sufficient to assume JSON.
 */
export function parseGpResponse(body: string): OmmRecord[] {
  const trimmed = body.trim();
  if (trimmed.length === 0) throw new IngestError('GP response body was empty');

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const preview = trimmed.slice(0, 120).replace(/\s+/g, ' ');
    throw new IngestError(`GP response was not valid JSON. Body began: "${preview}"`);
  }

  if (!Array.isArray(parsed)) {
    throw new IngestError('GP response was valid JSON but not an array');
  }
  if (parsed.length === 0) {
    throw new IngestError('GP response contained zero objects');
  }

  for (const record of parsed as OmmRecord[]) {
    for (const field of REQUIRED) {
      if (record[field] === undefined || record[field] === null) {
        throw new IngestError(
          `GP record ${record.NORAD_CAT_ID ?? '<no id>'} is missing ${field}`,
        );
      }
    }
  }
  return parsed as OmmRecord[];
}
```

- [x] **Step 5: Run the test to verify it passes**

```bash
pnpm exec vitest run scripts/ingest/parse-gp.test.ts
```

Expected: 6 tests PASS.

- [x] **Step 6: Commit**

```bash
git add src/catalog/types.ts scripts/ingest/parse-gp.ts scripts/ingest/parse-gp.test.ts
git commit -m "feat(ingest): parse and validate Celestrak GP responses"
```

---

## Task 3: Ingestion — parse SATCAT and join

**Files:**
- Create: `scripts/ingest/parse-satcat.ts`
- Create: `scripts/ingest/join.ts`
- Test: `scripts/ingest/parse-satcat.test.ts`, `scripts/ingest/join.test.ts`

**Interfaces:**
- Consumes: `OmmRecord`, `SatcatMeta`, `CatalogEntry`, `TrimmedOmm`, `TRIMMED_OMM_FIELDS`, `IngestError` from `src/catalog/types.ts`
- Produces:
  - `parseSatcat(csv: string): Map<number, SatcatRow>`
  - `interface SatcatRow { meta: SatcatMeta; decayDate: string | null }`
  - `joinCatalog(omm: OmmRecord[], satcat: Map<number, SatcatRow>): CatalogEntry[]`

The real `satcat.csv` is 70,708 rows and includes long-decayed objects, so the join must drop anything carrying a `DECAY_DATE`. GP records with no SATCAT row are **kept** with null metadata — a newly launched object appears in GP before SATCAT and must not vanish from the globe.

- [x] **Step 1: Write the failing tests**

`scripts/ingest/parse-satcat.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseSatcat } from './parse-satcat.ts';

const HEADER =
  'OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,OPS_STATUS_CODE,OWNER,' +
  'LAUNCH_DATE,LAUNCH_SITE,DECAY_DATE,PERIOD,INCLINATION,APOGEE,PERIGEE,' +
  'RCS,DATA_STATUS_CODE,ORBIT_CENTER,ORBIT_TYPE';

describe('parseSatcat', () => {
  it('parses a live row', () => {
    const csv = `${HEADER}\nISS (ZARYA),1998-067A,25544,PAY,+,ISS,1998-11-20,TTMTR,,92.8,51.64,420,410,399.05,,EA,ORB`;
    const rows = parseSatcat(csv);
    const iss = rows.get(25544)!;
    expect(iss.meta.objectType).toBe('PAY');
    expect(iss.meta.owner).toBe('ISS');
    expect(iss.meta.apogeeKm).toBe(420);
    expect(iss.meta.perigeeKm).toBe(410);
    expect(iss.decayDate).toBeNull();
  });

  it('records a decay date when present', () => {
    const csv = `${HEADER}\nSL-1 R/B,1957-001A,1,R/B,D,CIS,1957-10-04,TYMSC,1957-12-01,96.19,65.10,938,214,20.42,,EA,IMP`;
    expect(parseSatcat(csv).get(1)!.decayDate).toBe('1957-12-01');
  });

  it('leaves blank numeric fields null rather than NaN', () => {
    const csv = `${HEADER}\nUNKNOWN,2020-999Z,99999,UNK,,TBD,2020-01-01,TBD,,,,,,,,EA,`;
    const row = parseSatcat(csv).get(99999)!;
    expect(row.meta.apogeeKm).toBeNull();
    expect(row.meta.perigeeKm).toBeNull();
  });

  it('handles quoted fields containing commas', () => {
    const csv = `${HEADER}\n"FOO, BAR",2020-001A,12345,PAY,+,US,2020-01-01,AFETR,,90,50,500,490,1.0,,EA,ORB`;
    expect(parseSatcat(csv).get(12345)!.meta.objectType).toBe('PAY');
  });

  it('ignores blank trailing lines', () => {
    const csv = `${HEADER}\nISS (ZARYA),1998-067A,25544,PAY,+,ISS,1998-11-20,TTMTR,,92.8,51.64,420,410,399.05,,EA,ORB\n\n`;
    expect(parseSatcat(csv).size).toBe(1);
  });
});
```

`scripts/ingest/join.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { joinCatalog } from './join.ts';
import type { OmmRecord } from '../../src/catalog/types.ts';
import type { SatcatRow } from './parse-satcat.ts';

function omm(id: number, name = `SAT-${id}`): OmmRecord {
  return {
    OBJECT_NAME: name, OBJECT_ID: `2020-00${id}A`, NORAD_CAT_ID: id,
    EPOCH: '2026-09-19T00:00:00', MEAN_MOTION: 15.5, ECCENTRICITY: 0.001,
    INCLINATION: 51.6, RA_OF_ASC_NODE: 100, ARG_OF_PERICENTER: 90,
    MEAN_ANOMALY: 10, BSTAR: 0.0001, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0,
    EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', ELEMENT_SET_NO: 999,
    REV_AT_EPOCH: 100,
  };
}
const row = (decayDate: string | null): SatcatRow => ({
  meta: { objectType: 'PAY', owner: 'US', launchDate: '2020-01-01',
          apogeeKm: 500, perigeeKm: 490 },
  decayDate,
});

describe('joinCatalog', () => {
  it('attaches SATCAT metadata by NORAD id', () => {
    const out = joinCatalog([omm(1)], new Map([[1, row(null)]]));
    expect(out).toHaveLength(1);
    expect(out[0]!.meta.owner).toBe('US');
  });

  it('drops objects with a decay date', () => {
    const out = joinCatalog([omm(1), omm(2)],
      new Map([[1, row('2024-01-01')], [2, row(null)]]));
    expect(out.map((e) => e.omm.NORAD_CAT_ID)).toEqual([2]);
  });

  it('keeps GP records absent from SATCAT, with null metadata', () => {
    const out = joinCatalog([omm(7)], new Map());
    expect(out).toHaveLength(1);
    expect(out[0]!.meta).toEqual({
      objectType: null, owner: null, launchDate: null,
      apogeeKm: null, perigeeKm: null,
    });
  });

  it('is deterministic — output is sorted by NORAD id', () => {
    const out = joinCatalog([omm(30), omm(2), omm(11)], new Map());
    expect(out.map((e) => e.omm.NORAD_CAT_ID)).toEqual([2, 11, 30]);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
pnpm exec vitest run scripts/ingest/parse-satcat.test.ts scripts/ingest/join.test.ts
```

Expected: FAIL — modules not found.

- [x] **Step 3: Write `scripts/ingest/parse-satcat.ts`**

```ts
import type { SatcatMeta } from '../../src/catalog/types.ts';

export interface SatcatRow {
  meta: SatcatMeta;
  decayDate: string | null;
}

/** Split one CSV line, honouring double-quoted fields that contain commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(field); field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

const str = (v: string | undefined): string | null => {
  const t = v?.trim() ?? '';
  return t.length === 0 ? null : t;
};
const num = (v: string | undefined): number | null => {
  const t = v?.trim() ?? '';
  if (t.length === 0) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Parse satcat.csv into a lookup keyed by NORAD catalog id. */
export function parseSatcat(csv: string): Map<number, SatcatRow> {
  const lines = csv.split(/\r?\n/);
  const header = splitCsvLine(lines[0] ?? '');
  const col = (name: string) => header.indexOf(name);

  const iId = col('NORAD_CAT_ID');
  const iType = col('OBJECT_TYPE');
  const iOwner = col('OWNER');
  const iLaunch = col('LAUNCH_DATE');
  const iDecay = col('DECAY_DATE');
  const iApogee = col('APOGEE');
  const iPerigee = col('PERIGEE');

  const rows = new Map<number, SatcatRow>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim().length === 0) continue;
    const f = splitCsvLine(line);
    const id = num(f[iId]);
    if (id === null) continue;
    rows.set(id, {
      meta: {
        objectType: str(f[iType]),
        owner: str(f[iOwner]),
        launchDate: str(f[iLaunch]),
        apogeeKm: num(f[iApogee]),
        perigeeKm: num(f[iPerigee]),
      },
      decayDate: str(f[iDecay]),
    });
  }
  return rows;
}
```

- [x] **Step 4: Write `scripts/ingest/join.ts`**

```ts
import type { CatalogEntry, OmmRecord, SatcatMeta } from '../../src/catalog/types.ts';
import type { SatcatRow } from './parse-satcat.ts';

const EMPTY_META: SatcatMeta = {
  objectType: null, owner: null, launchDate: null,
  apogeeKm: null, perigeeKm: null,
};

/**
 * Join GP elements to SATCAT metadata.
 *
 * Objects with a DECAY_DATE are dropped: they have re-entered, and SGP4 will
 * propagate them to meaningless positions. GP records with no SATCAT row are
 * kept with null metadata — newly launched objects appear in GP first, and
 * must not disappear from the globe while SATCAT catches up.
 *
 * Output is sorted by NORAD id so the artifact is byte-stable across runs
 * when the inputs have not changed.
 */
export function joinCatalog(
  omm: OmmRecord[],
  satcat: Map<number, SatcatRow>,
): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const record of omm) {
    const row = satcat.get(record.NORAD_CAT_ID);
    if (row?.decayDate) continue;
    entries.push({ omm: record, meta: row?.meta ?? EMPTY_META });
  }
  entries.sort((a, b) => a.omm.NORAD_CAT_ID - b.omm.NORAD_CAT_ID);
  return entries;
}
```

- [x] **Step 5: Run the tests to verify they pass**

```bash
pnpm exec vitest run scripts/ingest/parse-satcat.test.ts scripts/ingest/join.test.ts
```

Expected: 9 tests PASS.

- [x] **Step 6: Commit**

```bash
git add scripts/ingest/parse-satcat.ts scripts/ingest/join.ts scripts/ingest/parse-satcat.test.ts scripts/ingest/join.test.ts
git commit -m "feat(ingest): parse satcat.csv and join to GP elements"
```

---

## Task 4: Ingestion — orchestration and CLI

**Files:**
- Create: `scripts/ingest/ingest.ts` (pure orchestration, collaborators injected)
- Create: `scripts/ingest/run.ts` (CLI entrypoint: real `fetch`, real `fs`)
- Test: `scripts/ingest/ingest.test.ts`

**Interfaces:**
- Consumes: `parseGpResponse`, `parseSatcat`, `joinCatalog`, `Manifest`, `IngestError`
- Produces:
  - `interface IngestDeps { fetchText(url: string): Promise<string>; now(): Date }`
  - `interface IngestResult { catalog: CatalogEntry[]; manifest: Manifest; catalogJson: string }`
  - `runIngest(deps: IngestDeps): Promise<IngestResult>`
  - `GP_URL`, `SATCAT_URL` constants

`runIngest` performs **no I/O of its own** — `fetchText` and `now` are injected. That is what makes it testable without `vi.mock`, per Global Constraints. `run.ts` is the only file that touches the network or disk.

- [x] **Step 1: Write the failing test**

`scripts/ingest/ingest.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { GP_URL, SATCAT_URL, runIngest, type IngestDeps } from './ingest.ts';

const GP = JSON.stringify([
  { OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', NORAD_CAT_ID: 25544,
    EPOCH: '2026-09-19T00:00:00', MEAN_MOTION: 15.5, ECCENTRICITY: 0.001,
    INCLINATION: 51.6, RA_OF_ASC_NODE: 100, ARG_OF_PERICENTER: 90,
    MEAN_ANOMALY: 10, BSTAR: 0.0001, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0,
    EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', ELEMENT_SET_NO: 999,
    REV_AT_EPOCH: 100 },
]);

const SATCAT =
  'OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,OPS_STATUS_CODE,OWNER,' +
  'LAUNCH_DATE,LAUNCH_SITE,DECAY_DATE,PERIOD,INCLINATION,APOGEE,PERIGEE,' +
  'RCS,DATA_STATUS_CODE,ORBIT_CENTER,ORBIT_TYPE\n' +
  'ISS (ZARYA),1998-067A,25544,PAY,+,ISS,1998-11-20,TTMTR,,92.8,51.64,420,410,399.05,,EA,ORB';

function deps(over: Partial<Record<string, string>> = {}): IngestDeps {
  return {
    fetchText: async (url) => {
      if (url === GP_URL) return over.gp ?? GP;
      if (url === SATCAT_URL) return over.satcat ?? SATCAT;
      throw new Error(`unexpected url ${url}`);
    },
    now: () => new Date('2026-09-19T12:00:00.000Z'),
  };
}

describe('runIngest', () => {
  it('produces a joined catalog and a manifest', async () => {
    const { catalog, manifest } = await runIngest(deps());
    expect(catalog).toHaveLength(1);
    expect(catalog[0]!.meta.owner).toBe('ISS');
    expect(manifest.objectCount).toBe(1);
    expect(manifest.generatedAt).toBe('2026-09-19T12:00:00.000Z');
    expect(manifest.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('propagates the Celestrak refusal as an IngestError, so the caller can keep the last good artifact', async () => {
    await expect(runIngest(deps({ gp: 'GP data has not updated since your last successful\ndownload.' })))
      .rejects.toThrow(/not valid JSON/i);
  });

  it('fails rather than emitting an empty catalog when SATCAT marks everything decayed', async () => {
    const allDecayed = SATCAT.replace(',,92.8,51.64', ',2024-01-01,92.8,51.64');
    await expect(runIngest(deps({ satcat: allDecayed })))
      .rejects.toThrow(/zero objects after/i);
  });

  it('is deterministic — identical inputs yield an identical checksum', async () => {
    const a = await runIngest(deps());
    const b = await runIngest(deps());
    expect(a.manifest.checksum).toBe(b.manifest.checksum);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run scripts/ingest/ingest.test.ts
```

Expected: FAIL — cannot resolve `./ingest.ts`.

- [x] **Step 3: Write `scripts/ingest/ingest.ts`**

```ts
import { createHash } from 'node:crypto';
import { IngestError, type CatalogEntry, type Manifest } from '../../src/catalog/types.ts';
import { joinCatalog } from './join.ts';
import { parseGpResponse } from './parse-gp.ts';
import { parseSatcat } from './parse-satcat.ts';

export const GP_URL =
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json';
export const SATCAT_URL = 'https://celestrak.org/pub/satcat.csv';

export interface IngestDeps {
  fetchText(url: string): Promise<string>;
  now(): Date;
}

export interface IngestResult {
  catalog: CatalogEntry[];
  manifest: Manifest;
  catalogJson: string;
}

/**
 * Fetch, validate, join and trim the catalog. Performs no I/O directly —
 * all collaborators arrive through `deps`, which is what keeps this testable
 * without module mocking.
 */
export async function runIngest(deps: IngestDeps): Promise<IngestResult> {
  const [gpBody, satcatBody] = await Promise.all([
    deps.fetchText(GP_URL),
    deps.fetchText(SATCAT_URL),
  ]);

  const omm = parseGpResponse(gpBody);
  const satcat = parseSatcat(satcatBody);
  const catalog = joinCatalog(omm, satcat);

  if (catalog.length === 0) {
    throw new IngestError(
      `Catalog contained zero objects after joining ${omm.length} GP records ` +
      `against ${satcat.size} SATCAT rows. Refusing to emit an empty artifact.`,
    );
  }

  const catalogJson = JSON.stringify(catalog);
  const checksum = createHash('sha256').update(catalogJson).digest('hex');

  return {
    catalog,
    catalogJson,
    manifest: {
      generatedAt: deps.now().toISOString(),
      objectCount: catalog.length,
      source: GP_URL,
      checksum,
    },
  };
}
```

- [x] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run scripts/ingest/ingest.test.ts
```

Expected: 4 tests PASS.

- [x] **Step 5: Write the CLI entrypoint `scripts/ingest/run.ts`**

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIngest } from './ingest.ts';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/data');

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'apsis/0.1 (github.com/josh-W42/apsis)' },
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status} ${res.statusText}`);
  return res.text();
}

const { catalogJson, manifest } = await runIngest({ fetchText, now: () => new Date() });

await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/catalog.json`, catalogJson);
await writeFile(`${OUT_DIR}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`wrote ${manifest.objectCount} objects, checksum ${manifest.checksum.slice(0, 12)}`);
```

Note the `User-Agent`. Celestrak asks callers to identify themselves; update the URL if the repo moves.

**Important:** artifacts are written only after `runIngest` resolves. If Celestrak serves a refusal, the throw happens before any write, so the previously committed artifact survives untouched. That is the "last good artifact" guarantee from the spec, and it is a consequence of ordering, not of error handling.

- [x] **Step 6: Run the real ingestion once** — ran; Celestrak returned 403 (rate limited). Artifact seeded from a same-day snapshot through the real `runIngest` path. CI performs the live fetch.

```bash
pnpm run ingest
```

Expected: `wrote <N> objects, checksum <hex>` with N in the region of 16,500.

If it prints a "not valid JSON" error mentioning *"GP data has not updated"*, that is Celestrak declining to re-serve unchanged data — the validation working as designed. Wait and retry, or test against a saved fixture.

- [x] **Step 7: Verify the artifact**

```bash
node -e "const c=require('./public/data/catalog.json');console.log('objects',c.length);console.log('sample',JSON.stringify(c[0]).slice(0,200))"
ls -lh public/data/
```

Expected: object count in the thousands; `catalog.json` a few MB.

- [x] **Step 8: Commit**

```bash
git add scripts/ingest/ingest.ts scripts/ingest/run.ts scripts/ingest/ingest.test.ts public/data/
git commit -m "feat(ingest): orchestration, CLI entrypoint, and first catalog artifact"
```

---

## Task 5: Scheduled ingestion workflow

**Files:**
- Create: `.github/workflows/ingest.yml`

**Interfaces:**
- Consumes: the `pnpm run ingest` script from Task 4
- Produces: a twice-daily commit of `public/data/` when the catalog changes

- [x] **Step 1: Write the workflow**

`.github/workflows/ingest.yml`:
```yaml
name: Ingest catalog

on:
  schedule:
    # 06:00 and 18:00 UTC. Elements update 1-8x/day per object; twice daily
    # keeps positions well inside the accuracy SGP4 itself supports.
    - cron: '0 6,18 * * *'
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: ingest
  cancel-in-progress: false

jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 6.11.0

      - uses: actions/setup-node@v4
        with:
          # Node >= 23 required: scripts/ingest/*.ts run via native type stripping.
          node-version: '24'
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Fetch and rebuild catalog
        id: ingest
        run: pnpm run ingest

      - name: Commit if the catalog changed
        run: |
          if git diff --quiet -- public/data; then
            echo "Catalog unchanged; nothing to commit."
            exit 0
          fi
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add public/data
          git commit -m "chore(data): refresh catalog $(date -u +%Y-%m-%dT%H:%MZ)"
          git push
```

Two deliberate choices:

- **`pnpm run ingest` is allowed to fail the job.** A Celestrak refusal throws before writing, so a failed run leaves the committed artifact intact. A red run is the correct signal; silently succeeding on stale data is not.
- **`concurrency` without `cancel-in-progress`** prevents two scheduled runs racing to push.

- [x] **Step 2: Validate the YAML parses**

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('.github/workflows/ingest.yml','utf8');if(!/on:\s/.test(s)||!/jobs:/.test(s))throw new Error('malformed');console.log('workflow present, keys look sane')"
```

Expected: `workflow present, keys look sane`.

- [x] **Step 3: Commit**

```bash
git add .github/workflows/ingest.yml
git commit -m "ci: twice-daily catalog ingestion workflow"
```

- [ ] **Step 4: After pushing, trigger the workflow manually once** — BLOCKED: no GitHub remote yet

```bash
gh workflow run "Ingest catalog"
```

Expected: a successful run. If Node cannot execute the `.ts` files, the runner's Node predates type stripping — either raise `node-version` or add `tsx` and change the `ingest` script to `tsx scripts/ingest/run.ts`.

---

## Task 6: Propagation core

This is the heart of phase 1. It is an **integration test by design** — it exercises the real satellite.js WASM path, because that is the thing that can be wired up wrong. Dependency injection is applied where a seam earns it (Task 7's Worker boundary), not here, where the only sensible collaborator is the real library.

**Files:**
- Create: `src/propagation/core.ts`
- Test: `src/propagation/core.test.ts`

**Interfaces:**
- Consumes: `CatalogEntry` from `src/catalog/types.ts`
- Produces:
  - `interface PropagationFrame { positions: Float64Array; velocities: Float64Array; epochMs: number }`
  - `interface PropagationCore { readonly count: number; readonly liveIndices: Uint32Array; tick(date: Date): PropagationFrame; dispose(): void }`
  - `createPropagationCore(catalog: CatalogEntry[]): Promise<PropagationCore>`

`positions` and `velocities` are packed `[x0,y0,z0,x1,y1,z1,...]` in kilometres and km/s, ECI, indexed by catalog position. `liveIndices` lists only satellites whose SGP4 error byte was zero on the first tick — the render set.

- [x] **Step 1: Write the failing test**

`src/propagation/core.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { json2satrec, propagate } from 'satellite.js';
import { createPropagationCore } from './core.ts';
import type { CatalogEntry, OmmRecord } from '../catalog/types.ts';

// Two real objects with stable elements. ISS is LEO; a GEO object exercises
// a different SGP4 regime.
const ISS: OmmRecord = {
  OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', NORAD_CAT_ID: 25544,
  EPOCH: '2026-09-19T12:00:00.000000', MEAN_MOTION: 15.50103472,
  ECCENTRICITY: 0.0004364, INCLINATION: 51.6412, RA_OF_ASC_NODE: 247.4627,
  ARG_OF_PERICENTER: 130.5360, MEAN_ANOMALY: 325.0288, BSTAR: 0.00023844,
  MEAN_MOTION_DOT: 0.00012353, MEAN_MOTION_DDOT: 0, EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: 'U', ELEMENT_SET_NO: 999, REV_AT_EPOCH: 40000,
};
const GEO: OmmRecord = {
  ...ISS, OBJECT_NAME: 'GEO TEST', OBJECT_ID: '2000-001A', NORAD_CAT_ID: 26000,
  MEAN_MOTION: 1.00270000, ECCENTRICITY: 0.0001, INCLINATION: 0.05,
  MEAN_MOTION_DOT: 0,
};

const entry = (omm: OmmRecord): CatalogEntry => ({
  omm,
  meta: { objectType: null, owner: null, launchDate: null, apogeeKm: null, perigeeKm: null },
});

const CATALOG = [entry(ISS), entry(GEO)];
const AT = new Date('2026-09-19T13:30:00.000Z');

describe('createPropagationCore', () => {
  it('reports one entry per catalog record', async () => {
    const core = await createPropagationCore(CATALOG);
    expect(core.count).toBe(2);
    core.dispose();
  });

  it('matches a direct satellite.js propagate() call — pipeline fidelity', async () => {
    const core = await createPropagationCore(CATALOG);
    const frame = core.tick(AT);

    for (let i = 0; i < CATALOG.length; i++) {
      const direct = propagate(json2satrec(CATALOG[i]!.omm), AT);
      expect(direct.position, 'reference propagation should succeed').toBeTruthy();
      const p = direct.position as { x: number; y: number; z: number };

      // WASM and the JS port derive from the same Vallado reference; they
      // should agree far more tightly than 1 m. Relax only with a reason.
      expect(frame.positions[i * 3 + 0]!).toBeCloseTo(p.x, 3);
      expect(frame.positions[i * 3 + 1]!).toBeCloseTo(p.y, 3);
      expect(frame.positions[i * 3 + 2]!).toBeCloseTo(p.z, 3);
    }
    core.dispose();
  });

  it('returns velocities consistent with a finite difference of positions', async () => {
    const core = await createPropagationCore(CATALOG);
    const dt = 1;
    const a = core.tick(AT);
    const vx = a.velocities[0]!, vy = a.velocities[1]!, vz = a.velocities[2]!;
    const ax = a.positions[0]!, ay = a.positions[1]!, az = a.positions[2]!;
    const b = core.tick(new Date(AT.getTime() + dt * 1000));

    // Over 1 s a LEO chord is within ~1 m of the velocity-scaled step.
    expect(b.positions[0]!).toBeCloseTo(ax + vx * dt, 2);
    expect(b.positions[1]!).toBeCloseTo(ay + vy * dt, 2);
    expect(b.positions[2]!).toBeCloseTo(az + vz * dt, 2);
    core.dispose();
  });

  it('excludes satellites with a non-zero SGP4 error from liveIndices', async () => {
    // Mean motion of 0 is not physically propagable; SGP4 must flag it.
    const broken = entry({ ...ISS, NORAD_CAT_ID: 99999, MEAN_MOTION: 0, ECCENTRICITY: 0.99 });
    const core = await createPropagationCore([...CATALOG, broken]);
    core.tick(AT);
    expect(core.count).toBe(3);
    expect(Array.from(core.liveIndices)).not.toContain(2);
    expect(Array.from(core.liveIndices)).toEqual(expect.arrayContaining([0, 1]));
    core.dispose();
  });

  it('stamps the frame with the requested epoch', async () => {
    const core = await createPropagationCore(CATALOG);
    expect(core.tick(AT).epochMs).toBe(AT.getTime());
    core.dispose();
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run src/propagation/core.test.ts
```

Expected: FAIL — cannot resolve `./core.ts`.

- [x] **Step 3: Write `src/propagation/core.ts`**

```ts
import {
  BulkPropagator,
  EciBaseCalculator,
  createSingleThreadRuntime,
  json2satrec,
} from 'satellite.js';
import type { CatalogEntry } from '../catalog/types.ts';

export interface PropagationFrame {
  /** ECI km, packed [x0,y0,z0,x1,y1,z1,...], indexed by catalog position. */
  positions: Float64Array;
  /** ECI km/s, same packing. */
  velocities: Float64Array;
  epochMs: number;
}

export interface PropagationCore {
  readonly count: number;
  /** Catalog indices whose SGP4 error byte was zero. Only these may render. */
  readonly liveIndices: Uint32Array;
  tick(date: Date): PropagationFrame;
  dispose(): void;
}

/**
 * Build SGP4 satrecs for the catalog and prepare a WASM bulk propagator.
 *
 * Uses the single-thread runtime deliberately: the pthreads build needs
 * SharedArrayBuffer and therefore COOP/COEP headers, and measurement showed
 * the single-thread path runs the full 16,578-object catalog in ~11 ms —
 * roughly 1% of a 1 Hz budget.
 *
 * Construction is the expensive part (~274 ms for the full catalog), which is
 * why this runs inside a Worker in production.
 */
export async function createPropagationCore(
  catalog: CatalogEntry[],
): Promise<PropagationCore> {
  const count = catalog.length;
  const satrecs = catalog.map((entry) => json2satrec(entry.omm));

  const runtime = await createSingleThreadRuntime();
  const propagator = new BulkPropagator({
    runtime,
    calculators: [new EciBaseCalculator()],
    satRecsCount: count,
    datesCount: 1,
  });
  propagator.setSatRecs(satrecs);

  let liveIndices = new Uint32Array(0);
  let computedLive = false;

  return {
    count,
    get liveIndices() {
      return liveIndices;
    },
    tick(date: Date): PropagationFrame {
      propagator.setDates([date]);
      // communityDecayCheckEnabled reports long-decayed objects as Decayed
      // instead of propagating them to meaningless positions.
      propagator.run({ eci: { communityDecayCheckEnabled: true } });
      const out = propagator.getRawOutput().eci;

      if (!computedLive) {
        const live: number[] = [];
        for (let i = 0; i < count; i++) {
          if (out.error[i] === 0) live.push(i);
        }
        liveIndices = Uint32Array.from(live);
        computedLive = true;
      }

      return {
        positions: out.position,
        velocities: out.velocity,
        epochMs: date.getTime(),
      };
    },
    dispose() {
      // Only the propagator — never the runtime. See the note above.
      propagator.dispose();
    },
  };
}
```

**Note on runtime lifetime — a real trap, found during implementation:**
`runtime.dispose()` calls emscripten's `_exit_runtime()`, which tears the WASM
module down *process-wide and permanently*. Any later
`createSingleThreadRuntime()` throws `ExitStatus`. Because React StrictMode
double-invokes effects in development, a core that disposed its own runtime
would kill the page on the second mount. The runtime is therefore created once,
cached at module scope, and never disposed; only the `BulkPropagator` is.

**Note on buffer ownership:** `getRawOutput()` returns views into WASM memory that are **overwritten by the next `run()`**. Callers must copy before the next tick. Task 7 does exactly that when posting across the Worker boundary.

- [x] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run src/propagation/core.test.ts
```

Expected: 5 tests PASS. If the fidelity test fails by a large margin, the satrec inputs are being corrupted — check the trim in Task 3, not the tolerance.

- [x] **Step 5: Commit**

```bash
git add src/propagation/core.ts src/propagation/core.test.ts
git commit -m "feat(propagation): WASM bulk propagation core with error filtering"
```

---

## Task 7: Interpolation and sun-direction math

Pure functions, no Three.js, no WebGL. These are the only places in the render path where wrong output is silent rather than obvious, so they get real tests. `hermite` is additionally the **reference implementation for the GLSL port in Task 10** — the shader must reproduce it.

**Files:**
- Create: `src/math/hermite.ts`, `src/math/sun.ts`
- Test: `src/math/hermite.test.ts`, `src/math/sun.test.ts`

**Interfaces:**
- Produces:
  - `hermite(p0: number, v0: number, p1: number, v1: number, s: number, h: number): number`
  - `sunDirectionEci(date: Date): { x: number; y: number; z: number }` — unit vector

- [x] **Step 1: Write the failing tests**

`src/math/hermite.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { json2satrec, propagate } from 'satellite.js';
import { hermite } from './hermite.ts';
import type { OmmRecord } from '../catalog/types.ts';

const ISS: OmmRecord = {
  OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', NORAD_CAT_ID: 25544,
  EPOCH: '2026-09-19T12:00:00.000000', MEAN_MOTION: 15.50103472,
  ECCENTRICITY: 0.0004364, INCLINATION: 51.6412, RA_OF_ASC_NODE: 247.4627,
  ARG_OF_PERICENTER: 130.5360, MEAN_ANOMALY: 325.0288, BSTAR: 0.00023844,
  MEAN_MOTION_DOT: 0.00012353, MEAN_MOTION_DDOT: 0, EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: 'U', ELEMENT_SET_NO: 999, REV_AT_EPOCH: 40000,
};

describe('hermite', () => {
  it('reproduces the endpoints exactly', () => {
    expect(hermite(10, 2, 20, 3, 0, 1)).toBeCloseTo(10, 10);
    expect(hermite(10, 2, 20, 3, 1, 1)).toBeCloseTo(20, 10);
  });

  it('honours the endpoint tangents', () => {
    // With matching endpoints and equal tangents, the curve is the straight
    // line implied by that slope.
    expect(hermite(0, 1, 1, 1, 0.5, 1)).toBeCloseTo(0.5, 10);
  });

  it('is exact for a cubic, which linear interpolation is not', () => {
    const f = (t: number) => 2 * t ** 3 - t ** 2 + 3 * t + 1;
    const df = (t: number) => 6 * t ** 2 - 2 * t + 3;
    const [t0, t1] = [1, 3];
    const h = t1 - t0;
    for (const s of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(hermite(f(t0), df(t0), f(t1), df(t1), s, h))
        .toBeCloseTo(f(t0 + s * h), 8);
    }
  });

  it('tracks a real LEO orbit to within 10 m across a 1 s tick', () => {
    const rec = json2satrec(ISS);
    const t0 = new Date('2026-09-19T13:30:00.000Z');
    const t1 = new Date(t0.getTime() + 1000);
    const mid = new Date(t0.getTime() + 500);

    const a = propagate(rec, t0), b = propagate(rec, t1), m = propagate(rec, mid);
    const pa = a.position as { x: number; y: number; z: number };
    const va = a.velocity as { x: number; y: number; z: number };
    const pb = b.position as { x: number; y: number; z: number };
    const vb = b.velocity as { x: number; y: number; z: number };
    const pm = m.position as { x: number; y: number; z: number };

    for (const axis of ['x', 'y', 'z'] as const) {
      const got = hermite(pa[axis], va[axis], pb[axis], vb[axis], 0.5, 1);
      expect(Math.abs(got - pm[axis])).toBeLessThan(0.01); // km == 10 m
    }
  });

  it('beats linear interpolation on a 10 s tick, where linear degrades badly', () => {
    const rec = json2satrec(ISS);
    const t0 = new Date('2026-09-19T13:30:00.000Z');
    const t1 = new Date(t0.getTime() + 10_000);
    const mid = new Date(t0.getTime() + 5_000);
    const a = propagate(rec, t0), b = propagate(rec, t1), m = propagate(rec, mid);
    const pa = a.position as { x: number }, va = a.velocity as { x: number };
    const pb = b.position as { x: number }, vb = b.velocity as { x: number };
    const pm = m.position as { x: number };

    const linear = pa.x + (pb.x - pa.x) * 0.5;
    const cubic = hermite(pa.x, va.x, pb.x, vb.x, 0.5, 10);
    expect(Math.abs(cubic - pm.x)).toBeLessThan(Math.abs(linear - pm.x));
  });
});
```

`src/math/sun.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { sunDirectionEci } from './sun.ts';

describe('sunDirectionEci', () => {
  it('returns a unit vector', () => {
    const d = sunDirectionEci(new Date('2026-09-19T12:00:00Z'));
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
  });

  it('puts the sun near the equatorial plane at the September equinox', () => {
    // Around 22 Sep the sun's declination passes through 0.
    const d = sunDirectionEci(new Date('2026-09-22T12:00:00Z'));
    const declDeg = Math.asin(d.z) * (180 / Math.PI);
    expect(Math.abs(declDeg)).toBeLessThan(1.5);
  });

  it('puts the sun far south at the December solstice', () => {
    const d = sunDirectionEci(new Date('2026-12-21T12:00:00Z'));
    const declDeg = Math.asin(d.z) * (180 / Math.PI);
    expect(declDeg).toBeLessThan(-22);
  });

  it('sweeps roughly one degree per day', () => {
    const a = sunDirectionEci(new Date('2026-09-19T12:00:00Z'));
    const b = sunDirectionEci(new Date('2026-09-20T12:00:00Z'));
    const dot = a.x * b.x + a.y * b.y + a.z * b.z;
    const deg = Math.acos(Math.min(1, dot)) * (180 / Math.PI);
    expect(deg).toBeGreaterThan(0.8);
    expect(deg).toBeLessThan(1.2);
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
pnpm exec vitest run src/math
```

Expected: FAIL — modules not found.

- [x] **Step 3: Write `src/math/hermite.ts`**

```ts
/**
 * Cubic Hermite interpolation on one axis.
 *
 * This is the reference implementation for the GLSL port in
 * `src/render/satellites.ts`. Keep the two in step.
 *
 * @param p0 value at the start of the interval
 * @param v0 derivative at the start, per unit of the interval's own time units
 * @param p1 value at the end
 * @param v1 derivative at the end
 * @param s  normalised position in the interval, 0..1
 * @param h  interval width in the same time units as v0/v1
 */
export function hermite(
  p0: number, v0: number, p1: number, v1: number, s: number, h: number,
): number {
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return h00 * p0 + h10 * h * v0 + h01 * p1 + h11 * h * v1;
}
```

- [x] **Step 4: Write `src/math/sun.ts`**

```ts
import { jday, sunPos } from 'satellite.js';

/**
 * Unit vector from Earth to the Sun in the ECI frame.
 *
 * `sunPos` returns a geocentric position in AU whose magnitude varies with
 * Earth's orbital distance (~0.983 to ~1.017 AU), so it must be normalised
 * before use as a light direction.
 */
export function sunDirectionEci(date: Date): { x: number; y: number; z: number } {
  const { rsun } = sunPos(jday(date));
  const m = Math.hypot(rsun.x, rsun.y, rsun.z);
  return { x: rsun.x / m, y: rsun.y / m, z: rsun.z / m };
}
```

- [x] **Step 5: Run the tests to verify they pass**

```bash
pnpm exec vitest run src/math
```

Expected: 9 tests PASS.

- [x] **Step 6: Commit**

```bash
git add src/math
git commit -m "feat(math): cubic hermite interpolation and ECI sun direction"
```

---

## Task 8: Propagation worker and main-thread client

The Worker exists to keep the ~274 ms satrec construction and the 11 ms tick off the main thread — not because propagation needs parallelism.

**Files:**
- Create: `src/propagation/protocol.ts`, `src/propagation/worker.ts`, `src/propagation/client.ts`
- Test: `src/propagation/client.test.ts`

**Interfaces:**
- Consumes: `createPropagationCore`, `PropagationFrame`
- Produces:
  - `type WorkerRequest = { type: 'init'; catalogUrl: string } | { type: 'tick'; epochMs: number }`
  - `type WorkerResponse = { type: 'ready'; count: number; liveIndices: Uint32Array } | { type: 'frame'; positions: Float32Array; velocities: Float32Array; epochMs: number } | { type: 'error'; message: string }`
  - `interface WorkerLike { postMessage(m: unknown, transfer?: Transferable[]): void; addEventListener(t: 'message', h: (e: MessageEvent) => void): void; terminate(): void }`
  - `createPropagationClient(worker: WorkerLike): PropagationClient`

The Worker is **injected** into the client, which is what makes the client testable in Node without `vi.mock` or a real `Worker`.

Positions cross the boundary as `Float32Array`, downcast from the core's `Float64Array`. At LEO radii (~7,000 km) Float32 resolves to about 1 m, far below what is visible on screen, and it halves both the copy and the GPU upload. The copy is mandatory regardless: `getRawOutput()` views are overwritten by the next `run()`.

- [x] **Step 1: Write the failing test**

`src/propagation/client.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { createPropagationClient, type WorkerLike } from './client.ts';
import type { WorkerResponse } from './protocol.ts';

/** A hand-written fake, injected — no module mocking. */
function fakeWorker() {
  const handlers: ((e: MessageEvent) => void)[] = [];
  const sent: unknown[] = [];
  const worker: WorkerLike = {
    postMessage: (m) => { sent.push(m); },
    addEventListener: (_t, h) => { handlers.push(h); },
    terminate: () => { sent.push({ type: 'terminated' }); },
  };
  const emit = (data: WorkerResponse) =>
    handlers.forEach((h) => h({ data } as MessageEvent));
  return { worker, sent, emit };
}

describe('createPropagationClient', () => {
  it('sends an init request with the catalog url', async () => {
    const { worker, sent, emit } = fakeWorker();
    const client = createPropagationClient(worker);
    const ready = client.init('/data/catalog.json');
    expect(sent[0]).toEqual({ type: 'init', catalogUrl: '/data/catalog.json' });

    emit({ type: 'ready', count: 3, liveIndices: Uint32Array.from([0, 2]) });
    await expect(ready).resolves.toEqual({ count: 3, liveIndices: Uint32Array.from([0, 2]) });
  });

  it('rejects init when the worker reports an error', async () => {
    const { worker, emit } = fakeWorker();
    const client = createPropagationClient(worker);
    const ready = client.init('/data/catalog.json');
    emit({ type: 'error', message: 'catalog 404' });
    await expect(ready).rejects.toThrow(/catalog 404/);
  });

  it('delivers frames to the registered listener', () => {
    const { worker, emit } = fakeWorker();
    const client = createPropagationClient(worker);
    const onFrame = vi.fn();
    client.onFrame(onFrame);

    const frame = {
      type: 'frame' as const,
      positions: Float32Array.from([1, 2, 3]),
      velocities: Float32Array.from([4, 5, 6]),
      epochMs: 1_000,
    };
    emit(frame);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame.mock.calls[0]![0].epochMs).toBe(1_000);
    expect(Array.from(onFrame.mock.calls[0]![0].positions)).toEqual([1, 2, 3]);
  });

  it('requests a tick for the given epoch', () => {
    const { worker, sent } = fakeWorker();
    createPropagationClient(worker).tick(new Date(1_700_000_000_000));
    expect(sent[0]).toEqual({ type: 'tick', epochMs: 1_700_000_000_000 });
  });

  it('terminates the worker on dispose', () => {
    const { worker, sent } = fakeWorker();
    createPropagationClient(worker).dispose();
    expect(sent).toContainEqual({ type: 'terminated' });
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run src/propagation/client.test.ts
```

Expected: FAIL — cannot resolve `./client.ts`.

- [x] **Step 3: Write `src/propagation/protocol.ts`**

```ts
export type WorkerRequest =
  | { type: 'init'; catalogUrl: string }
  | { type: 'tick'; epochMs: number };

export type WorkerResponse =
  | { type: 'ready'; count: number; liveIndices: Uint32Array }
  | { type: 'frame'; positions: Float32Array; velocities: Float32Array; epochMs: number }
  | { type: 'error'; message: string };
```

- [x] **Step 4: Write `src/propagation/client.ts`**

```ts
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', handler: (event: MessageEvent) => void): void;
  terminate(): void;
}

export interface ReadyInfo {
  count: number;
  liveIndices: Uint32Array;
}

export interface Frame {
  positions: Float32Array;
  velocities: Float32Array;
  epochMs: number;
}

export interface PropagationClient {
  init(catalogUrl: string): Promise<ReadyInfo>;
  tick(date: Date): void;
  onFrame(listener: (frame: Frame) => void): void;
  dispose(): void;
}

/**
 * Main-thread wrapper around the propagation worker.
 *
 * The worker is injected rather than constructed here so this module can be
 * tested with a hand-written fake, per the project's no-`vi.mock` constraint.
 */
export function createPropagationClient(worker: WorkerLike): PropagationClient {
  let resolveReady: ((info: ReadyInfo) => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  const frameListeners: ((frame: Frame) => void)[] = [];

  worker.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as WorkerResponse;
    switch (message.type) {
      case 'ready':
        resolveReady?.({ count: message.count, liveIndices: message.liveIndices });
        break;
      case 'frame':
        for (const listener of frameListeners) {
          listener({
            positions: message.positions,
            velocities: message.velocities,
            epochMs: message.epochMs,
          });
        }
        break;
      case 'error':
        // An error before ready rejects init; after ready it surfaces on the
        // console, because a single bad tick must not tear down the globe.
        if (rejectReady) rejectReady(new Error(message.message));
        else console.error('[propagation]', message.message);
        break;
    }
  });

  const send = (request: WorkerRequest) => worker.postMessage(request);

  return {
    init(catalogUrl) {
      const promise = new Promise<ReadyInfo>((resolve, reject) => {
        resolveReady = (info) => { resolveReady = undefined; rejectReady = undefined; resolve(info); };
        rejectReady = (error) => { resolveReady = undefined; rejectReady = undefined; reject(error); };
      });
      send({ type: 'init', catalogUrl });
      return promise;
    },
    tick(date) { send({ type: 'tick', epochMs: date.getTime() }); },
    onFrame(listener) { frameListeners.push(listener); },
    dispose() { worker.terminate(); },
  };
}
```

- [x] **Step 5: Run the test to verify it passes**

```bash
pnpm exec vitest run src/propagation/client.test.ts
```

Expected: 5 tests PASS.

- [x] **Step 6: Write `src/propagation/worker.ts`**

```ts
/// <reference lib="webworker" />
import type { CatalogEntry } from '../catalog/types.ts';
import { createPropagationCore, type PropagationCore } from './core.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

let core: PropagationCore | undefined;

const post = (message: WorkerResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(message, transfer);

/** Downcast to Float32 and copy — WASM output views are reused next tick. */
function toFloat32(source: Float64Array): Float32Array {
  const out = new Float32Array(source.length);
  for (let i = 0; i < source.length; i++) out[i] = source[i]!;
  return out;
}

self.addEventListener('message', async (event: MessageEvent) => {
  const request = event.data as WorkerRequest;
  try {
    if (request.type === 'init') {
      const response = await fetch(request.catalogUrl);
      if (!response.ok) {
        throw new Error(`catalog fetch failed: ${response.status} ${response.statusText}`);
      }
      const catalog = (await response.json()) as CatalogEntry[];
      if (!Array.isArray(catalog) || catalog.length === 0) {
        throw new Error('catalog artifact was empty or malformed');
      }
      core = await createPropagationCore(catalog);
      // Prime once so liveIndices is populated before the first render.
      core.tick(new Date());
      post({ type: 'ready', count: core.count, liveIndices: core.liveIndices });
      return;
    }

    if (request.type === 'tick') {
      if (!core) throw new Error('tick before init');
      const frame = core.tick(new Date(request.epochMs));
      const positions = toFloat32(frame.positions);
      const velocities = toFloat32(frame.velocities);
      post(
        { type: 'frame', positions, velocities, epochMs: frame.epochMs },
        [positions.buffer, velocities.buffer],
      );
    }
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
});
```

- [x] **Step 7: Typecheck**

```bash
pnpm run typecheck
```

Expected: no errors.

- [x] **Step 8: Commit**

```bash
git add src/propagation/protocol.ts src/propagation/worker.ts src/propagation/client.ts src/propagation/client.test.ts
git commit -m "feat(propagation): worker shell and injectable main-thread client"
```

---

## Task 9: Three.js scene and Earth

**Files:**
- Create: `src/render/scene.ts`, `src/render/earth.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `sunDirectionEci` from `src/math/sun.ts`
- Produces:
  - `const EARTH_RADIUS_KM = 6371`
  - `const SCENE_SCALE = 1 / EARTH_RADIUS_KM` — scene units are Earth radii
  - `createScene(container: HTMLElement): SceneHandle`
  - `interface SceneHandle { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; setSunDirection(d: {x,y,z}): void; onFrame(cb: (dtMs: number) => void): void; dispose(): void }`

No tests here beyond typecheck: Three.js needs a real GPU and cannot render under jsdom. The logic worth testing was already extracted into `src/math/` in Task 7. Verification is visual, in the browser, in Step 5.

- [x] **Step 1: Write `src/render/earth.ts`**

```ts
import * as THREE from 'three';

export const EARTH_RADIUS_KM = 6371;
/** Scene units are Earth radii: keeps depth precision sane at GEO distances. */
export const SCENE_SCALE = 1 / EARTH_RADIUS_KM;

export interface EarthHandle {
  group: THREE.Group;
  setSunDirection(d: { x: number; y: number; z: number }): void;
}

/**
 * Earth sphere plus an atmospheric limb shell.
 *
 * Ships untextured: lighting alone establishes a correct, moving terminator,
 * and the task is not blocked on sourcing imagery. Textures are added in
 * Step 4 once the geometry and lighting are confirmed correct.
 */
export function createEarth(): EarthHandle {
  const group = new THREE.Group();
  const sunDirection = new THREE.Vector3(1, 0, 0);

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(1, 128, 64),
    new THREE.MeshStandardMaterial({ color: 0x1b3a5c, roughness: 0.85, metalness: 0.0 }),
  );
  group.add(globe);

  // Back-faced shell for the limb glow: an analytic stand-in for Rayleigh
  // scattering. Fragment intensity rises as the view grazes the surface.
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.025, 128, 64),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uSunDirection: { value: sunDirection } },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vWorld  = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDirection;
        varying vec3 vNormal;
        varying vec3 vWorld;
        void main() {
          float rim = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 3.0);
          float lit = clamp(dot(vWorld, normalize(uSunDirection)) + 0.35, 0.0, 1.0);
          gl_FragColor = vec4(vec3(0.30, 0.55, 1.0) * rim * lit, rim * lit);
        }
      `,
    }),
  );
  group.add(atmosphere);

  const sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
  group.add(sunLight);
  group.add(new THREE.AmbientLight(0x2a3550, 0.6));

  return {
    group,
    setSunDirection(d) {
      sunDirection.set(d.x, d.y, d.z).normalize();
      sunLight.position.copy(sunDirection).multiplyScalar(10);
    },
  };
}
```

- [x] **Step 2: Write `src/render/scene.ts`**

```ts
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEarth } from './earth.ts';

export interface SceneHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  setSunDirection(d: { x: number; y: number; z: number }): void;
  onFrame(callback: (dtMs: number) => void): void;
  dispose(): void;
}

export function createScene(container: HTMLElement): SceneHandle {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(
    45, container.clientWidth / container.clientHeight, 0.01, 1000,
  );
  camera.position.set(0, 1.2, 3.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(0x05070d, 1);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.15;
  controls.maxDistance = 60;

  const earth = createEarth();
  scene.add(earth.group);

  const callbacks: ((dtMs: number) => void)[] = [];
  let last = performance.now();
  let running = true;

  const loop = () => {
    if (!running) return;
    requestAnimationFrame(loop);
    const now = performance.now();
    const dtMs = now - last;
    last = now;
    for (const cb of callbacks) cb(dtMs);
    controls.update();
    renderer.render(scene, camera);
  };
  requestAnimationFrame(loop);

  const onResize = () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener('resize', onResize);

  // A lost context leaves a frozen canvas unless it is explicitly restored.
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    console.warn('[render] WebGL context lost');
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    console.warn('[render] WebGL context restored');
  });

  return {
    scene, camera, renderer,
    setSunDirection: earth.setSunDirection,
    onFrame(callback) { callbacks.push(callback); },
    dispose() {
      running = false;
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
```

- [x] **Step 3: Wire it into `src/App.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { sunDirectionEci } from './math/sun.ts';
import { createScene } from './render/scene.ts';

export function App() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    let handle: ReturnType<typeof createScene>;
    try {
      handle = createScene(container);
    } catch (error) {
      container.textContent =
        'This page needs WebGL2, which this browser did not provide.';
      console.error(error);
      return;
    }

    handle.setSunDirection(sunDirectionEci(new Date()));
    const sunTimer = setInterval(
      () => handle.setSunDirection(sunDirectionEci(new Date())), 60_000,
    );

    return () => { clearInterval(sunTimer); handle.dispose(); };
  }, []);

  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}
```

- [x] **Step 4: Verify in the browser**

```bash
pnpm run dev
```

Expected: a dark page with a lit blue sphere and a blue limb glow; dragging orbits it, scrolling zooms. The lit hemisphere must face the real sun direction — at 12:00 UTC the sub-solar point is near the Greenwich meridian.

- [x] **Step 5: Typecheck and commit**

```bash
ppnpm run typecheck && ppnpm test
```

```bash
git add src/render src/App.tsx
git commit -m "feat(render): three.js scene, earth sphere, atmosphere, sun lighting"
```

**Deferred within this task — Earth textures.** Source colour, night-lights and roughness maps from NASA Visible Earth (Blue Marble and Black Marble; public domain). Verify the exact download URLs at implementation time rather than trusting a remembered link. Place them in `public/textures/`, load a 2k set first and swap in 4k after first paint, and keep the untextured material as the fallback if a texture fails to load. An 8k set is tens of megabytes and would undo the fast-first-paint work.

---

## Task 10: Satellite points and the Hermite vertex shader

One `THREE.Points`, one draw call, one `ShaderMaterial`. The vertex shader is the GLSL port of `hermite()` from Task 7 — **keep the two in step.**

**Files:**
- Create: `src/render/satellites.ts`
- Test: `src/render/gather.test.ts`

**Interfaces:**
- Consumes: `SCENE_SCALE` from `src/render/earth.ts`; `Frame` from `src/propagation/client.ts`
- Produces:
  - `gatherLive(source: Float32Array, liveIndices: Uint32Array, target: Float32Array): void`
  - `createSatellites(liveIndices: Uint32Array): SatellitesHandle`
  - `interface SatellitesHandle { points: THREE.Points; pushFrame(f: Frame): void; setAlpha(a: number): void; dispose(): void }`

`gatherLive` is extracted and tested because an off-by-one in the gather would show as satellites in plausible-but-wrong places — the exact class of bug that is invisible on screen.

- [x] **Step 1: Write the failing test**

`src/render/gather.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { gatherLive } from './satellites.ts';

describe('gatherLive', () => {
  it('compacts the selected satellites into the target, preserving xyz order', () => {
    // three satellites, indices 0..2
    const source = Float32Array.from([
      1, 2, 3,
      4, 5, 6,
      7, 8, 9,
    ]);
    const target = new Float32Array(6);
    gatherLive(source, Uint32Array.from([0, 2]), target);
    expect(Array.from(target)).toEqual([1, 2, 3, 7, 8, 9]);
  });

  it('handles a single live satellite at the end of the source', () => {
    const source = Float32Array.from([1, 1, 1, 2, 2, 2, 3, 3, 3]);
    const target = new Float32Array(3);
    gatherLive(source, Uint32Array.from([2]), target);
    expect(Array.from(target)).toEqual([3, 3, 3]);
  });

  it('is identity when every satellite is live', () => {
    const source = Float32Array.from([1, 2, 3, 4, 5, 6]);
    const target = new Float32Array(6);
    gatherLive(source, Uint32Array.from([0, 1]), target);
    expect(Array.from(target)).toEqual(Array.from(source));
  });

  it('writes nothing when no satellite is live', () => {
    const target = new Float32Array(3).fill(-1);
    gatherLive(Float32Array.from([1, 2, 3]), new Uint32Array(0), target);
    expect(Array.from(target)).toEqual([-1, -1, -1]);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run src/render/gather.test.ts
```

Expected: FAIL — cannot resolve `./satellites.ts`.

- [x] **Step 3: Write `src/render/satellites.ts`**

```ts
import * as THREE from 'three';
import type { Frame } from '../propagation/client.ts';
import { SCENE_SCALE } from './earth.ts';

/** Tick interval the shader interpolates across, in seconds. */
export const TICK_SECONDS = 1;

/**
 * Compact the full-catalog array down to just the renderable satellites.
 *
 * `source` is packed [x,y,z] per catalog index; `target` is packed [x,y,z]
 * per live index, in `liveIndices` order.
 */
export function gatherLive(
  source: Float32Array, liveIndices: Uint32Array, target: Float32Array,
): void {
  for (let j = 0; j < liveIndices.length; j++) {
    const i = liveIndices[j]!;
    target[j * 3 + 0] = source[i * 3 + 0]!;
    target[j * 3 + 1] = source[i * 3 + 1]!;
    target[j * 3 + 2] = source[i * 3 + 2]!;
  }
}

export interface SatellitesHandle {
  points: THREE.Points;
  /** Promote the pending frame to current and accept a new pending frame. */
  pushFrame(frame: Frame): void;
  /** Interpolation position between the two held frames, 0..1. */
  setAlpha(alpha: number): void;
  dispose(): void;
}

const vertexShader = /* glsl */ `
  attribute vec3 velA;
  attribute vec3 posB;
  attribute vec3 velB;

  uniform float uAlpha;      // 0..1 between the two frames
  uniform float uH;          // frame interval, seconds
  uniform float uScale;      // km -> scene units
  uniform float uPointSize;

  void main() {
    // Cubic Hermite. Mirrors hermite() in src/math/hermite.ts.
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
    // Attenuate with distance, but keep distant GEO objects visible.
    gl_PointSize = clamp(uPointSize / max(-mv.z, 0.001), 1.0, 5.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    // Round, soft-edged point.
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = dot(d, d);
    if (r > 0.25) discard;
    gl_FragColor = vec4(uColor, smoothstep(0.25, 0.0, r));
  }
`;

/**
 * Build the satellite point cloud.
 *
 * `position` doubles as the "A" endpoint of the Hermite segment, since
 * three.js requires that attribute anyway.
 */
export function createSatellites(liveIndices: Uint32Array): SatellitesHandle {
  const n = liveIndices.length;

  const posA = new Float32Array(n * 3);
  const velA = new Float32Array(n * 3);
  const posB = new Float32Array(n * 3);
  const velB = new Float32Array(n * 3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(posA, 3));
  geometry.setAttribute('velA', new THREE.BufferAttribute(velA, 3));
  geometry.setAttribute('posB', new THREE.BufferAttribute(posB, 3));
  geometry.setAttribute('velB', new THREE.BufferAttribute(velB, 3));
  // Points are scattered worldwide; a sphere of 12 Earth radii covers GEO.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12);

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uAlpha: { value: 0 },
      uH: { value: TICK_SECONDS },
      uScale: { value: SCENE_SCALE },
      uPointSize: { value: 260 },
      uColor: { value: new THREE.Color(0x8fd6ff) },
    },
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  let hasFirstFrame = false;

  return {
    points,
    pushFrame(frame) {
      // Current B becomes the new A, then B takes the incoming frame.
      posA.set(posB);
      velA.set(velB);
      gatherLive(frame.positions, liveIndices, posB);
      gatherLive(frame.velocities, liveIndices, velB);

      // On the very first frame there is no prior state to slide from, so
      // collapse the segment to a point and avoid a visible sweep from zero.
      if (!hasFirstFrame) {
        posA.set(posB);
        velA.set(velB);
        hasFirstFrame = true;
      }

      geometry.getAttribute('position').needsUpdate = true;
      geometry.getAttribute('velA').needsUpdate = true;
      geometry.getAttribute('posB').needsUpdate = true;
      geometry.getAttribute('velB').needsUpdate = true;
    },
    setAlpha(alpha) {
      material.uniforms.uAlpha!.value = Math.min(1, Math.max(0, alpha));
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
```

- [x] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run src/render/gather.test.ts
```

Expected: 4 tests PASS.

- [x] **Step 5: Commit**

```bash
git add src/render/satellites.ts src/render/gather.test.ts
git commit -m "feat(render): instanced satellite points with hermite vertex shader"
```

---

## Task 11: Integration and browser verification

**Files:**
- Create: `src/globe.ts`
- Modify: `src/App.tsx`
- Create: `public/_headers`

**Interfaces:**
- Consumes: everything from Tasks 6-10
- Produces: `startGlobe(container: HTMLElement): Promise<() => void>` — resolves to a teardown function

**The tick scheduling, which is the one non-obvious piece:** frames are requested for epochs **one interval in the future**. SGP4 is deterministic, so computing ahead costs nothing and means the shader always interpolates between two frames it already holds, rather than extrapolating past the newest one. At wall time *t* the client holds frames for *t* and *t+1s*, and `alpha` walks from 0 to 1 across that second.

- [x] **Step 1: Write `src/globe.ts`**

```ts
import { createPropagationClient, type Frame } from './propagation/client.ts';
import { sunDirectionEci } from './math/sun.ts';
import { createScene } from './render/scene.ts';
import { createSatellites, TICK_SECONDS } from './render/satellites.ts';

const TICK_MS = TICK_SECONDS * 1000;

export async function startGlobe(container: HTMLElement): Promise<() => void> {
  const view = createScene(container);
  view.setSunDirection(sunDirectionEci(new Date()));

  const worker = new Worker(
    new URL('./propagation/worker.ts', import.meta.url), { type: 'module' },
  );
  const client = createPropagationClient(worker);

  const { count, liveIndices } = await client.init('/data/catalog.json');
  console.info(
    `[apsis] ${liveIndices.length} of ${count} objects renderable ` +
    `(${count - liveIndices.length} excluded by SGP4 error or decay)`,
  );

  const satellites = createSatellites(liveIndices);
  view.scene.add(satellites.points);

  // epochA/epochB bracket the interval the shader interpolates across.
  let epochA = 0;
  let epochB = 0;

  client.onFrame((frame: Frame) => {
    satellites.pushFrame(frame);
    epochA = epochB;
    epochB = frame.epochMs;
  });

  // Prime with the current instant and one interval ahead.
  const t0 = Math.floor(Date.now() / TICK_MS) * TICK_MS;
  client.tick(new Date(t0));
  client.tick(new Date(t0 + TICK_MS));

  let nextEpoch = t0 + 2 * TICK_MS;
  const tickTimer = setInterval(() => {
    client.tick(new Date(nextEpoch));
    nextEpoch += TICK_MS;
  }, TICK_MS);

  const sunTimer = setInterval(
    () => view.setSunDirection(sunDirectionEci(new Date())), 60_000,
  );

  view.onFrame(() => {
    if (epochB <= epochA) return;
    satellites.setAlpha((Date.now() - epochA) / (epochB - epochA));
  });

  return () => {
    clearInterval(tickTimer);
    clearInterval(sunTimer);
    client.dispose();
    satellites.dispose();
    view.dispose();
  };
}
```

- [x] **Step 2: Rewrite `src/App.tsx` to use it**

```tsx
import { useEffect, useRef, useState } from 'react';
import { startGlobe } from './globe.ts';

export function App() {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    let teardown: (() => void) | undefined;
    let cancelled = false;

    startGlobe(container)
      .then((stop) => { if (cancelled) stop(); else teardown = stop; })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });

    return () => { cancelled = true; teardown?.(); };
  }, []);

  return (
    <>
      <div ref={ref} style={{ width: '100%', height: '100%' }} />
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
```

- [x] **Step 3: Run the full test suite and typecheck**

```bash
ppnpm test && ppnpm run typecheck
```

Expected: all 43 tests pass, no type errors.

- [x] **Step 4: Verify in the browser**

```bash
pnpm run dev
```

Check, in order:

1. Console logs `[apsis] N of M objects renderable`, with N in the region of 16,500 and `M - N` in the low single digits. A large exclusion count means the error filter or the join is wrong.
2. Dots appear within a couple of seconds of the globe.
3. **Dots move smoothly, not in visible 1-second jumps.** A stutter means `setAlpha` is not being driven, or `epochA`/`epochB` are equal.
4. LEO dots complete an orbit in roughly 90 minutes of wall time — sanity-check by watching one for a minute; it should traverse a visible arc.
5. Dots behind the Earth are hidden by it.
6. No console errors.

- [x] **Step 5: Confirm the frame budget**

In DevTools, record a few seconds in the Performance panel.

Expected: frames at or near 60 fps, with a ~11 ms worker task once per second that does **not** appear on the main thread. If propagation shows up on the main thread, the Worker is not actually being used — check that Vite bundled `worker.ts` as a module worker.

- [x] **Step 6: Add cache headers**

`public/_headers`:
```
/data/*
  Cache-Control: public, max-age=3600, must-revalidate

/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

`catalog.json` is refreshed twice daily, so an hour of caching is safe and keeps repeat visits fast. Vite's hashed assets are immutable.

Note: no COOP/COEP headers. The single-thread WASM runtime does not need cross-origin isolation, and adding those headers would break third-party embeds for no benefit.

- [x] **Step 7: Build and preview the production bundle**

```bash
pnpm run build && pnpm run preview
```

Expected: a clean build. Verify the globe works in the preview exactly as in dev — worker bundling differs between dev and build, so this check is not redundant.

- [x] **Step 8: Commit**

```bash
git add src/globe.ts src/App.tsx public/_headers
git commit -m "feat: wire propagation to the renderer and verify end to end"
```

## Task 12: Artifact freshness and load resilience

The spec requires a staleness banner and a retrying fetch. Neither is covered by Tasks 1-11.

**Files:**
- Create: `src/catalog/load.ts`, `src/ui/StaleBanner.tsx`
- Modify: `src/propagation/worker.ts` (use the retrying fetch)
- Modify: `src/globe.ts`, `src/App.tsx` (surface staleness)
- Test: `src/catalog/load.test.ts`

**Interfaces:**
- Consumes: `Manifest` from `src/catalog/types.ts`
- Produces:
  - `isStale(manifest: Manifest, now: Date, maxAgeHours?: number): boolean`
  - `interface FetchDeps { fetchFn: typeof fetch; sleep(ms: number): Promise<void> }`
  - `fetchWithRetry(url: string, deps: FetchDeps, attempts?: number): Promise<Response>`

**Scoping note, stated plainly:** the spec's fallback chain was *retry -> IndexedDB copy -> bundled snapshot*. This task implements **retry only**. The artifact is a same-origin static file on the same CDN serving the page, so the failure it guards against is one where the page itself would not have loaded. IndexedDB caching earns its complexity in phase 3, when observer mode makes offline use meaningful. Flagged rather than silently dropped.

- [x] **Step 1: Write the failing test**

`src/catalog/load.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { fetchWithRetry, isStale, type FetchDeps } from './load.ts';
import type { Manifest } from './types.ts';

const manifest = (generatedAt: string): Manifest => ({
  generatedAt, objectCount: 16578, source: 'test', checksum: 'x'.repeat(64),
});
const NOW = new Date('2026-09-19T12:00:00Z');

describe('isStale', () => {
  it('accepts an artifact generated hours ago', () => {
    expect(isStale(manifest('2026-09-19T06:00:00Z'), NOW)).toBe(false);
  });

  it('flags an artifact older than the default 72 hours', () => {
    expect(isStale(manifest('2026-09-15T12:00:00Z'), NOW)).toBe(true);
  });

  it('honours a custom threshold', () => {
    expect(isStale(manifest('2026-09-19T06:00:00Z'), NOW, 3)).toBe(true);
  });

  it('treats an unparseable timestamp as stale — freshness unproven is freshness absent', () => {
    expect(isStale(manifest('not a date'), NOW)).toBe(true);
  });

  it('treats a future timestamp as fresh rather than erroring', () => {
    expect(isStale(manifest('2026-09-20T12:00:00Z'), NOW)).toBe(false);
  });
});

describe('fetchWithRetry', () => {
  function deps(responses: (Response | Error)[]): FetchDeps & { calls: number } {
    let calls = 0;
    const d = {
      get calls() { return calls; },
      fetchFn: (async () => {
        const next = responses[calls++];
        if (next instanceof Error) throw next;
        return next!;
      }) as unknown as typeof fetch,
      sleep: async () => {},
    };
    return d as FetchDeps & { calls: number };
  }

  it('returns the first successful response without retrying', async () => {
    const d = deps([new Response('ok', { status: 200 })]);
    const res = await fetchWithRetry('/data/catalog.json', d);
    expect(res.status).toBe(200);
    expect(d.calls).toBe(1);
  });

  it('retries a 503 and succeeds on a later attempt', async () => {
    const d = deps([
      new Response('', { status: 503 }),
      new Response('ok', { status: 200 }),
    ]);
    const res = await fetchWithRetry('/data/catalog.json', d);
    expect(res.status).toBe(200);
    expect(d.calls).toBe(2);
  });

  it('retries a thrown network error', async () => {
    const d = deps([new Error('network down'), new Response('ok', { status: 200 })]);
    await expect(fetchWithRetry('/data/catalog.json', d)).resolves.toBeTruthy();
    expect(d.calls).toBe(2);
  });

  it('gives up after the attempt limit and reports the last failure', async () => {
    const d = deps([
      new Response('', { status: 500 }),
      new Response('', { status: 500 }),
      new Response('', { status: 500 }),
    ]);
    await expect(fetchWithRetry('/data/catalog.json', d, 3)).rejects.toThrow(/500/);
    expect(d.calls).toBe(3);
  });

  it('does not retry a 404 — a missing artifact will not appear on its own', async () => {
    const d = deps([new Response('', { status: 404 })]);
    await expect(fetchWithRetry('/data/catalog.json', d)).rejects.toThrow(/404/);
    expect(d.calls).toBe(1);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

```bash
pnpm exec vitest run src/catalog/load.test.ts
```

Expected: FAIL — cannot resolve `./load.ts`.

- [x] **Step 3: Write `src/catalog/load.ts`**

```ts
import type { Manifest } from './types.ts';

const DEFAULT_MAX_AGE_HOURS = 72;

/**
 * Is the committed artifact too old to present without warning?
 *
 * Ingestion runs twice daily, so anything past three days means the workflow
 * has been failing. An unparseable timestamp counts as stale: freshness that
 * cannot be proven is freshness we do not have.
 */
export function isStale(
  manifest: Manifest, now: Date, maxAgeHours = DEFAULT_MAX_AGE_HOURS,
): boolean {
  const generated = Date.parse(manifest.generatedAt);
  if (Number.isNaN(generated)) return true;
  const ageHours = (now.getTime() - generated) / 3_600_000;
  return ageHours > maxAgeHours;
}

export interface FetchDeps {
  fetchFn: typeof fetch;
  sleep(ms: number): Promise<void>;
}

export const defaultFetchDeps: FetchDeps = {
  fetchFn: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Fetch with exponential backoff.
 *
 * 4xx responses are not retried: a missing or forbidden artifact will not
 * fix itself, and retrying only delays the error the user needs to see.
 */
export async function fetchWithRetry(
  url: string, deps: FetchDeps = defaultFetchDeps, attempts = 3,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await deps.sleep(250 * 2 ** (attempt - 1));
    try {
      const response = await deps.fetchFn(url);
      if (response.ok) return response;
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`${url} responded ${response.status} (not retryable)`);
      }
      lastError = new Error(`${url} responded ${response.status}`);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      if (/not retryable/.test(e.message)) throw e;
      lastError = e;
    }
  }
  throw lastError ?? new Error(`${url} failed after ${attempts} attempts`);
}
```

- [x] **Step 4: Run the test to verify it passes**

```bash
pnpm exec vitest run src/catalog/load.test.ts
```

Expected: 10 tests PASS.

- [x] **Step 5: Use the retrying fetch in the worker**

In `src/propagation/worker.ts`, add the import:

```ts
import { fetchWithRetry } from '../catalog/load.ts';
```

and replace these two lines:

```ts
      const response = await fetch(request.catalogUrl);
      if (!response.ok) {
        throw new Error(`catalog fetch failed: ${response.status} ${response.statusText}`);
      }
```

with:

```ts
      const response = await fetchWithRetry(request.catalogUrl);
```

`fetchWithRetry` already throws a descriptive error on failure, so the explicit `response.ok` check is now redundant.

- [x] **Step 6: Write `src/ui/StaleBanner.tsx`**

```tsx
export function StaleBanner({ generatedAt }: { generatedAt: string }) {
  return (
    <div
      role="status"
      style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        padding: '8px 16px', textAlign: 'center',
        background: '#4a3a12', color: '#ffd98a',
        font: '13px system-ui', zIndex: 10,
      }}
    >
      Orbital elements were last refreshed {new Date(generatedAt).toUTCString()}.
      Positions may have drifted.
    </div>
  );
}
```

- [x] **Step 7: Surface staleness from `src/globe.ts`**

Change the `startGlobe` signature to report the manifest, and fetch it alongside init. Add near the top of `startGlobe`, after `createScene`:

```ts
  const manifestResponse = await fetchWithRetry('/data/manifest.json');
  const manifest = (await manifestResponse.json()) as Manifest;
```

Add the imports:

```ts
import { fetchWithRetry, isStale } from './catalog/load.ts';
import type { Manifest } from './catalog/types.ts';
```

Change the return type to `Promise<{ stop: () => void; staleSince: string | null }>` and the final return to:

```ts
  return {
    stop: () => {
      clearInterval(tickTimer);
      clearInterval(sunTimer);
      client.dispose();
      satellites.dispose();
      view.dispose();
    },
    staleSince: isStale(manifest, new Date()) ? manifest.generatedAt : null,
  };
```

- [x] **Step 8: Render the banner in `src/App.tsx`**

Replace the `startGlobe(container).then(...)` block with:

```tsx
    startGlobe(container)
      .then(({ stop, staleSince }) => {
        if (cancelled) stop();
        else { teardown = stop; setStaleSince(staleSince); }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      });
```

Add the state and import:

```tsx
import { StaleBanner } from './ui/StaleBanner.tsx';
// ...
const [staleSince, setStaleSince] = useState<string | null>(null);
```

and render it above the error overlay:

```tsx
{staleSince && <StaleBanner generatedAt={staleSince} />}
```

- [x] **Step 9: Verify the banner by forcing staleness**

```bash
node -e "const f='public/data/manifest.json';const m=require('./'+f);m.generatedAt='2020-01-01T00:00:00.000Z';require('fs').writeFileSync(f,JSON.stringify(m,null,2))"
pnpm run dev
```

Expected: the amber banner appears above the globe. Then restore the real manifest:

```bash
git checkout public/data/manifest.json
```

- [x] **Step 10: Full suite, typecheck, commit**

```bash
ppnpm test && ppnpm run typecheck
```

Expected: all 53 tests pass.

```bash
git add src/catalog/load.ts src/catalog/load.test.ts src/ui/StaleBanner.tsx src/propagation/worker.ts src/globe.ts src/App.tsx
git commit -m "feat: retrying artifact fetch and stale-catalog banner"
```

---

## Task 13: Deploy

- [ ] **Step 1: Deploy to Cloudflare Pages**

Connect the repository in the Cloudflare Pages dashboard with:

- Build command: `pnpm run build`
- Build output directory: `dist`
- Node version: `24` (environment variable `NODE_VERSION`)

Then confirm the deployed URL renders the globe with dots moving, and that `/data/catalog.json` is served.

- [ ] **Step 2: Tag phase 1**

```bash
git tag -a phase-1 -m "Phase 1: engine — ingestion, propagation, globe"
git push --tags
```

---

## Definition of Done

Phase 1 is complete when all of the following hold:

- `pnpm test` passes with every test scoped under `src` and `scripts`
- `pnpm run typecheck` is clean
- The scheduled workflow has run successfully at least once and committed a catalog
- The deployed page renders ~16,500 satellites moving smoothly at 60 fps
- A manifest older than 72 hours raises the staleness banner, and the globe
  still renders behind it
- The worker tick does not appear on the main thread in a performance profile
- Satellites with a non-zero SGP4 error are excluded, and the exclusion count is logged
- A Celestrak refusal fails the ingestion job without overwriting the committed artifact

## Deliberately Not In Phase 1

Per the spec: picking, search, detail panels, orbit trails, ground tracks and regime colour-coding are phase 2. Observer mode is phase 3. Earth textures are a marked follow-on inside Task 9. Visual direction beyond "correct and legible" is the open question flagged in the spec.
