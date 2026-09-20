# apsis — live 3D satellite globe

**Date:** 2026-09-19
**Status:** Approved design, pending implementation plan

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
- Headroom to scale to the full tracked catalog (~28k+, including debris)
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

**A 403 was observed** from Celestrak partway through probing, after only a
handful of requests. The cause is unconfirmed: it may have been the
`Accept-Encoding: gzip` request header, or rate limiting. Subsequent requests
succeeded, which argues for the header. Either way it justifies keeping
visitors off Celestrak entirely.

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
  fetch GP JSON  ─┐                        elements.bin  ──> browser
  fetch satcat   ─┼─> join ─> encode ─>    meta.bin
                  ┘                        manifest.json
```

### Data pipeline (`ingest/`, Node-only)

1. Fetch `gp.php?GROUP=active&FORMAT=json` and `satcat.csv`
2. Join on `NORAD_CAT_ID`
3. Drop any record with a `DECAY_DATE`
4. Encode and emit three artifacts

| Artifact | Contents | Path |
|---|---|---|
| `elements.bin` | SGP4 inputs — hot path | fetched first |
| `meta.bin` | names, owners, launch dates, types, apogee/perigee — cold path | streams behind |
| `manifest.json` | generated-at, counts, checksums | fetched first |

Splitting hot from cold is a perceived-performance decision: the globe renders
from `elements.bin` alone while metadata streams in behind it. Search becomes
available a beat after the dots appear.

**Cadence:** twice daily. Elements update 1-8x/day per object; twice daily keeps
positions well within the accuracy the model itself supports.

### Binary format (`format/`)

`elements.bin` is **struct-of-arrays**: a header followed by ten contiguous
typed arrays (epoch, mean motion, eccentricity, inclination, RAAN, argument of
pericenter, mean anomaly, bstar, ndot, nddot) plus a `NORAD_CAT_ID` index.

Three reasons, the third being decisive:

1. No alignment padding; workers transfer only the fields they touch
2. `new Float64Array(buf, offset, count)` is zero-copy — **0 ms parse** instead
   of roughly 150 ms for the 6.9 MB JSON
3. **Each field is already a storage buffer.** This is the seam that makes the
   WebGPU phase cheap: it binds these arrays directly, with no restructuring.

**Precision:** Float64 for epoch and mean motion; Float32 for everything else.
Mean motion carries ~10 significant figures and its error integrates linearly
into mean anomaly over time, so it cannot be narrowed. The angles are specified
to ~4 decimal places, comfortably inside Float32.

**Honest accounting:** ~860 KB raw, and floats compress poorly, so roughly
700 KB over the wire versus 1.06 MB gzipped JSON. The size win is modest. The
real wins are the eliminated parse cost, the GPU-ready layout, and isolating
visitors from Celestrak.

`format/` is the only module imported by both halves. It is the contract.

### Propagation (`propagation/`)

A worker pool sized `hardwareConcurrency - 1`, capped around 8, each worker
owning a contiguous slice of the catalog.

**Transferable `ArrayBuffer`s with double-buffering**, not `SharedArrayBuffer`.
Transfers are zero-copy moves, and this avoids COOP/COEP headers entirely.

**Propagation is fully decoupled from framerate.** Workers emit position *and*
velocity — SGP4 returns both at no extra cost — and the vertex shader performs
cubic Hermite interpolation between ticks. The CPU propagates at 1 Hz; the GPU
animates at 60 fps.

Error budget for a 550 km LEO orbit:

| Tick interval | Linear interpolation | Hermite |
|---|---|---|
| 1 s | ~1 m | negligible |
| 2 s | ~4 m | negligible |
| 10 s | ~104 m | centimetre-scale |

At 1 Hz even naive linear interpolation is sub-metre, so Hermite is not buying
correctness today. **It is the headroom for the 28k debris case**, where tick
intervals can drop to 5-10 s — a tenfold reduction in propagation cost with no
visible change.

#### The WebGPU seam

The `Propagator` interface returns a **position-source handle**, not raw arrays,
so both implementations satisfy one contract:

- `WorkerPoolPropagator` (phase 1) — uploads a buffer
- `WebGPUPropagator` (phase 4) — hands back a buffer the renderer already binds,
  so positions never leave the GPU

The SGP4 implementation is an **injected dependency**, and workers are created
through a factory. This is deliberate: `vi.mock` is unusable in this
environment under bun, so dependency injection is the only path to testable
code. It is designed in, not bolted on.

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

**Overhead-now is nearly free.** The worker pool already holds every position;
it needs only an ECI -> ECEF -> topocentric transform to produce azimuth,
elevation and range, then a filter on elevation > 0.

**Pass prediction** gets its own worker: coarse-scan the selected satellite at
30 s steps over 48 hours, detect sign changes in `(elevation - threshold)`, then
bisect to ~1 s precision. Culmination falls out of a golden-section search over
the same interval.

**Visible-pass filtering** is included: a pass is only observable if the
satellite is sunlit while the observer is in darkness. Modest extra geometry,
and it is the difference between a technically-correct listing and one worth
acting on.

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

**Highest-value test: the official SGP4 verification vectors.** Vallado's
*Revisiting Spacetrack Report #3* publishes a suite of elements with expected
state vectors. Running the full path — encode -> decode -> propagate — against
those proves the math end to end, and would catch a Float32 precision mistake in
the encoder.

> **Unverified:** this suite is believed to exist and be public, but the exact
> file and format must be confirmed before the implementation plan depends on
> it. This is the first thing the plan should validate.

Supporting tests:

| Test | Asserts |
|---|---|
| Ingestion golden-file | Fixed GP + SATCAT fixture produces byte-exact `elements.bin` |
| Round-trip | Decoded values within Float32 epsilon of source |
| Hermite interpolation | Interpolated position at *t* within 10 m of direct propagation at *t* |
| Worker partitioning | Property test: slices cover `[0, n)` exactly once |
| Coordinate transforms | ECI -> ECEF -> topocentric against reference values |
| Pass prediction | Contract test on a synthetic circular overhead orbit: rise/set symmetric, culmination ~90 deg elevation |

The pass-prediction test is deliberately written against specified behaviour
rather than mirroring the implementation.

## Module boundaries

| Module | Purpose | Depends on |
|---|---|---|
| `ingest/` | Fetch, join, encode. Node-only, fixture-testable, no browser. | — |
| `format/` | Encode/decode and schema. The contract between halves. | — |
| `propagation/` | `Propagator` interface and worker pool. No Three.js. | `format` |
| `render/` | Three.js scene. No knowledge of SGP4. | `format` |
| `observer/` | Geometry and pass search. No UI. | `propagation` |
| `ui/` | React components. | all |

## Phases

1. **Engine** — ingestion pipeline, globe, 16,578 dots moving correctly,
   validated against SGP4 verification vectors. NaN filtering included.
2. **Interaction** — picking, search, detail panel, orbit trail, ground track,
   regime colour-coding.
3. **Observer** — location, overhead-now, pass prediction with visibility
   filtering, sky view.
4. **Stretch** — `WebGPUPropagator`; Space-Track ingestion for the full catalog.

Phase 2 precedes phase 3: selection is the primary interaction loop, and the
detail panel is a prerequisite for the observer UI to have anywhere to live.

## Stack

React + TypeScript + Vite + vitest, matching the existing house pattern.
Three.js for rendering. Cloudflare Pages for hosting. GitHub Actions for
scheduled ingestion.

## Open questions

1. **SGP4 verification vector format** — confirm before the plan depends on it
   (see Testing).
2. **Visual direction** — "visually striking" is a stated success criterion but
   the aesthetic direction is unspecified. This is an implementation-time
   concern for phase 1, not an architectural gap.
3. **satellite.js throughput** — the worker count and tick rate were designed
   with generous margin rather than measurement. A benchmark early in phase 1
   would replace the margin with a number.
4. **Sky view renderer** — SVG or ECharts. Deferred to phase 3.
5. **Project name** — `apsis` is a working title.

## Risks

| Risk | Mitigation |
|---|---|
| Celestrak blocks or rate-limits ingestion | Build-time fetch means one request per cron run, not per visitor; last-good artifact is retained on failure |
| SGP4 in WGSL proves impractical (deep-space branches are conditional-heavy and hostile to SIMD lanes) | Phase 4 is explicitly a stretch; the worker pool remains the shipped path |
| Texture payload undermines fast first paint | Progressive 2k -> 4k load; measure against the fast-first-paint goal |
