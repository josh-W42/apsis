import type { CatalogIndexEntry } from '../catalog/types.ts';

export type WorkerRequest =
  | { type: 'init'; catalogUrl: string }
  | { type: 'tick'; epochMs: number }
  | { type: 'trail'; catalogIndex: number; epochMs: number };

export type WorkerResponse =
  | {
      type: 'ready';
      count: number;
      liveIndices: Uint32Array;
      index: CatalogIndexEntry[];
    }
  | { type: 'frame'; positions: Float32Array; velocities: Float32Array; epochMs: number }
  | {
      type: 'trail';
      catalogIndex: number;
      /** ECI km, packed [x,y,z] per sample, one full orbital period. */
      samples: Float32Array;
      /** Wall-clock epoch of each sample, parallel to `samples`. */
      epochMs: Float64Array;
      periodMinutes: number;
    }
  | { type: 'error'; message: string };
