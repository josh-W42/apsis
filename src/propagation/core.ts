import {
  BulkPropagator,
  EciBaseCalculator,
  createSingleThreadRuntime,
  json2satrec,
} from 'satellite.js';
import type { CatalogEntry } from '../catalog/types.ts';

/**
 * The WASM runtime is shared process-wide and never disposed.
 *
 * `runtime.dispose()` calls emscripten's `_exit_runtime()`, which tears the
 * module down permanently: any subsequent `createSingleThreadRuntime()` in the
 * same process throws `ExitStatus`. Verified experimentally. React StrictMode
 * double-invokes effects in development, so a per-core runtime that disposed
 * itself would kill the page on the second mount.
 *
 * One runtime per process is also simply correct here — it holds no
 * per-catalog state; the BulkPropagator does, and that IS disposed.
 */
let sharedRuntime: Promise<Awaited<ReturnType<typeof createSingleThreadRuntime>>> | undefined;

function getRuntime() {
  sharedRuntime ??= createSingleThreadRuntime();
  return sharedRuntime;
}

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

  const runtime = await getRuntime();
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
      // Only the propagator. See the note on sharedRuntime above.
      propagator.dispose();
    },
  };
}
