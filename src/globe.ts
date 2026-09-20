import { createPropagationClient, type Frame } from './propagation/client.ts';
import { sunDirectionEci } from './math/sun.ts';
import { createScene } from './render/scene.ts';
import { createSatellites, TICK_SECONDS } from './render/satellites.ts';
import { alignEpoch, alphaFor, isStaleWindow, nextEpochFor } from './render/schedule.ts';

const TICK_MS = TICK_SECONDS * 1000;

export async function startGlobe(container: HTMLElement): Promise<() => void> {
  const view = createScene(container);

  const syncSun = () => {
    const now = new Date();
    view.setSunDirection(sunDirectionEci(now));
    view.setTime(now);
  };
  syncSun();
  view.frameSun(sunDirectionEci(new Date()));

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

  let alpha = 0;
  let framesRendered = 0;
  view.onFrame(() => {
    framesRendered++;
    alpha = alphaFor(Date.now(), epochA, epochB);
    satellites.setAlpha(alpha);
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

  return () => {
    clearInterval(tickTimer);
    clearInterval(sunTimer);
    client.dispose();
    satellites.dispose();
    view.dispose();
  };
}
