import { describe, expect, it, vi } from 'vitest';
import { createPropagationClient, type WorkerLike } from './client.ts';
import type { CatalogIndexEntry } from '../catalog/types.ts';
import type { WorkerResponse } from './protocol.ts';

/** A hand-written fake, injected — no module mocking. */
function fakeWorker() {
  const handlers: ((e: MessageEvent) => void)[] = [];
  const sent: unknown[] = [];
  const worker: WorkerLike = {
    postMessage: (m) => { sent.push(m); },
    addEventListener: (_t, h) => { handlers.push(h); },
    terminate: () => { sent.push({ type: 'terminated' }); },
  };
  const emit = (data: WorkerResponse) =>
    handlers.forEach((h) => h({ data } as MessageEvent));
  return { worker, sent, emit };
}

describe('createPropagationClient', () => {
  it('sends an init request with the catalog url', async () => {
    const { worker, sent, emit } = fakeWorker();
    const client = createPropagationClient(worker);
    const ready = client.init('/data/catalog.json');
    expect(sent[0]).toEqual({ type: 'init', catalogUrl: '/data/catalog.json' });

    emit({ type: 'ready', count: 3, liveIndices: Uint32Array.from([0, 2]), index: [] });
    await expect(ready).resolves.toEqual({
      count: 3, liveIndices: Uint32Array.from([0, 2]), index: [],
    });
  });

  it('rejects init when the worker reports an error', async () => {
    const { worker, emit } = fakeWorker();
    const client = createPropagationClient(worker);
    const ready = client.init('/data/catalog.json');
    emit({ type: 'error', message: 'catalog 404' });
    await expect(ready).rejects.toThrow(/catalog 404/);
  });

  it('delivers frames to the registered listener', () => {
    const { worker, emit } = fakeWorker();
    const client = createPropagationClient(worker);
    const onFrame = vi.fn();
    client.onFrame(onFrame);

    const frame = {
      type: 'frame' as const,
      positions: Float32Array.from([1, 2, 3]),
      velocities: Float32Array.from([4, 5, 6]),
      epochMs: 1_000,
    };
    emit(frame);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame.mock.calls[0]![0].epochMs).toBe(1_000);
    expect(Array.from(onFrame.mock.calls[0]![0].positions)).toEqual([1, 2, 3]);
  });

  it('requests a tick for the given epoch', () => {
    const { worker, sent } = fakeWorker();
    createPropagationClient(worker).tick(new Date(1_700_000_000_000));
    expect(sent[0]).toEqual({ type: 'tick', epochMs: 1_700_000_000_000 });
  });

  it('terminates the worker on dispose', () => {
    const { worker, sent } = fakeWorker();
    createPropagationClient(worker).dispose();
    expect(sent).toContainEqual({ type: 'terminated' });
  });

  it('logs rather than throwing when an error arrives after ready', async () => {
    const { worker, emit } = fakeWorker();
    const client = createPropagationClient(worker);
    const ready = client.init('/data/catalog.json');
    emit({ type: 'ready', count: 1, liveIndices: Uint32Array.from([0]), index: [] });
    await ready;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => emit({ type: 'error', message: 'one bad tick' })).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});


const indexEntry = (noradId: number, name: string): CatalogIndexEntry => ({
  noradId, name, intlDesignator: '1998-067A', objectType: 'PAY',
  owner: 'ISS', ownerName: 'International Space Station',
  launchDate: '1998-11-20', apogeeKm: 422, perigeeKm: 416,
  inclinationDeg: 51.63, meanMotion: 15.5,
});

describe('createPropagationClient index', () => {
  it('surfaces the catalog index from ready', async () => {
    const { worker, emit } = fakeWorker();
    const client = createPropagationClient(worker);
    const ready = client.init('/data/catalog.json');
    const index = [indexEntry(25544, 'ISS (ZARYA)'), indexEntry(44713, 'STARLINK-1007')];
    emit({ type: 'ready', count: 2, liveIndices: Uint32Array.from([0, 1]), index });

    const info = await ready;
    expect(info.index).toHaveLength(2);
    expect(info.index[0]!.name).toBe('ISS (ZARYA)');
    expect(info.index[1]!.noradId).toBe(44713);
  });
});
