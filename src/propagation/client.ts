import type { WorkerRequest, WorkerResponse } from './protocol.ts';

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', handler: (event: MessageEvent) => void): void;
  terminate(): void;
}

export interface ReadyInfo {
  count: number;
  liveIndices: Uint32Array;
}

export interface Frame {
  positions: Float32Array;
  velocities: Float32Array;
  epochMs: number;
}

export interface PropagationClient {
  init(catalogUrl: string): Promise<ReadyInfo>;
  tick(date: Date): void;
  onFrame(listener: (frame: Frame) => void): void;
  dispose(): void;
}

/**
 * Main-thread wrapper around the propagation worker.
 *
 * The worker is injected rather than constructed here so this module can be
 * tested with a hand-written fake, per the project's no-`vi.mock` constraint.
 */
export function createPropagationClient(worker: WorkerLike): PropagationClient {
  let resolveReady: ((info: ReadyInfo) => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  const frameListeners: ((frame: Frame) => void)[] = [];

  worker.addEventListener('message', (event: MessageEvent) => {
    const message = event.data as WorkerResponse;
    switch (message.type) {
      case 'ready':
        resolveReady?.({ count: message.count, liveIndices: message.liveIndices });
        break;
      case 'frame':
        for (const listener of frameListeners) {
          listener({
            positions: message.positions,
            velocities: message.velocities,
            epochMs: message.epochMs,
          });
        }
        break;
      case 'error':
        // An error before ready rejects init; after ready it surfaces on the
        // console, because a single bad tick must not tear down the globe.
        if (rejectReady) rejectReady(new Error(message.message));
        else console.error('[propagation]', message.message);
        break;
    }
  });

  const send = (request: WorkerRequest) => worker.postMessage(request);

  return {
    init(catalogUrl) {
      const promise = new Promise<ReadyInfo>((resolve, reject) => {
        resolveReady = (info) => { resolveReady = undefined; rejectReady = undefined; resolve(info); };
        rejectReady = (error) => { resolveReady = undefined; rejectReady = undefined; reject(error); };
      });
      send({ type: 'init', catalogUrl });
      return promise;
    },
    tick(date) { send({ type: 'tick', epochMs: date.getTime() }); },
    onFrame(listener) { frameListeners.push(listener); },
    dispose() { worker.terminate(); },
  };
}
