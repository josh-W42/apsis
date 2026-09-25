import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { checkDeployManifest } from './check.ts';

const MANIFEST = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/data/manifest.json');

const raw = await readFile(MANIFEST, 'utf8').catch(() => undefined);
try {
  const m = checkDeployManifest(raw);
  console.log(`predeploy: ${m.objectCount} objects, generated ${m.generatedAt}`);
} catch (err) {
  console.error(`predeploy: refusing to deploy: ${(err as Error).message}`);
  process.exitCode = 1;
}
