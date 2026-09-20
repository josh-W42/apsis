import { describe, expect, it } from 'vitest';
import { fetchWithRetry, isStale, type FetchDeps } from './load.ts';
import type { Manifest } from './types.ts';

const manifest = (generatedAt: string): Manifest => ({
  generatedAt, objectCount: 16578, source: 'test', checksum: 'x'.repeat(64),
});
const NOW = new Date('2026-09-19T12:00:00Z');

describe('isStale', () => {
  it('accepts an artifact generated hours ago', () => {
    expect(isStale(manifest('2026-09-19T06:00:00Z'), NOW)).toBe(false);
  });

  it('flags an artifact older than the default 72 hours', () => {
    expect(isStale(manifest('2026-09-15T12:00:00Z'), NOW)).toBe(true);
  });

  it('honours a custom threshold', () => {
    expect(isStale(manifest('2026-09-19T06:00:00Z'), NOW, 3)).toBe(true);
  });

  it('treats an unparseable timestamp as stale — freshness unproven is freshness absent', () => {
    expect(isStale(manifest('not a date'), NOW)).toBe(true);
  });

  it('treats a future timestamp as fresh rather than erroring', () => {
    expect(isStale(manifest('2026-09-20T12:00:00Z'), NOW)).toBe(false);
  });
});

describe('fetchWithRetry', () => {
  function deps(responses: (Response | Error)[]) {
    let calls = 0;
    const d = {
      get calls() { return calls; },
      fetchFn: (async () => {
        const next = responses[calls++];
        if (next instanceof Error) throw next;
        return next!;
      }) as unknown as typeof fetch,
      sleep: async () => {},
    };
    return d as FetchDeps & { calls: number };
  }

  it('returns the first successful response without retrying', async () => {
    const d = deps([new Response('ok', { status: 200 })]);
    const res = await fetchWithRetry('/data/catalog.json', d);
    expect(res.status).toBe(200);
    expect(d.calls).toBe(1);
  });

  it('retries a 503 and succeeds on a later attempt', async () => {
    const d = deps([
      new Response('', { status: 503 }),
      new Response('ok', { status: 200 }),
    ]);
    const res = await fetchWithRetry('/data/catalog.json', d);
    expect(res.status).toBe(200);
    expect(d.calls).toBe(2);
  });

  it('retries a thrown network error', async () => {
    const d = deps([new Error('network down'), new Response('ok', { status: 200 })]);
    await expect(fetchWithRetry('/data/catalog.json', d)).resolves.toBeTruthy();
    expect(d.calls).toBe(2);
  });

  it('gives up after the attempt limit and reports the last failure', async () => {
    const d = deps([
      new Response('', { status: 500 }),
      new Response('', { status: 500 }),
      new Response('', { status: 500 }),
    ]);
    await expect(fetchWithRetry('/data/catalog.json', d, 3)).rejects.toThrow(/500/);
    expect(d.calls).toBe(3);
  });

  it('does not retry a 404 — a missing artifact will not appear on its own', async () => {
    const d = deps([new Response('', { status: 404 })]);
    await expect(fetchWithRetry('/data/catalog.json', d)).rejects.toThrow(/404/);
    expect(d.calls).toBe(1);
  });
});
