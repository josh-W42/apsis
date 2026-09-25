# Deploy on ingest

**Date:** 2026-09-25
**Status:** approved

## Problem

`ingest.yml` refreshes `public/data/` twice daily and commits it to `main`, but
nothing builds or deploys. The live site only picks up new elements when someone
runs `firebase deploy` by hand, so the data goes stale.

Adding a separate deploy-on-push workflow would not fix it: pushes made with
`GITHUB_TOKEN` do not trigger other workflows.

Committing the data has a second cost. `manifest.generatedAt` changes every run,
so every run commits a fresh 8 MB `catalog.json`. That is two commits a day,
forever, in a public repo.

## Decision

Follow zephyr's pattern: ingest, build and deploy in one job, and stop committing
the data. What gets deployed is exactly what that run fetched.

Rejected:

- **Keep the commit and add deploy after it.** Smallest diff, but the repo keeps
  growing by roughly 8 MB of history a day for no reader.
- **Separate `deploy.yml` on `workflow_run`.** Adds deploy-on-push for code, but
  it is another moving part and still has to decide the commit question.

## Workflow

`ingest.yml` becomes:

1. checkout, pnpm, node 24, `pnpm install --frozen-lockfile`
2. `pnpm test`
3. `pnpm run ingest`
4. `pnpm run build`
5. `FirebaseExtended/action-hosting-deploy@v0` to channel `live`, using
   `secrets.FIREBASE_SERVICE_ACCOUNT` and `vars.FIREBASE_PROJECT_ID`
   (`apsis-globe`)

- `permissions: contents: read` (was `write`; nothing is pushed any more).
- Cron unchanged: `0 6,18 * * *`.
- `workflow_dispatch` gains a `deploy` boolean (default true) so the pipeline can
  be exercised without publishing. Scheduled runs always deploy.

## Data leaves git

- `git rm --cached -r public/data` and ignore `public/data/`.
- No history rewrite. The repo is public and 11.6 MB; a force-push costs more
  than it saves. Growth stops from here.
- Local development needs `pnpm run ingest` once before `pnpm dev`.

## Failure behaviour

- **Celestrak down or rate-limiting the runner.** Ingestion already validates the
  body, not just the status, and throws. The job fails before the deploy step,
  the last good release stays live, and the staleness banner covers the gap.
- **Manual deploy from a laptop.** With data no longer in git, `firebase deploy`
  would publish whatever is in the local `public/data`, stale or missing, and
  replace the live release. A `hosting.predeploy` check in `firebase.json` fails
  the deploy if `dist/data/manifest.json` is absent. The convention is: deploy
  through the workflow. A code-only deploy is a `workflow_dispatch`, which also
  costs one extra Celestrak fetch; acceptable at human frequency.

## One-time setup

- A service account on `apsis-globe` with **Firebase Hosting Admin** only, its key
  stored as the `FIREBASE_SERVICE_ACCOUNT` repository secret.
- `FIREBASE_PROJECT_ID` repository variable set to `apsis-globe`.

## Docs

- README Development section: data is not committed; run ingest before dev.
- Satellite-globe spec: note the data is deployed by the workflow, not committed.
- The phase 1/2 plans are historical and stay as written.

## Verification

1. `workflow_dispatch` with `deploy=false`: tests, ingest and build pass on CI.
2. `workflow_dispatch` with `deploy=true`: `https://apsis-globe.web.app/data/manifest.json`
   shows that run's `generatedAt`, and the globe loads.
3. The next scheduled run deploys on its own.

## Out of scope

- Bumping `actions/*@v4` past the Node 20 deprecation warning.
