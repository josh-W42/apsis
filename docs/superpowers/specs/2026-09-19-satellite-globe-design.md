# apsis — live 3D satellite globe

**Date:** 2026-09-19
**Status:** Approved (revision 2), pending implementation plan

> **Revision 2 (2026-09-19).** Benchmarking satellite.js 7.1.0 against the real
> catalog invalidated several load-bearing assumptions in revision 1. The worker
> pool, the cross-origin isolation question, the custom binary format and the
> WebGPU phase have all been removed. See *Measured findings* and *Revision
> history*.

## Context

A web application rendering the active satellite catalog as a live 3D globe.
Visitors can select or search for a satellite to see its orbit and details, and
can set an observer location to find out what is overhead and when the next
passes occur.

**Primary driver:** portfolio showpiece. Deployed publicly, visually striking,
with an architecture worth discussing. Polish and first-load impact matter more
than daily utility.

**Hosting constraint:** fully static, zero runtime cost, zero ops.

### Correcting a common assumption

There is no live position feed for satellites, and none is needed. What is
published are orbital elements (TLE/OMM) that update roughly 1-8 times per day
per object. Positions are derived by running those elements through the SGP4
propagator. "Near real-time" therefore means *the clock is live*, not the data
feed.

Consequences, all favourable:

- Positions are deterministic and computable entirely offline
- "Now" is one point on a timeline that can be scrubbed in either direction
- The application is never latency-bound
- A server that streamed positions would be strictly worse than one that does not

## Goals

- Render the full active catalog (16,578 objects) at 60 fps
- Select or search a satellite; show orbit trail, ground track, and detail panel
- Observer mode: overhead-now, pass prediction, sky view
- Headroom to scale to the full tracked catalog (~28k+, including debris) —
  measured at 18.6 ms per tick, so this is a credential change, not re-architecture
- Zero runtime hosting cost

## Non-goals

- Time scrubbing UI (deferred; the machinery is ~90% built by pass prediction,
  so it stays cheap to add later)
- Rich filtering and grouping (deferred; minimal regime colour-coding ships
  instead, see Rendering)
- Conjunction / close-approach analysis
- Any operational or safety-of-flight use. TLE + SGP4 is kilometre-scale at
  epoch and degrades over days. Suitable for visualisation and for pointing a
  camera; not for collision avoidance.

## Measured findings

Verified against live endpoints on 2026-09-19:

| Finding | Value |
|---|---|
| `celestrak.org` CORS | `access-control-allow-origin: *` — direct browser fetch works |
| Active catalog size | **16,578 objects** |
| GP JSON payload | 6.9 MB raw, 1.06 MB gzipped |
| `satcat.csv` | 70,708 rows, 6.7 MB — free metadata |
| Cache headers on GP | none (no `etag`, `last-modified`, or `cache-control`) |

`satcat.csv` supplies `OBJECT_TYPE`, `OWNER`, `LAUNCH_DATE`, `LAUNCH_SITE`,
`DECAY_DATE`, `PERIOD`, `INCLINATION`, `APOGEE`, `PERIGEE`, `RCS` — the entire
detail panel and the regime colour-coding, at no cost.

### Propagation benchmark

Measured 2026-09-19 against the full 16,578-object catalog, satellite.js 7.1.0,
Node v23.10.0:

| Measurement | Result |
|---|---|
| `JSON.parse` of the 6.9 MB payload | **19.3 ms** |
| `json2satrec` x 16,578 | **273.7 ms** (one-time; paid in any wire format) |
| Pure-JS `propagate()`, whole catalog | **46.6 ms** per tick |
| WASM single-thread `BulkPropagator` | **11.0 ms** per tick (4.2x faster) |
| SGP4 error / decayed flagged | **1 of 16,578** (0.01%) |
| Extrapolated to 28k objects | **18.6 ms** per tick |

At a 1 Hz tick the WASM path consumes **1.1% of one second**. This is the
finding that reshaped the design.

### Threading requirement

satellite.js ships two emscripten builds. Inspected directly:

| Build | Size | `SharedArrayBuffer` / pthread refs | Cross-origin isolation |
|---|---|---|---|
| `base-release` | 126 KB | **none** | not required |
| `pthreads-release` | 285 KB | 1 / 117, plus `Atomics` | **required** |

Since the single-thread build is roughly 50x under budget, the pthreads build
is unnecessary and **COOP/COEP headers are not needed.**

**A 403 was observed** from Celestrak partway through probing, after only a
handful of requests. The cause is unconfirmed: it may have been the
`Accept-Encoding: gzip` request header, or rate limiting. Subsequent requests
succeeded, which argues for the header.

Separately and more concretely: during benchmarking, a repeat request returned
**HTTP 200 with a plain-text body** rather than JSON:

```
GP data has not updated since your last successful
download of GROUP=active at 2026-09-20 01:16:54 UTC.
```

Celestrak tracks the caller's last successful fetch and declines to re-serve
unchanged data. **This is a required ingestion error case** — a 200 response is
not a guarantee of JSON. It is also the clearest argument for keeping visitors
off Celestrak entirely.

### Resolved conflict: scale vs. hosting

"Scale to the full tracked catalog" and "fully static, no backend" cannot both
hold as originally stated. Debris data requires Space-Track authentication, and
credentials cannot live in a static bundle. Probing found no unauthenticated
full-catalog endpoint; Celestrak's named debris groups are largely vestigial
(`cosmos-1408-debris` returns 3 objects).

**Resolution:** move ingestion to build time. A GitHub Actions cron job can hold
a Space-Track credential as a repository secret and emit a static artifact. The
deployment stays fully static with zero runtime cost, and the upgrade to the
full catalog becomes a credential change rather than an architecture change.

Until that credential is added, **16,578 is the ceiling.**

## Architecture

Two halves, with a file as the interface. Nothing runs at request time.

```
GitHub Actions (cron, 2x daily)          Static host (Cloudflare Pages)
  fetch GP JSON  ─┐                        catalog.json  ──> browser
  fetch satcat   ─┼─> join ─> trim ──>     manifest.json
                  ┘
```

### Data pipeline (`ingest/`, Node-only)

1. Fetch `gp.php?GROUP=active&FORMAT=json` and `satcat.csv`
2. Join on `NORAD_CAT_ID`
3. Drop any record with a `DECAY_DATE`
4. Encode and emit three artifacts

| Artifact | Contents |
|---|---|
| `catalog.json` | Trimmed OMM elements with SATCAT metadata pre-joined |
| `manifest.json` | generated-at, object count, checksum |

Revision 1 split these into hot and cold artifacts to get the globe rendering
before metadata arrived. With parse measured at 19.3 ms for the *untrimmed*
payload, that split buys nothing and is dropped. One artifact, one fetch.

**Cadence:** twice daily. Elements update 1-8x/day per object; twice daily keeps
positions well within the accuracy the model itself supports.

### Artifact format

Revision 1 specified a custom struct-of-arrays binary format. **It has been
dropped.** Its two strongest justifications both failed under measurement:

- *"Zero parse cost"* — the real `JSON.parse` cost is 19.3 ms, not the ~150 ms
  estimated, and it is dwarfed by the 273.7 ms of `json2satrec` construction
  that is paid in any wire format.
- *"It is the WebGPU seam"* — the WebGPU phase has been removed (see below).

Ingestion instead emits **trimmed OMM JSON**: only the fields SGP4 and the
detail panel actually consume, with SATCAT metadata pre-joined. This deletes the
`format/` module, its encoder and decoder, its golden-file test and its
round-trip test, at a cost of roughly 350 KB of transfer and 19 ms of parse.

Build-time ingestion itself is unaffected and remains strongly justified — it is
what keeps visitors off Celestrak and what makes the Space-Track upgrade a
credential change rather than an architecture change.

### Propagation (`propagation/`)

**One worker, not a pool.** Revision 1 specified a `hardwareConcurrency`-sized
pool with slice partitioning and double-buffered transferables. At 11.0 ms for
the entire catalog that machinery solves a problem that does not exist.

The single worker is justified by two costs that would otherwise block the main
thread, neither of them the propagation itself:

- the 273.7 ms of `json2satrec` construction at startup, which would delay first
  paint
- the 11 ms tick, which would drop a frame once per second if run on the main
  thread

Propagation uses satellite.js's **`BulkPropagator`** with the WASM
`createSingleThreadRuntime()`. `EciBaseCalculator` returns exactly what the
renderer needs:

- `position`: `Float64Array`, packed `[x0,y0,z0,x1,y1,z1,...]`
- `velocity`: `Float64Array`, same packing
- `error`: `Int8Array`, one `SatRecError` per satellite

Run with `communityDecayCheckEnabled: true`, which flags long-decayed objects
that SGP4 would otherwise propagate to meaningless positions. Measured, this
flags 1 record in 16,578. Flagged satellites are excluded from the render set at
init; a non-zero error must never be rendered.

**Hermite interpolation survives, with a revised rationale.** It is no longer
about CPU budget — that concern is gone. It is about buffer-upload economy: the
CPU uploads new position/velocity buffers at 1 Hz and the GPU interpolates
between them, rather than re-uploading every frame at 60 Hz.

Error budget for a 550 km LEO orbit, unchanged from revision 1:

| Tick interval | Linear interpolation | Hermite |
|---|---|---|
| 1 s | ~1 m | negligible |
| 2 s | ~4 m | negligible |
| 10 s | ~104 m | centimetre-scale |

#### Removed: the WebGPU phase

Revision 1 carved out a `WebGPUPropagator` as phase 4, with the data layout
designed around it. **This is removed.** At 18.6 ms per tick for 28k objects on
a single thread there is no performance problem left to solve, and porting SGP4
to WGSL to compete with a tuned C build compiled to WASM would be a poor trade —
particularly given SGP4's deep-space branches are conditional-heavy and hostile
to SIMD lanes.

If the catalog ever grows far beyond 28k, the cheaper next step is the
`pthreads-release` build behind COOP/COEP headers, not a WGSL rewrite.

### Rendering (`render/`)

Three.js, not CesiumJS. Cesium produces a correct globe quickly but looks like
Cesium, ships a heavy bundle, and its entity system fights back past a few
thousand moving objects. For a portfolio piece, an owned atmosphere shader and
instanced point pipeline is the better artifact.

**Satellites are a single draw call** — one `THREE.Points` with a custom
`ShaderMaterial`. Per-vertex attributes carry `posA`/`velA`/`posB`/`velB`, a
regime index, and size; a single `t` uniform drives Hermite interpolation in the
vertex shader. Buffers are ping-ponged rather than mutated in place, so the 1 Hz
update never stalls on a buffer the GPU is still reading.

16,578 points in one draw call leaves substantial headroom, which is what makes
the 28k target realistic.

**Earth** is a textured sphere — albedo, night lights, and a roughness map for
ocean specular — lit by the actual sun position derived from the current date,
so the terminator is real. Atmospheric limb glow uses an analytic Rayleigh
approximation on a slightly larger back-faced shell. NASA Blue Marble and Black
Marble imagery is public domain. Load a 2k texture first and swap in 4k after;
an 8k set is tens of megabytes and would undo the fast-first-paint work.

Occlusion needs no special handling — the Earth is opaque geometry, so depth
testing hides satellites behind it.

**Picking is a GPU colour-ID pass** into a 1x1 scissored render target at the
cursor. Exact at any density, with no spatial index to rebuild as everything
moves. It renders only the points layer.

**On selection:** propagate that satellite across one full orbital period at
~200 steps for the orbit trail; project the same samples to the surface,
accounting for Earth rotation during the period, for the ground track.

**Regime colour-coding** (LEO/MEO/GEO/HEO, derived from SATCAT apogee/perigee)
ships in phase 2 as the minimal legibility measure. Without it, 16.5k
undifferentiated dots are hard to read and Starlink visually dominates. Palette
contrast against a dark starfield is an implementation-time concern.

### Observer mode (`observer/`)

**Overhead-now is nearly free.** The propagation worker already holds every
position. satellite.js provides `LookAnglesCalculator` as a `BulkPropagator`
calculator, producing azimuth, elevation and range directly; filter on
elevation > 0.

**Pass prediction** gets its own worker: coarse-scan the selected satellite at
30 s steps over 48 hours, detect sign changes in `(elevation - threshold)`, then
bisect to ~1 s precision. Culmination falls out of a golden-section search over
the same interval.

**Visible-pass filtering** is included, and is now close to free: satellite.js
ships `shadowFraction(sunEciAU, satelliteEciKm)` and a matching
`ShadowFractionCalculator`, returning 0 for fully lit through 1 for umbra. Sun
position comes from `sunPos(jday)`. A pass is observable when the satellite is
lit and the observer is in darkness.

Sky view is a polar azimuth/elevation plot. SVG is sufficient; ECharts is an
option for consistency with Live-Telemetry-Viewer.

Location comes from manual lat/lon entry, with the Geolocation API as an
optional convenience. Denial must fall back to manual entry.

## Error handling

**The one that will actually bite:** SGP4 returns error codes and NaNs for real
records in this feed — deep-space edge cases and objects near re-entry. A single
bad element must not poison a worker's batch. Bad satellites are flagged once at
init and excluded from the render set. This is a **phase-1 requirement**, not a
later hardening pass.

| Condition | Behaviour |
|---|---|
| Manifest older than 3 days | Banner; still renders |
| Artifact fetch failure | Retry with backoff -> IndexedDB copy -> bundled snapshot |
| WebGL context loss | Listen and rebuild |
| No WebGL2 | Explicit message, not a black rectangle |
| Geolocation denied | Fall back to manual entry |

## Testing strategy

Test-driven throughout. Dependency injection everywhere, so no `vi.mock`. Test
commands are scoped to explicit paths — `bun test` otherwise pulls in sibling
workspace packages.

**Revision 2 reframes the top test.** Revision 1 proposed running Vallado's
official SGP4 verification vectors end to end. Investigation showed that
satellite.js is built from Vallado's reference C++ (`src-cpp/SGP4.cpp`) and
already verifies against those vectors upstream; its fixtures are 51,949 lines
of TLEs and a 75 MB results file, far too large to vendor. Re-running them would
be testing someone else's library.

**The highest-value test is pipeline fidelity instead:** take a fixed set of OMM
records, run them through ingest -> artifact -> load -> propagate, and assert the
resulting state vectors match a direct `propagate()` call on the original
records to within tight tolerance. That tests our code, which is the only code
that can break here.

Supporting tests:

| Test | Asserts |
|---|---|
| Ingestion join | GP record joined to its SATCAT row by `NORAD_CAT_ID`; unmatched records retained with null metadata |
| Ingestion trim | Every field SGP4 and the detail panel consume survives the trim; no extras |
| Celestrak refusal | A 200 response whose body is not JSON is rejected, and the previous artifact is retained |
| Decay filtering | Records with a `DECAY_DATE`, and satellites whose `error` is non-zero, are excluded from the render set |
| Hermite interpolation | Interpolated position at *t* within 10 m of direct propagation at *t* |
| Coordinate transforms | ECI -> ECEF -> topocentric against reference values |
| Pass prediction | Contract test on a synthetic circular overhead orbit: rise/set symmetric, culmination ~90 deg elevation |

The pass-prediction test is deliberately written against specified behaviour
rather than mirroring the implementation.

## Module boundaries

| Module | Purpose | Depends on |
|---|---|---|
| `ingest/` | Fetch, join, encode. Node-only, fixture-testable, no browser. | — |
| `propagation/` | Worker wrapping `BulkPropagator`. No Three.js. | — |
| `render/` | Three.js scene. No knowledge of SGP4. | — |
| `observer/` | Geometry and pass search. No UI. | `propagation` |
| `ui/` | React components. | all |

## Phases

1. **Engine** — ingestion pipeline, globe, 16,578 dots moving correctly,
   validated against SGP4 verification vectors. NaN filtering included.
2. **Interaction** — picking, search, detail panel, orbit trail, ground track,
   regime colour-coding.
3. **Observer** — location, overhead-now, pass prediction with visibility
   filtering, sky view.
Phase 4 (`WebGPUPropagator`) is removed. Scaling to the full tracked catalog is
no longer a phase but a configuration change: add a Space-Track credential to
the ingestion workflow's secrets. No client code changes.

Phase 2 precedes phase 3: selection is the primary interaction loop, and the
detail panel is a prerequisite for the observer UI to have anywhere to live.

## Stack

React + TypeScript + Vite + vitest, matching the existing house pattern.
Three.js for rendering. Cloudflare Pages for hosting. GitHub Actions for
scheduled ingestion.

## Open questions

1. **Visual direction** — "visually striking" is a stated success criterion but
   the aesthetic direction is unspecified. An implementation-time concern for
   phase 1, not an architectural gap. The only open question that blocks nothing
   but matters most to the stated goal.
2. **Sky view renderer** — SVG or ECharts. Deferred to phase 3.
3. **Project name** — `apsis` is a working title.

*Closed in revision 2:* SGP4 verification vector format (reframed — see
Testing); satellite.js throughput (measured — see Measured findings); whether
cross-origin isolation is required (it is not).

## Risks

| Risk | Mitigation |
|---|---|
| Celestrak blocks or rate-limits ingestion | Build-time fetch means one request per cron run, not per visitor; last-good artifact is retained on failure |
| Celestrak serves a 200 with a non-JSON refusal body | Ingestion validates content before writing; last-good artifact is retained on failure. Observed in practice, not hypothetical |
| `json2satrec` startup cost (274 ms) delays interactivity | Runs in the worker, off the main thread; globe shell renders first |
| Texture payload undermines fast first paint | Progressive 2k -> 4k load; measure against the fast-first-paint goal |

## Revision history

### Revision 2 — 2026-09-19

Prompted by benchmarking satellite.js 7.1.0 against the real 16,578-object
catalog before writing the implementation plan. Four of revision 1's decisions
did not survive contact with measurement.

| Removed | Why |
|---|---|
| Hand-rolled worker pool with slice partitioning and double-buffered transferables | Whole-catalog propagation is 11.0 ms. The pool solved a problem that does not exist. Replaced by one worker, justified by startup cost rather than tick cost. |
| Cross-origin isolation (COOP/COEP) analysis | Only the pthreads build needs `SharedArrayBuffer`, and the single-thread build is ~50x under budget. Moot. |
| Custom struct-of-arrays binary format and the `format/` module | Real parse cost is 19.3 ms, not the estimated ~150 ms, and it is dwarfed by 273.7 ms of `json2satrec`. Its other justification was the WebGPU seam, also removed. |
| WebGPU phase 4 (`WebGPUPropagator`) | 18.6 ms per tick for 28k objects. No performance problem remains to solve. |

| Added or strengthened | Why |
|---|---|
| `BulkPropagator` + WASM single-thread runtime | Ships in satellite.js; returns packed position/velocity `Float64Array`s and a per-satellite error code — exactly the renderer's input |
| `communityDecayCheckEnabled` | Library-provided handling for decayed-object garbage. Measured: 1 bad record in 16,578 |
| `ShadowFractionCalculator` / `sunPos` | Makes phase 3 visible-pass filtering nearly free |
| Celestrak non-JSON refusal as an ingestion error case | Observed in practice during benchmarking, not hypothetical |
| Pipeline-fidelity test replacing Vallado vector replay | satellite.js already verifies SGP4 upstream; our tests should cover our code |

Two estimates in revision 1 were simply wrong: `JSON.parse` cost (~150 ms
estimated, 19.3 ms actual) and the premise that catalog-scale propagation needs
parallelism.

### Revision 1 — 2026-09-19

Initial design. Approved, then revised before implementation.
