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
- Rich filtering and grouping (deferred; constellation colour-coding plus a
  single Starlink dim/hide control ships instead — see *Phase 2*. One control,
  not a filter panel.)
- Mobile and tablet layouts (desktop only; the left rail leaves no globe at
  phone width, and a bottom-sheet variant is not worth the work here)
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
detail panel and the colour-coding, at no cost. (Revision 3 note: apogee and
perigee still drive the GEO-belt bucket and the panel's regime line, but not
the primary colour split — see *Phase 2*.)

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

**Celestrak rate-limits by IP, and it is easy to hit.** A 403 appeared during
probing after only a handful of requests. Revision 1 recorded the cause as
unconfirmed and guessed at the `Accept-Encoding: gzip` header. **Revision 2
confirms it is rate limiting:** a later request from the real ingestion script,
sending only a `User-Agent` and no encoding override, also returned 403 after
that day's repeated fetches.

Budget one GP fetch per ingestion run and no more.

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
detail panel actually consume, with SATCAT metadata pre-joined.

Verified against satellite.js 7.1.0's `io.js`, `json2satrec` reads exactly
eleven fields. `EPHEMERIS_TYPE`, `CLASSIFICATION_TYPE`, `ELEMENT_SET_NO` and
`REV_AT_EPOCH` are read by nothing and are dropped. Measured result: **969 KB
gzipped, 6% smaller than the source GP payload** despite carrying five extra
metadata fields per object. This deletes the
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

**Colour-coding.** Revision 1 specified regime colour-coding (LEO/MEO/GEO/HEO
from SATCAT apogee/perigee) as the legibility measure against Starlink
dominance. **Measurement during phase 2 design showed it does not work:** the
split is LEO 15,763 / GEO 577 / MEO 187 / HEO 51, so 95% of objects are one
colour, and Starlink *is* LEO. `OBJECT_TYPE` is no better — the active group is
PAY 16,576 / R/B 2.

Superseded by constellation colour-coding plus a Starlink toggle. See *Phase 2
— interaction design*.

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
   constellation colour-coding with a Starlink control. Desktop only. See
   *Phase 2 — interaction design*.
3. **Observer** — location, overhead-now, pass prediction with visibility
   filtering, sky view.
Phase 4 (`WebGPUPropagator`) is removed. Scaling to the full tracked catalog is
no longer a phase but a configuration change: add a Space-Track credential to
the ingestion workflow's secrets. No client code changes.

Phase 2 precedes phase 3: selection is the primary interaction loop, and the
detail panel is a prerequisite for the observer UI to have anywhere to live.

## Stack

React + TypeScript + Vite + vitest, matching the existing house pattern.
Three.js for rendering. GitHub Actions for scheduled ingestion.

**Hosting is Firebase Hosting** (project `apsis-globe`, served at
https://apsis-globe.web.app), chosen over Cloudflare Pages because the
author already uses Firebase elsewhere. Nothing in the design depends on the
host: it serves a static `dist/`, and the cache headers that were written as
a Cloudflare `_headers` file now live in `firebase.json`.

## Open questions

1. **Sky view renderer** — SVG or ECharts. Deferred to phase 3.
2. **Project name** — `apsis` is a working title.
3. **Constellation classification is name-pattern based** and will drift as new
   constellations launch and naming changes. It degrades to `other` rather than
   failing, but it is not a durable taxonomy.

*Closed in revision 2:* SGP4 verification vector format (reframed — see
Testing); satellite.js throughput (measured — see Measured findings); whether
cross-origin isolation is required (it is not).

*Closed in revision 3:* visual direction (mission-control; see *Phase 2*);
mobile support (out of scope).

## Risks

| Risk | Mitigation |
|---|---|
| Celestrak blocks or rate-limits ingestion | Build-time fetch means one request per cron run, not per visitor; last-good artifact is retained on failure |
| Celestrak serves a 200 with a non-JSON refusal body | Ingestion validates content before writing; last-good artifact is retained on failure. Observed in practice, not hypothetical |
| `json2satrec` startup cost (274 ms) delays interactivity | Runs in the worker, off the main thread; globe shell renders first |
| Texture payload undermines fast first paint | Progressive 2k -> 4k load; measure against the fast-first-paint goal |

## Implementation findings (phase 1)

Four things surfaced during implementation that the design did not anticipate.
All affect later phases.

**The WASM runtime must never be disposed.** `runtime.dispose()` calls
emscripten's `_exit_runtime()`, which tears the module down *process-wide and
permanently* — every later `createSingleThreadRuntime()` throws `ExitStatus`.
React StrictMode double-invokes effects, so a core disposing its own runtime
kills the page on the second mount. The runtime is cached at module scope and
never disposed; only the `BulkPropagator` is.

**The globe must be tilted into the ECI frame.** three.js `SphereGeometry`
puts its poles on +Y; ECI north is +Z. Satellite positions are ECI, so without
a quarter-turn about X the globe sits 90 degrees out from every orbit. An
untextured sphere looks identical either way, which is precisely why this
needs a regression test rather than a visual check. The globe also rotates by
GMST so geography tracks the terminator — a prerequisite for phase 2's ground
tracks.

**Frame scheduling must derive from the wall clock, not accumulate.** The
first implementation advanced a counter seeded before worker init; the ~300 ms
of catalog fetch and satrec construction put it permanently behind, and alpha
reached 1.7. `setAlpha` clamps, so the visible symptom was dots freezing at the
end of every one-second segment — with no error anywhere. The window
arithmetic now lives in tested pure functions (`src/render/schedule.ts`).

**Vite needs an ES2022 target.** satellite.js's emscripten builds use
top-level await. Vite's default `es2020` target fails during dependency
optimization — including on the pthreads build the app never calls, because
the optimizer parses every entry in the package's `imports` map.

### Verified against orbital mechanics

End-to-end measurement of the running app: a satellite at 7,335 km radius
(964 km altitude) moved 73.8 km in 10.0 s, an implied 7.383 km/s against a
theoretical circular velocity of 7.372 km/s — **0.15% agreement**, with the
small excess explained by chord-versus-arc over the interval.

## Phase 2 — interaction design

Added in revision 3. Phase 1's spec covered phase 2's *mechanism* (GPU picking,
one-period trails, ground tracks) but not its UI surface. This section fills
that gap and corrects the colour-coding decision.

### Scope

Click or search a satellite; see its orbit trail, ground track and a detail
panel. Constellation colour-coding with a Starlink control. **Desktop only.**

### Visual direction

**Mission control**: monospace, dense label/value tables, thin rules, muted
blue-grey on the dark field, green for live values. Chosen with eyes on
mockups. It is an on-theme cliché and was chosen knowing that — the data
genuinely is tabular, and the density suits a 16,578-object catalog.

One rule to keep it a tool rather than a prop: **status chrome must reflect
real state.** The header badge reads `TRACKING`, `ERROR` (non-zero SGP4 error
byte) or `STALE` (manifest aged out). No decorative readouts.

### Layout

A **left rail** holding search, ranked results and the detail panel in one
column, with the globe filling the remainder. The rail is the natural home for
capped search results; docking the panel elsewhere would leave the result list
homeless and force a second surface.

### Search

Ranked, capped and summarised: exact NORAD id, then exact international
designator, then name prefix, then name substring; top 20 shown with an "and
*N* more" line. A full substring scan over all 16,578 names measures **1.61 ms**,
so search runs unthrottled on the main thread with no index structure.

This matters because "starlink" matches **11,114 objects** (67% of the
catalog). Rendering that as a list is not an option.

### Detail panel

Three blocks:

- **Live** — altitude, speed, ground lat/lon. Derived on the main thread from
  the position and velocity buffers it already receives, via `eciToGeodetic`
  and `gstime`. No worker round-trip.
- **Identity** — name, NORAD id, international designator, object type, owner
  (expanded), launch date.
- **Orbit** — apogee, perigee, inclination, period, eccentricity, regime.

**Two altitude conventions coexist and the panel must say so.** SATCAT's
apogee and perigee are heights above the *equatorial* radius (6378.135 km),
while live altitude is height above the *WGS84 ellipsoid*. Away from the
equator the ellipsoid is smaller, so live altitude can legitimately read
higher than apogee — measured for the ISS at −38° latitude: 430.3 km live
against a SATCAT apogee of 422 km, with `|r| − 6378.135 = 422.2` confirming
SATCAT is self-consistent. Unlabelled, this reads as a bug. The panel marks
the SATCAT rows and states the reference.

Live values arrive at 60 fps but the panel writes to the DOM at **~4 Hz**.
Digits changing sixty times a second are unreadable, and the React churn buys
nothing.

Per-object element epoch age was considered and left out. The catalog-wide
stale banner covers gross failure; per-object freshness is one line to add
later if wanted.

### Crossing the worker boundary

The worker owns the catalog; the main thread had no access to names or
metadata. `ready` gains an `index: CatalogIndexEntry[]` parallel to catalog
order — `noradId`, `name`, `intlDesignator`, `objectType`, `owner`,
`ownerName`, `launchDate`, `apogeeKm`, `perigeeKm`, `inclinationDeg`,
`meanMotion`.

Measured **25.4 ms** to structured-clone once at startup. No packing into
typed arrays: phase 1 already demonstrated the cost of optimising a transfer
that measurement says is cheap.

After `ready` there is no further messaging for search or the panel. The one
exception is trail generation (below).

**Three index spaces exist and must not be confused:**

| Space | Range | Used by |
|---|---|---|
| Catalog index `i` | `[0, count)` | `index[]`, `positions[]`, `velocities[]` |
| Live index `j` | `[0, liveIndices.length)` | render buffers, picking |
| — | | `i = liveIndices[j]` |

Getting this backwards selects the wrong satellite silently — plausible output,
no error. It gets a dedicated tested helper.

### Owner expansion

SATCAT owner codes are opaque (`CIS`, `RASC`, `TMMC`, `STCT`); the catalog uses
**99 distinct codes**. Celestrak publishes the authoritative list at
`https://celestrak.org/satcat/sources.php` — HTML, not a data file, but it
parses cleanly to 132 code/name pairs and resolves every code present.

Ingestion parses it and joins `ownerName` into the artifact. Because it is
HTML and can change shape, the parse **requires at least 90 pairs or fails the
run**, leaving the last-good artifact in place. Unknown codes fall through raw.

**Celestrak's list is not exhaustive.** Measured against the live catalog, 3
codes present in SATCAT are absent from the sources page — `JOR`, `KWT` and
`SVK` — affecting 5 objects, which render their raw code. This is accepted
rather than patched: a private override table would reintroduce the drift the
authoritative parse exists to avoid, for 0.03% of the catalog.

### Colour-coding and the Starlink control

**"GEO" means two different things and they must not be conflated.**
`classifyRegime` returns a *regime* (`GEO` = geostationary altitude);
`classifyConstellation` returns a *bucket* (`geo` = the geostationary belt, as
a visual grouping). They are separate namespaces with separate functions and
separate call sites: regime drives the panel's prose, bucket drives colour.

Bucket precedence is **name first, orbit second**: `starlink` → `oneweb` →
`gnss` → `geo` (orbital) → `other`. Because of that ordering the two disagree,
by design: 22 objects at geostationary altitude match GNSS names (BeiDou's
geostationary satellites) and colour as `gnss`, not `geo`.

Measured buckets under that precedence:

| Bucket | Count | Share |
|---|---|---|
| `starlink` | 11,114 | 67.0% |
| `other` | 4,101 | 24.7% |
| `oneweb` | 651 | 3.9% |
| `geo` | 555 | 3.3% |
| `gnss` | 157 | 0.9% |

(The `geo` bucket is 555 rather than the 577 objects at GEO regime, for exactly
the reason above.)

A per-vertex attribute carries the bucket; a five-entry palette resolves it in
the shader. The Starlink control is a uniform that dims or discards those
points — no buffer rebuild.

Hiding 67% of the dots is the single most revealing thing the app does: the GEO
ring and the GNSS shells only become visible once Starlink is out of the way.
This is one control, not the filter panel ruled out in Non-goals.

`classifyConstellation` is name-regex based and will drift as constellations
launch and rename. It degrades to `other`.

### Trails and ground tracks

On selection the worker propagates that one satellite across a full orbital
period at ~200 steps and returns the samples — the only post-`ready` message.

The trail is a line in the ECI frame. The ground track is the same samples
converted to geodetic and parented to the **spin group**, so it stays fixed to
geography while the globe turns. This is phase 1's GMST frame work paying off.

### Picking

GPU colour-ID pass into a 1×1 scissored target at the cursor, points layer
only, encoding the live index into RGB.

It must reuse the **same Hermite vertex path** as the visible render. Picking
against independently computed positions would disagree with what is on screen
within a single frame at 7.6 km/s, and select the wrong object.

### Modules

| Module | Purpose |
|---|---|
| `catalog/search.ts` | Ranked, capped search. Pure. |
| `catalog/regime.ts` | Orbit regime from apogee/perigee. Pure. |
| `catalog/constellation.ts` | Constellation bucket from name + orbit. Pure. |
| `catalog/indexing.ts` | Live-index ↔ catalog-index mapping. Pure. |
| `math/geodetic.ts` | Altitude, speed, ground point. Pure. |
| `render/picking.ts` | GPU colour-ID pass. |
| `render/trail.ts` | Orbit trail and ground track geometry. |
| `ui/Rail.tsx` etc. | Search field, result list, detail panel, legend. |

### Internal sequencing

1. Index message, index-space mapping, search — no globe changes
2. Picking and the detail panel
3. Trails and ground tracks
4. Constellation colour and the Starlink control

Each step is independently demoable.

## Revision history

### Revision 3 — 2026-09-19

Adds *Phase 2 — interaction design* after phase 1 shipped. Phase 1's spec
described phase 2's mechanism but not its UI, and left visual direction as the
top open question.

Corrects one revision-1 decision: **regime colour-coding does not work.**
Measured, the catalog is 95% LEO and 67% Starlink, and `OBJECT_TYPE` is
16,576 payloads to 2 rocket bodies. Replaced with constellation colour-coding
plus a single Starlink dim/hide control.

Resolves visual direction (mission-control, chosen from mockups) and rules
mobile out of scope.

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
