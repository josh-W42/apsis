export type WorkerRequest =
  | { type: 'init'; catalogUrl: string }
  | { type: 'tick'; epochMs: number };

export type WorkerResponse =
  | { type: 'ready'; count: number; liveIndices: Uint32Array }
  | { type: 'frame'; positions: Float32Array; velocities: Float32Array; epochMs: number }
  | { type: 'error'; message: string };
