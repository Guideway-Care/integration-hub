---
name: Cloud Scheduler daily-jobs outage lessons
description: Why the InContact daily scheduler jobs silently failed for days and the traps to avoid when debugging Cloud Scheduler + Cloud Run OIDC.
---

# Cloud Scheduler daily jobs — outage lessons (July 2026)

**The rule:** `API_SERVER_URL` and `SCHEDULER_SERVICE_ACCOUNT` must both be set on the prod api-server (via `cd.yml` `--set-env-vars`), and always together.

**Why:** The boot-time scheduler sync builds the trigger URL from `API_SERVER_URL`, falling back to `https://api-server-<PROJECT_ID>.<region>.run.app` — but real run.app hosts use the project *number* (or hash), so the fallback host doesn't exist. Google's frontend still resolves `*.run.app` and returns HTTP 404, which Cloud Scheduler records as attempt `status.code=5` — the job "fires" daily and silently dies. Meanwhile the app's OIDC check defaults to expecting `scheduler-sa@…`, an SA that was never created (Terraform in `infra/` was never applied, and the runtime SA lacks `iam.serviceAccounts.create`). Setting only `SCHEDULER_SERVICE_ACCOUNT` lets boot sync's `updateJob` succeed — and rewrite the job URL back to the bogus fallback.

**How to apply:** Any change to api-server env vars, the scheduler sync, or the OIDC verification must keep both vars in `cd.yml` in lockstep. The jobs' OIDC identity is the runtime SA itself (`api-controller-hub-dev@…`), not `scheduler-sa`.

**Two boot-sync surfaces:** The Replit deployment (`*.replit.app`) also runs the boot sync in production mode and *its* `updateJob` succeeds (its `SCHEDULER_SERVICE_ACCOUNT` lives in Replit shared env vars) — with `API_SERVER_URL` missing there it was the surface rewriting the jobs to the bogus URL on every publish/restart. Both vars must exist in Replit shared env AND in `cd.yml`.

**Debugging traps:**
- Cloud Scheduler `jobs.list` can return an empty first page with only a `nextPageToken`. GET jobs by name before concluding they don't exist.
- `createJob` validates the OIDC service account *before* name collisions: a missing OIDC SA returns 404 NOT_FOUND even when the job already exists (masking the 409).
- Scheduler attempt codes map from HTTP: 5=404 (bad host/path), 16=401, 7=403, 2=other/5xx.
- The local `GCP_SERVICE_ACCOUNT_KEY` SA **is** the prod runtime SA, so scheduler failures can be reproduced exactly from the workspace, including minting OIDC tokens (`auth.getIdTokenClient(uri)`) to replay a scheduler request against prod.
- The runtime SA cannot read prod logs (`logging` 403) or project IAM policy; debug via the Scheduler/Run/IAM APIs instead.
