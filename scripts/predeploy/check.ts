import type { Manifest } from '../../src/catalog/types.ts';

/**
 * Guards a deploy: the build must contain a manifest describing a non-empty
 * catalog. Data is not in git, so a deploy from a checkout that never ran
 * ingest would otherwise publish a site with no satellites.
 */
export function checkDeployManifest(raw: string | undefined): Manifest {
  if (raw === undefined) {
    throw new Error(
      'manifest is missing; run `pnpm run ingest` before building, or deploy through the ingest workflow',
    );
  }
  let manifest: Partial<Manifest>;
  try {
    manifest = JSON.parse(raw) as Partial<Manifest>;
  } catch {
    throw new Error('manifest is not valid JSON');
  }
  if (typeof manifest.objectCount !== 'number' || manifest.objectCount <= 0) {
    throw new Error(`manifest reports ${manifest.objectCount ?? 'no'} objects`);
  }
  if (typeof manifest.generatedAt !== 'string') {
    throw new Error('manifest has no generatedAt');
  }
  return manifest as Manifest;
}
