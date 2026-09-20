/// <reference lib="webworker" />
import { buildIndexEntry } from '../catalog/indexing.ts';
import { fetchWithRetry } from '../catalog/load.ts';
import type { CatalogEntry } from '../catalog/types.ts';
import { createPropagationCore, type PropagationCore } from './core.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

let core: PropagationCore | undefined;
let catalog: CatalogEntry[] = [];

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
      // fetchWithRetry throws a descriptive error on failure.
      const response = await fetchWithRetry(request.catalogUrl);
      catalog = (await response.json()) as CatalogEntry[];
      if (!Array.isArray(catalog) || catalog.length === 0) {
        throw new Error('catalog artifact was empty or malformed');
      }
      core = await createPropagationCore(catalog);
      // Prime once so liveIndices is populated before the first render.
      core.tick(new Date());
      post({
        type: 'ready',
        count: core.count,
        liveIndices: core.liveIndices,
        index: catalog.map(buildIndexEntry),
      });
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
      return;
    }

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
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
});
