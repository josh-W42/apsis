import type { Manifest } from './types.ts';

const DEFAULT_MAX_AGE_HOURS = 72;

/**
 * Is the committed artifact too old to present without warning?
 *
 * Ingestion runs twice daily, so anything past three days means the workflow
 * has been failing. An unparseable timestamp counts as stale: freshness that
 * cannot be proven is freshness we do not have.
 */
export function isStale(
  manifest: Manifest, now: Date, maxAgeHours = DEFAULT_MAX_AGE_HOURS,
): boolean {
  const generated = Date.parse(manifest.generatedAt);
  if (Number.isNaN(generated)) return true;
  const ageHours = (now.getTime() - generated) / 3_600_000;
  return ageHours > maxAgeHours;
}

export interface FetchDeps {
  fetchFn: typeof fetch;
  sleep(ms: number): Promise<void>;
}

export const defaultFetchDeps: FetchDeps = {
  fetchFn: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Fetch with exponential backoff.
 *
 * 4xx responses are not retried: a missing or forbidden artifact will not
 * fix itself, and retrying only delays the error the user needs to see.
 */
export async function fetchWithRetry(
  url: string, deps: FetchDeps = defaultFetchDeps, attempts = 3,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await deps.sleep(250 * 2 ** (attempt - 1));
    try {
      const response = await deps.fetchFn(url);
      if (response.ok) return response;
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`${url} responded ${response.status} (not retryable)`);
      }
      lastError = new Error(`${url} responded ${response.status}`);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      if (/not retryable/.test(e.message)) throw e;
      lastError = e;
    }
  }
  throw lastError ?? new Error(`${url} failed after ${attempts} attempts`);
}
