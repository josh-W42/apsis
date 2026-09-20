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
