# apsis

A live 3D globe showing where every active satellite is, right now.

**→ [apsis-globe.web.app](https://apsis-globe.web.app)**

16,578 objects propagated from real orbital elements, rendered in a single draw
call at 60 fps. Click any dot for live altitude, speed and ground position; search
by name or NORAD id; watch an orbit trail and its ground track.

<!-- A hero screenshot belongs here. Drop a PNG in docs/ and reference it. -->

## The thing that surprises people

**There is no live feed of satellite positions, and there doesn't need to be.**

What agencies publish are *orbital elements* — compact descriptions of an orbit
that update a handful of times a day. Positions are derived by running those
elements through [SGP4](https://en.wikipedia.org/wiki/Simplified_perturbations_models),
the standard orbital propagator.

So "live" here means **the clock is live, not the data feed**. Elements are
fetched once at build time; every position you see is computed in your browser,
sixty times a second, from a deterministic model. Nothing is streamed. The app
would keep working with the network unplugged.

That makes the architecture unusual in a useful way: there is no backend at all.

## Quick start

Requires **Node ≥ 23** and **pnpm** (see [Toolchain](#toolchain) — npm will not work here).

```bash
git clone git@github.com:josh-W42/apsis.git
cd apsis
pnpm install
pnpm run dev
```

Open http://localhost:5174. The catalog is committed, so there is nothing to
fetch and no keys to configure — it runs immediately.

## Using it

| Action | What happens |
|---|---|
| **Click a dot** | Selects that satellite; the panel fills with live and orbital data |
| **Search** | By name (`starlink`), NORAD id (`25544`), or designator (`1998-067A`) |
| **Select a result** | Camera locks on and follows it; toggle with `FOLLOW` |
| **Drag** | Rotate. Dragging never clears your selection |
| **Scroll** | Zoom. The GEO belt sits at 6.6 Earth radii — zoom out to see the ring |
| **`HIDE` Starlink** | Removes two thirds of the objects, revealing everything else |

Colours group objects by constellation: Starlink, OneWeb, GNSS, the
geostationary belt, and everything else. Starlink is deliberately muted — it is
**67% of the catalog** and drowns the rest at full contrast.

### Reading the panel

`ALT` is height above the WGS84 ellipsoid. `APO` and `PER` come from SATCAT and
are referenced to the *equatorial* radius. Away from the equator the ellipsoid
is smaller, so **live altitude can legitimately read higher than apogee** — the
panel notes this rather than hiding it.

## How it works

```
GitHub Actions (cron, 2x daily)          Firebase Hosting (static)
  Celestrak GP elements  ─┐
  Celestrak SATCAT       ─┼─ join ─→     catalog.json  ──→  browser
  Celestrak owner codes  ─┘              manifest.json
                                                              │
                                    ┌─────────────────────────┘
                                    ▼
                          Web Worker: SGP4 via WASM, 1 Hz
                                    │  positions + velocities
                                    ▼
                          Three.js: one draw call, 60 fps
                          (vertex shader interpolates between ticks)
```

Three details worth knowing:

**Propagation is decoupled from framerate.** The worker computes positions *and*
velocities once per second; the vertex shader does cubic Hermite interpolation
between ticks. The CPU works at 1 Hz while the GPU animates at 60. Measured, the
whole catalog propagates in ~11 ms, about 1% of the budget.

**Picking is a GPU colour-ID pass.** Each satellite renders its index as a colour
into a small offscreen window at the cursor; the nearest hit wins. Exact at any
density, with no spatial index to rebuild as 16,577 objects move.

**The globe is in the ECI frame.** Three.js sphere poles sit on +Y but ECI's
north is +Z, so the mesh is tilted a quarter turn and rotated by Greenwich Mean
Sidereal Time. That is what makes ground tracks stay over their geography and
the terminator match real UTC.

## Accuracy

Orbital elements plus SGP4 is accurate to roughly a kilometre near the element
epoch, degrading over days. That is fine for a visualisation, for pointing a
camera, or for knowing roughly when something passes overhead.

**It is not suitable for anything operational** — not collision avoidance, not
safety-of-flight. Objects near re-entry and long-decayed objects are excluded
outright, because SGP4 propagates them to meaningless positions.

## Development

```bash
pnpm run dev         # dev server on :5174
pnpm test            # 228 tests
pnpm run typecheck   # tsc --noEmit
pnpm run build       # typecheck + production bundle to dist/
pnpm run ingest      # refresh the catalog from Celestrak
```

The catalog is not committed. Run `pnpm run ingest` once before `pnpm run dev`.
Production deploys come from the `Ingest catalog` workflow, twice daily or on
demand with `gh workflow run ingest.yml` (`-f deploy=false` for a dry run).
`firebase deploy` refuses to run without `dist/data/manifest.json`.

### Layout

```
scripts/ingest/   Fetch, validate and join Celestrak data (Node only)
src/catalog/      Catalog types, search, classification, index mapping
src/math/         Hermite interpolation, geodetic conversion, sun position
src/propagation/  SGP4 worker, the client wrapper, the message protocol
src/render/       Three.js scene, earth shader, points, picking, trails
src/ui/           React rail, detail panel, theme
```

Logic that can be wrong silently lives in pure functions with tests. Three.js
wiring cannot run under vitest, so anything error-prone is extracted out of it —
the interpolation curve, the pick-window search, the index mapping, the
day/night blend.

### Toolchain

**Use pnpm, not npm.** Two independent reasons:

- npm 11.2.0 crashes resolving vitest's peer set (`Cannot read properties of
  null (reading 'edgesOut')`). Reproducible in an empty directory; it is an npm
  bug, not a dependency problem.
- The project pins `packageManager: pnpm@6.11.0`, matching the lockfile format.
  A newer pnpm rewrites the lockfile wholesale.

**Node ≥ 23** is required because `scripts/ingest/*.ts` run directly through
Node's native type stripping, with no build step.

### Traps

Documented at length in the
[design spec](docs/superpowers/specs/2026-09-19-satellite-globe-design.md), but
the ones most likely to bite:

- **Never call `runtime.dispose()`** on the satellite.js WASM runtime. It calls
  emscripten's `_exit_runtime()`, which kills the module process-wide — every
  later `createSingleThreadRuntime()` throws. React StrictMode's double-invoked
  effects hit this immediately.
- **Three index spaces exist.** Catalog index, live index (the render buffers,
  which exclude unpropagable objects), and the picking result. Confusing them
  selects the wrong satellite with no error at all. Use `src/catalog/indexing.ts`.
- **Custom shaders need `#include <colorspace_fragment>`.** Textures tagged sRGB
  are decoded to linear; without encoding back, everything renders dark.
- **Celestrak rate-limits by IP** and will return HTTP 200 with a plain-text
  refusal rather than JSON. Ingestion validates the body, not just the status.

## Data and attribution

- **Orbital elements and catalog metadata** — [CelesTrak](https://celestrak.org),
  courtesy of Dr T.S. Kelso. Ingestion runs twice daily; please don't point a
  high-frequency fetcher at their servers.
- **Earth imagery** — NASA Visible Earth, public domain. Blue Marble (day) and
  Earth's City Lights (night).
- **Propagation** — [satellite.js](https://github.com/shashwatak/satellite-js),
  built from Vallado's reference SGP4 implementation.

## Status

Phase 1 (engine) and phase 2 (interaction) are complete and deployed. Phase 3 —
observer mode with pass prediction and a sky view — is specified but not built.

Design decisions, measurements and the reasoning behind them live in
[`docs/superpowers/`](docs/superpowers/).

## Licence

**Not yet licensed.** There is no LICENSE file, which means default copyright
applies and nobody may reuse this code. If that isn't what you want, add one —
MIT is the usual choice for a project like this.

The third-party material has its own terms regardless: NASA imagery is public
domain, satellite.js is MIT, and Celestrak data is subject to
[their terms of use](https://celestrak.org/publications/).
