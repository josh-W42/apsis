# Deploy on Ingest Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The twice-daily ingest workflow builds and deploys to Firebase Hosting, so the live catalog is never older than the last successful run.

**Architecture:** `ingest.yml` becomes ingest → build → deploy in one job, with no commit step, mirroring zephyr's `refresh.yml`. `public/data/` leaves git. A `hosting.predeploy` guard refuses any deploy whose `dist/data/manifest.json` is missing or empty, which protects against a manual laptop deploy with no data. Design: `docs/superpowers/specs/2026-09-25-deploy-on-ingest-design.md`.

**Tech Stack:** GitHub Actions, `FirebaseExtended/action-hosting-deploy@v0`, Node 24 native type stripping, vitest, pnpm 6.11.0.

**Local pnpm:** the machine has pnpm 12, and the README warns that a newer pnpm rewrites the lockfile. Run every pnpm command as `npx -y pnpm@6.11.0 …`. If pnpm 6 won't run on Node 24 locally, fall back to CI (Task 6) for install/test/build and say so.

**Branch:** `deploy-on-ingest` (already created; the design doc is committed there).

---

### Task 1: Pure predeploy manifest check

**Files:**
- Create: `scripts/predeploy/check.ts`
- Test: `scripts/predeploy/check.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { checkDeployManifest } from './check.ts';

const good = JSON.stringify({
  generatedAt: '2026-09-25T11:39:42.135Z',
  objectCount: 16619,
  source: 'https://celestrak.org/',
  checksum: 'a8ba',
});

describe('checkDeployManifest', () => {
  it('accepts a manifest with objects and returns it', () => {
    expect(checkDeployManifest(good).objectCount).toBe(16619);
  });

  it('rejects a missing manifest', () => {
    expect(() => checkDeployManifest(undefined)).toThrow(/missing/);
  });

  it('rejects invalid JSON', () => {
    expect(() => checkDeployManifest('{not json')).toThrow(/not valid JSON/);
  });

  it('rejects zero objects', () => {
    const empty = JSON.stringify({ ...JSON.parse(good), objectCount: 0 });
    expect(() => checkDeployManifest(empty)).toThrow(/0 objects/);
  });

  it('rejects a manifest without an objectCount', () => {
    expect(() => checkDeployManifest('{}')).toThrow(/objects/);
  });

  it('rejects a manifest without generatedAt', () => {
    const noDate = JSON.stringify({ ...JSON.parse(good), generatedAt: undefined });
    expect(() => checkDeployManifest(noDate)).toThrow(/generatedAt/);
  });
});
```

**Step 2: Run it and confirm it fails**

Run: `npx -y pnpm@6.11.0 exec vitest run scripts/predeploy`
Expected: FAIL, cannot resolve `./check.ts`.

**Step 3: Implement**

```ts
import type { Manifest } from '../../src/catalog/types.ts';

/**
 * Guards a deploy: the build must contain a manifest describing a non-empty
 * catalog. Data is not in git, so a deploy from a checkout that never ran
 * ingest would otherwise publish a site with no satellites.
 */
export function checkDeployManifest(raw: string | undefined): Manifest {
  if (raw === undefined) {
    throw new Error('manifest is missing; run `pnpm run ingest` before building, or deploy through the ingest workflow');
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
```

**Step 4: Run it and confirm it passes**

Run: `npx -y pnpm@6.11.0 exec vitest run scripts/predeploy`
Expected: 6 passed.

**Step 5: Commit**

```bash
git add scripts/predeploy/check.ts scripts/predeploy/check.test.ts
git commit -m "feat(deploy): manifest check for predeploy"
```

---

### Task 2: Predeploy CLI wired into firebase.json

**Files:**
- Create: `scripts/predeploy/run.ts`
- Modify: `firebase.json` (add `predeploy` under `hosting`)

**Step 1: Write the CLI** (same split as `scripts/ingest/run.ts`: pure logic in one file, I/O here)

```ts
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
```

**Step 2: Wire into firebase.json.** Add this as the first key inside `"hosting"`:

```json
"predeploy": ["node scripts/predeploy/run.ts"],
```

**Step 3: Verify both paths by hand**

```bash
rm -rf dist && node scripts/predeploy/run.ts; echo "exit=$?"
```
Expected: `predeploy: refusing to deploy: manifest is missing…`, `exit=1`.

```bash
mkdir -p dist/data && cp public/data/manifest.json dist/data/ && node scripts/predeploy/run.ts; echo "exit=$?"
```
Expected: `predeploy: 16619 objects, generated …`, `exit=0`. Then `rm -rf dist`.

**Step 4: Typecheck**

Run: `npx -y pnpm@6.11.0 run typecheck`
Expected: no errors. (`tsconfig` includes `scripts/`. `process` is imported explicitly because `types` is restricted to `vite/client`.)

**Step 5: Commit**

```bash
git add scripts/predeploy/run.ts firebase.json
git commit -m "feat(deploy): refuse deploys without catalog data"
```

---

### Task 3: Stop tracking public/data

**Files:**
- Modify: `.gitignore`
- Untrack: `public/data/catalog.json`, `public/data/manifest.json`

**Step 1:** Append to `.gitignore`:

```
# Built by `pnpm run ingest`; deployed by the ingest workflow, never committed.
public/data/
```

**Step 2:** `git rm --cached -r public/data` (the local files stay on disk).

**Step 3: Verify**

Run: `git status --short`
Expected: `M .gitignore`, `D public/data/catalog.json`, `D public/data/manifest.json`. `ls public/data` still lists both files.

**Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore(data): stop committing the catalog"
```

---

### Task 4: Ingest workflow builds and deploys

**Files:**
- Modify: `.github/workflows/ingest.yml` (full replacement)

**Step 1: Replace the file**

```yaml
name: Ingest catalog

on:
  schedule:
    # 06:00 and 18:00 UTC. Elements update 1-8x/day per object; twice daily
    # keeps positions well inside the accuracy SGP4 itself supports.
    - cron: '0 6,18 * * *'
  workflow_dispatch:
    inputs:
      deploy:
        description: Deploy to Firebase Hosting
        type: boolean
        default: true

permissions:
  contents: read

concurrency:
  group: ingest
  cancel-in-progress: false

jobs:
  ingest:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 6.11.0

      - uses: actions/setup-node@v4
        with:
          # Node >= 23 required: scripts/**/*.ts run via native type stripping.
          node-version: '24'
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm test

      # Fails on a Celestrak outage or rate-limit refusal; the deploy step is
      # then skipped and the last good release stays live.
      - name: Fetch and rebuild catalog
        run: pnpm run ingest

      - run: pnpm run build

      - name: Deploy
        if: github.event_name == 'schedule' || inputs.deploy
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          firebaseServiceAccount: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
          projectId: ${{ vars.FIREBASE_PROJECT_ID }}
          channelId: live
```

**Step 2: Diff against zephyr's `refresh.yml`.** The Deploy step and the `inputs.deploy` condition should match it line for line. The real validation is Task 6's CI run.

**Step 3: Commit**

```bash
git add .github/workflows/ingest.yml
git commit -m "ci: build and deploy after each ingest"
```

---

### Task 5: Docs

**Files:**
- Modify: `README.md` (Development section, around line 108)
- Modify: `docs/superpowers/specs/2026-09-19-satellite-globe-design.md` (Architecture diagram, around line 152)

**Step 1: README.** Under the `## Development` code block, add:

```markdown
The catalog is not committed. Run `pnpm run ingest` once before `pnpm run dev`.
Production deploys come from the `Ingest catalog` workflow, twice daily or on
demand with `gh workflow run ingest.yml` (`-f deploy=false` for a dry run).
`firebase deploy` refuses to run without `dist/data/manifest.json`.
```

**Step 2: Spec.** Change the diagram's host label from `Static host (Cloudflare Pages)` to `Firebase Hosting (deployed by the same job)`. After the diagram, add one line: `The artifacts are built and deployed in CI and never committed (changed 2026-09-25; see 2026-09-25-deploy-on-ingest-design.md).`

**Step 3: Full local check**

Run: `npx -y pnpm@6.11.0 test && npx -y pnpm@6.11.0 run build && node scripts/predeploy/run.ts`
Expected: all tests pass (208 + 6), build succeeds, and predeploy prints the object count (the local `public/data` is still on disk and gets copied into `dist/`).

**Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-19-satellite-globe-design.md
git commit -m "docs: data is deployed by CI, not committed"
```

---

### Task 6: Credentials and dry run

1. **[user]** Google Cloud console → project `apsis-globe` → IAM & Admin → Service accounts: create `apsis-deployer` with **only** *Firebase Hosting Admin* (zephyr verified this is sufficient for the live channel). Create a JSON key, then from the repo directory run
   `gh secret set FIREBASE_SERVICE_ACCOUNT -R josh-W42/apsis < path\to\key.json`
   and delete the key file.
2. Claude: `gh variable set FIREBASE_PROJECT_ID -R josh-W42/apsis --body apsis-globe`
3. Claude: `git push -u origin deploy-on-ingest`, then open a PR against `main`.
4. Claude: dry run of the branch's workflow:
   `gh workflow run ingest.yml -R josh-W42/apsis --ref deploy-on-ingest -f deploy=false`, then `gh run watch`.
   Expected: green; logs show `wrote N objects`; the Deploy step is skipped.
   (If GitHub rejects the `deploy` input because main's copy doesn't declare it, skip the dry run and rely on Task 7 step 2.)

**Merge conflict to expect:** the old ingest on `main` keeps committing `public/data` until this merges, which gives a modify/delete conflict. Resolve it by keeping the deletion: `git rm --cached -r public/data`.

---

### Task 7: Merge and verify live

1. **[user]** Merge the PR.
2. Claude: `gh workflow run ingest.yml -R josh-W42/apsis -f deploy=true`, then `gh run watch`. Expected: green, and the Deploy step log shows the predeploy line `predeploy: N objects, generated …`.
3. Claude: `curl -s https://apsis-globe.web.app/data/manifest.json` shows that run's `generatedAt`. Open the site in the Browser pane: satellites render, no console errors, no staleness banner.
4. The next scheduled run (06:00 or 18:00 UTC; GitHub often runs these hours late) deploys without intervention. Check with `gh run list -R josh-W42/apsis --limit 2`.
