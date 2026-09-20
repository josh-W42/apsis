import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIngest } from './ingest.ts';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/data');

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'apsis/0.1 (github.com/josh-W42/apsis)' },
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status} ${res.statusText}`);
  return res.text();
}

const { catalogJson, manifest } = await runIngest({ fetchText, now: () => new Date() });

await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/catalog.json`, catalogJson);
await writeFile(`${OUT_DIR}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`wrote ${manifest.objectCount} objects, checksum ${manifest.checksum.slice(0, 12)}`);
