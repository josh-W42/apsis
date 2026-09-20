import { buildReverseMap, catalogIndexFromLive, liveIndexFromCatalog } from './catalog/indexing.ts';
import { fetchWithRetry, isStale } from './catalog/load.ts';
import type { CatalogIndexEntry, Manifest } from './catalog/types.ts';
import { isClickGesture, type PointerSample } from './input/gesture.ts';
import { liveState, type LiveState } from './math/geodetic.ts';
import { createPicker } from './render/picking.ts';
import { createThrottle } from './ui/throttle.ts';
import { Vector3 } from 'three';
import { createPropagationClient, type Frame } from './propagation/client.ts';
import { sunDirectionEci } from './math/sun.ts';
import { createScene } from './render/scene.ts';
import { SCENE_SCALE } from './render/earth.ts';
import {
  buildBucketAttribute, createSatellites, TICK_SECONDS, type StarlinkMode,
} from './render/satellites.ts';
import { createTrail } from './render/trail.ts';
import { alignEpoch, alphaFor, isStaleWindow, nextEpochFor } from './render/schedule.ts';

const TICK_MS = TICK_SECONDS * 1000;

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
  /** ISO timestamp of the artifact when it is too old to trust, else null. */
  staleSince: string | null;
  index: CatalogIndexEntry[];
  /** Select by catalog index, or null to clear. */
  select(catalogIndex: number | null): void;
  onSelection(listener: (selection: Selection | null) => void): void;
  /** Throttled to 4 Hz. Null when nothing selected, or when not renderable. */
  onLiveState(listener: (state: LiveState | null) => void): void;
  setStarlinkMode(mode: StarlinkMode): void;
}

export async function startGlobe(container: HTMLElement): Promise<GlobeHandle> {
  const view = createScene(container);

  const syncSun = () => {
    const now = new Date();
    view.setSunDirection(sunDirectionEci(now));
    view.setTime(now);
  };
  syncSun();
  view.frameSun(sunDirectionEci(new Date()));

  const manifestResponse = await fetchWithRetry('/data/manifest.json');
  const manifest = (await manifestResponse.json()) as Manifest;

  const worker = new Worker(
    new URL('./propagation/worker.ts', import.meta.url), { type: 'module' },
  );
  const client = createPropagationClient(worker);

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

  const reverseMap = buildReverseMap(liveIndices, count);
  let selected: Selection | null = null;
  const selectionListeners: ((s: Selection | null) => void)[] = [];
  const liveStateListeners: ((s: LiveState | null) => void)[] = [];
  let latestFrame: Frame | null = null;

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
      trail.clear();
    } else {
      client.requestTrail(selected.catalogIndex);
    }
  };

  const satellites = createSatellites(liveIndices, buildBucketAttribute(index, liveIndices));
  view.scene.add(satellites.points);

  // epochA/epochB bracket the interval the shader interpolates across.
  let epochA = 0;
  let epochB = 0;

  client.onFrame((frame: Frame) => {
    latestFrame = frame;
    // A backgrounded tab throttles timers, so on resume the previous epoch
    // can be far in the past. Re-prime rather than interpolating across a
    // gap of unknown size.
    const stale = isStaleWindow(frame.epochMs, epochB, TICK_MS);
    satellites.pushFrame(frame);
    if (stale) {
      satellites.pushFrame(frame);
      epochA = frame.epochMs - TICK_MS;
    } else {
      epochA = epochB;
    }
    epochB = frame.epochMs;
  });

  // Frame scheduling.
  //
  // The invariant: at wall time `t` we must already hold frames for epochs
  // E and E+TICK where E <= t < E+TICK, so the shader always interpolates
  // between two known states instead of extrapolating past the newest one.
  //
  // An earlier version advanced a counter from a timestamp captured before
  // worker init (~300 ms of catalog fetch and satrec construction). That
  // start-up cost made every request permanently late, and because the
  // counter was relative it never recovered — alpha ran past 1.7, which
  // setAlpha clamps, freezing the dots at the end of each segment. Deriving
  // the target from Date.now() on every pump makes the schedule
  // self-correcting instead.
  let lastRequested = -1;

  const pump = () => {
    const target = nextEpochFor(Date.now(), TICK_MS);
    if (target <= lastRequested) return;
    lastRequested = target;
    client.tick(new Date(target));
  };

  // Prime the lower bracket, then request the upper one.
  const aligned = alignEpoch(Date.now(), TICK_MS);
  lastRequested = aligned;
  client.tick(new Date(aligned));
  pump();

  const tickTimer = setInterval(pump, TICK_MS);

  const sunTimer = setInterval(syncSun, 1_000);

  const trail = createTrail(view.scene, view.spinGroup);
  client.onTrail((t) => {
    // A trail that arrived after the selection changed is stale.
    if (t.catalogIndex !== selected?.catalogIndex) return;
    trail.set(t);
  });

  const picker = createPicker({
    renderer: view.renderer,
    camera: view.camera,
    geometry: satellites.geometry,
    uniforms: satellites.uniforms,
  });

  // Pointer down/up rather than click: a drag on the canvas still fires a
  // click on release, so the old listener read every camera rotation as a
  // click on empty space and cleared the selection.
  let pressed: PointerSample | null = null;
  let travelled = 0;
  let lastMove: PointerSample | null = null;

  const onPointerDown = (event: PointerEvent) => {
    pressed = { x: event.clientX, y: event.clientY, t: event.timeStamp };
    lastMove = pressed;
    travelled = 0;
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!pressed || !lastMove) return;
    travelled += Math.hypot(event.clientX - lastMove.x, event.clientY - lastMove.y);
    lastMove = { x: event.clientX, y: event.clientY, t: event.timeStamp };
  };

  const onPointerUp = (event: PointerEvent) => {
    const down = pressed;
    pressed = null;
    lastMove = null;
    if (!down) return;
    const up = { x: event.clientX, y: event.clientY, t: event.timeStamp };
    if (!isClickGesture(down, up, travelled)) return;

    const rect = view.canvas.getBoundingClientRect();
    const liveIndex = picker.pick(up.x - rect.left, up.y - rect.top);
    setSelection(liveIndex === null ? null : catalogIndexFromLive(liveIndices, liveIndex));
  };

  const onPointerCancel = () => { pressed = null; lastMove = null; };

  view.canvas.addEventListener('pointerdown', onPointerDown);
  view.canvas.addEventListener('pointermove', onPointerMove);
  view.canvas.addEventListener('pointerup', onPointerUp);
  view.canvas.addEventListener('pointercancel', onPointerCancel);

  const pumpLiveState = createThrottle(250);
  let alpha = 0;
  let framesRendered = 0;
  view.onFrame(() => {
    framesRendered++;
    alpha = alphaFor(Date.now(), epochA, epochB);
    satellites.setAlpha(alpha);

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

  if (import.meta.env.DEV) {
    // Dev-only probe. The whole point of the Hermite design is that the GPU
    // interpolates between 1 Hz ticks, and that is not something a screenshot
    // can show — so expose enough state to verify it.
    (globalThis as unknown as Record<string, unknown>).__apsis = {
      get alpha() { return alpha; },
      get framesRendered() { return framesRendered; },
      get epochs() { return { epochA, epochB }; },
      get renderable() { return liveIndices.length; },
      get selected() { return selected; },
      /** Bucket distribution actually uploaded to the GPU, for verification. */
      bucketHistogram() {
        const attr = satellites.points.geometry.getAttribute('bucket');
        const h: Record<number, number> = {};
        for (let i = 0; i < attr.count; i++) {
          const b = Math.round(attr.getX(i));
          h[b] = (h[b] ?? 0) + 1;
        }
        return h;
      },
      get starlinkMode() {
        return satellites.uniforms.uStarlinkMode?.value as number;
      },
      /** Trail + ground-track state, for verification. */
      trailInfo() {
        const lines: Record<string, unknown>[] = [];
        for (const [name, parent] of [['trail', view.scene], ['track', view.spinGroup]] as const) {
          for (const child of parent.children) {
            if (!(child as { isLine?: boolean }).isLine) continue;
            const attr = (child as unknown as { geometry: { getAttribute(n: string): {
              count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number;
            } | undefined } }).geometry.getAttribute('position');
            if (!attr) { lines.push({ name, visible: (child as { visible: boolean }).visible, vertices: 0 }); continue; }
            let minR = Infinity, maxR = -Infinity;
            for (let i = 0; i < attr.count; i++) {
              const r = Math.hypot(attr.getX(i), attr.getY(i), attr.getZ(i));
              if (r < minR) minR = r;
              if (r > maxR) maxR = r;
            }
            lines.push({
              name, visible: (child as { visible: boolean }).visible,
              vertices: attr.count,
              radiusMin: +minR.toFixed(4), radiusMax: +maxR.toFixed(4),
            });
          }
        }
        return lines;
      },
      /** Camera position in scene units (earth radii), for occlusion maths. */
      get cameraPosition() {
        const c = view.camera.position;
        return { x: c.x, y: c.y, z: c.z };
      },
      /** Rendered position of a live index in scene units (earth radii). */
      renderedPosition(liveIndex: number) {
        const attr = satellites.points.geometry.getAttribute('position');
        return {
          x: attr.getX(liveIndex) * SCENE_SCALE,
          y: attr.getY(liveIndex) * SCENE_SCALE,
          z: attr.getZ(liveIndex) * SCENE_SCALE,
        };
      },
      /** Run the GPU pick at canvas-relative CSS coordinates. */
      pickAt(x: number, y: number) { return picker.pick(x, y); },
      /**
       * Project the ACTUALLY RENDERED position of a live index — the A
       * endpoint in the geometry buffer — to canvas CSS coordinates. This is
       * what the shader draws at alpha 0, so it is the right thing to compare
       * a pick against.
       */
      projectRendered(liveIndex: number) {
        const attr = satellites.points.geometry.getAttribute('position');
        const v = new Vector3(attr.getX(liveIndex), attr.getY(liveIndex), attr.getZ(liveIndex))
          .multiplyScalar(SCENE_SCALE).project(view.camera);
        const rect = view.canvas.getBoundingClientRect();
        return {
          x: (v.x * 0.5 + 0.5) * rect.width,
          y: (-v.y * 0.5 + 0.5) * rect.height,
          inFront: v.z < 1,
        };
      },
      /** Project a catalog index to canvas-relative CSS coordinates. */
      project(catalogIndex: number) {
        if (latestFrame === null) return null;
        const { positions } = latestFrame;
        const v = new Vector3(
          positions[catalogIndex * 3]!,
          positions[catalogIndex * 3 + 1]!,
          positions[catalogIndex * 3 + 2]!,
        ).multiplyScalar(SCENE_SCALE).project(view.camera);
        const rect = view.canvas.getBoundingClientRect();
        return {
          x: (v.x * 0.5 + 0.5) * rect.width,
          y: (-v.y * 0.5 + 0.5) * rect.height,
          inFront: v.z < 1,
        };
      },
      firstPosition() {
        const a = satellites.points.geometry.getAttribute('position');
        const b = satellites.points.geometry.getAttribute('posB');
        return {
          a: [a.getX(0), a.getY(0), a.getZ(0)],
          b: [b.getX(0), b.getY(0), b.getZ(0)],
        };
      },
    };
  }

  return {
    stop: () => {
      clearInterval(tickTimer);
      clearInterval(sunTimer);
      view.canvas.removeEventListener('pointerdown', onPointerDown);
      view.canvas.removeEventListener('pointermove', onPointerMove);
      view.canvas.removeEventListener('pointerup', onPointerUp);
      view.canvas.removeEventListener('pointercancel', onPointerCancel);
      picker.dispose();
      trail.dispose();
      client.dispose();
      satellites.dispose();
      view.dispose();
    },
    index,
    select: setSelection,
    onSelection(listener) { selectionListeners.push(listener); },
    onLiveState(listener) { liveStateListeners.push(listener); },
    setStarlinkMode: satellites.setStarlinkMode,
    staleSince: isStale(manifest, new Date()) ? manifest.generatedAt : null,
  };
}
