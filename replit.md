# InContact Extractor

Operational console for the NICE/InContact extraction pipeline, pulling Contacts, Agents, and call Recordings from NICE CXone into BigQuery and GCS.

## Run & Operate

- **Run API server**: `pnpm --filter @workspace/api-server run dev`
- **Run control plane**: `pnpm --filter @workspace/control-plane run dev`
- **Build all**: `pnpm run build`
- **Typecheck all**: `pnpm run typecheck`
- **Push DB schema**: `pnpm --filter @workspace/db run push`
- **Required Env Vars**: `GCP_PROJECT_ID`, `GCP_REGION`, `EXTRACTION_JOB_NAME` (for Cloud Run jobs), `DATABASE_URL` (for Drizzle).
- **GCP Project**: `guidewaycare-476802`
- **GCP Secrets**: `inContact-Client-Id`, `inContact-Client-Secret` (in Secret Manager)

## Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: 24 (dev), 20 (CI/Docker)
- **TypeScript**: 5.9
- **API Framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + React Query
- **GCP Services**: BigQuery, Secret Manager, Cloud Storage, Cloud Run, Cloud Scheduler
- **Build Tool**: esbuild (API server), Vite (control plane)

## Where things live

- `/artifacts`: Deployable applications (api-server, control-plane, realtime)
- `/lib`: Shared libraries (DB schema, API spec, generated clients, Zod schemas)
- `/infra`: Terraform for GCP infrastructure
- `/.github/workflows`: CI/CD pipelines
- `/cloud-run`: InContact Cloud Run job configurations
- `/bq`: BigQuery SQL migration scripts
- `/scripts`: Utility scripts
- **DB Schema**: `lib/db/schema.ts`
- **API Spec**: `lib/api-spec/openapi.yaml`
- **Zod Schemas**: `lib/api-zod/src/schemas.ts`, `lib/api-zod/src/enums.ts`

## Architecture decisions

- **Monorepo Structure**: Uses pnpm workspaces for managing multiple applications and shared libraries within a single repository.
- **Dormant Code**: The generic "extraction controller" framework (`lib/execution-engine`) is partially dormant; its UI is unmounted, but backend routes and DB tables remain due to dependencies from InContact daily jobs.
- **Dedicated Realtime App**: A separate `/realtime` React app provides a standalone, supervisor-focused live monitoring dashboard, emphasizing real-time data and distinct UI/UX.
- **Workload Identity Federation**: GitHub Actions use WIF for GCP authentication, minimizing the use of service account keys to local development only.
- **Composite TypeScript Projects**: All packages extend a base `tsconfig.json` with `composite: true`, enabling efficient type-checking across the monorepo via project references.

## Product

- **NICE/InContact Data Extraction**: Pulls Contacts, Agents, and Call Recordings.
- **Daily Job Runs Monitoring**: Tracks the status and events of daily InContact extraction jobs.
- **Call Recording Management**: Includes features for queuing, downloading, and filtering call recordings, plus an **Ad-hoc Recording Pull** card on the Recordings page (campaign + multi-disposition + date range → preview + queue & download via `/bq/queue-recordings/adhoc[/run]`, polled via `/bq/adhoc-download-job-status`).
- **Historical Call-Data Backfill (metadata only)**: "Historical Backfill" card on the InContact → Contacts Daily tab (`POST /incontact/extract-contacts-daily {startDate,endDate}` + `/status`). Extracts per-day (Chicago windows) into raw, one full-rebuild transform at the end; never queues/downloads recordings (`DEFAULT_PENDING_RECORDINGS_FLOOR` also guards the daily queue step). Days with a COMPLETED `extraction_run` for the exact window are skipped, so re-running a range only does missing days.
- **Live Monitoring**: Provides a real-time dashboard for NICE CXone agents, skills, teams, and active calls.
- **Audit Logging**: Comprehensive trail of platform changes and user actions.
- **BigQuery Integration**: Stores extracted data and facilitates reporting/analytics.

## User preferences

- _Populate as you build_

## Gotchas

- **Two separate deploy surfaces**: Replit Publish updates `integration-hub-lisamcdermott.replit.app` only. The Cloud Run control-plane (`control-plane-…-uc.a.run.app`) updates ONLY via GitHub Actions CD on push to `main` of the `github` remote — Replit Publish never touches it. If a user reports missing changes on the `*.a.run.app` URL, check `git log github/main..HEAD` and push (PAT fallback in `.agents/memory/github-connection.md`). Nginx now serves HTML with `Cache-Control: no-cache` and hashed assets as `immutable`, so post-deploy staleness only requires a normal refresh.

- **DB Table Dependency**: Do not drop `extraction_run`, `source_system`, or `endpoint_definition` tables until the InContact daily jobs' state tracking is refactored.
- **Typechecking**: Always run `pnpm run typecheck` from the root to ensure correct type validation across all composite TypeScript projects.
- **Daily vs. Ad-hoc Downloads**: Daily and ad-hoc call recording downloads are mutually exclusive due to in-process locks.
- **Processor is a single-drainer**: `incontact-call-processor` claims queue rows with a plain `ORDER BY … LIMIT 1` (no atomic claim in BigQuery), so concurrent executions grab the same row and duplicate downloads instead of adding throughput (~7 recordings/min regardless). Never trigger extra executions to "speed up" a drain; large backlogs just take hours.
- **Background orchestration dies on Cloud Run scale-down**: even with `--no-cpu-throttling`, an idle api-server instance is stopped minutes after its last request, killing any in-flight background daily-run orchestration (this caused the July 13 "Stalled" run: loader finished, processor trigger was never sent). A self-heal loop (`services/self-heal.ts`, started in `app.ts` boot) runs at boot + every 10 min: marks run rows stuck `running` >90 min as failed, and triggers the processor if queue rows sit `pending` >15 min with no active processor execution. **Corollary (July 15)**: the contacts-daily run record is persisted `completed` immediately after the processor is triggered (the drain self-completes inside the processor job); a best-effort watch only downgrades on definitive processor failure. A dashboard "Failed" with error "orchestration interrupted" on a day where data/recordings clearly landed is likely a pre-fix false alarm — verify via Cloud Run executions + queue state before re-running.
- **Contacts backfill survives Cloud Run scale-down by design, not by keepalive**: the multi-hour backfill loop persists a per-day heartbeat into its `scheduled_job_run` row (jobName `contacts-backfill`, `detail_json.lastProgressAt`); that jobName is EXCLUDED from the 90-min orphan sweep, and the self-heal loop auto-resumes a 'running' row whose heartbeat is >30 min stale with no in-memory loop. The self-ping keepalive in the loop is best-effort only (run.app has no instance affinity). A backfill must be orchestrated on the PROD api-server — the extraction job reads its RUN_ID row from prod Cloud SQL, so dev-triggered runs can't work.
- **Ad-hoc Resume is queue-global, not batch-scoped**: `/bq/adhoc-resume` re-triggers `incontact-call-processor`, which drains rows with `status='pending'` from `staging_call_queue` regardless of `batch_id`. The Resume UI on the Recordings page (`AdhocPullCard` → `BatchProgressPanel`) shows per-batch progress, but the processor itself work-steals across all pending batches. Stale-row threshold for the operator-facing reset/resume is **5 min** (constant `ADHOC_STALE_MINUTES` in `routes/bq.ts`), well under the processor's own 30-min self-reset in `cloud-run/index.js`. The last active batchId is persisted in `localStorage` under `incontact:adhoc:active-batch` so Resume survives page refreshes.
- **InContact Daily Jobs**: Agents pipeline runs at 6:00 AM Chicago, Contacts pipeline at 6:30 AM Chicago. Both use Chicago-local day boundaries.
- **Cloud Scheduler bootstrap**: `incontact-agents-daily` and `incontact-contacts-daily` are auto-synced from `app.ts` on every API server boot. **Reality check (July 2026 outage):** `scheduler-sa@…` from `infra/main.tf` was NEVER created (Terraform unapplied) and the runtime SA cannot create SAs. Prod therefore uses the runtime SA itself (`api-controller-hub-dev@…`) as the jobs' OIDC identity via `SCHEDULER_SERVICE_ACCOUNT`, set in `cd.yml`'s api-server `--set-env-vars` alongside `API_SERVER_URL`. **These two env vars must travel together**: without `API_SERVER_URL`, the sync builds the trigger URL from the project *ID* (`api-server-guidewaycare-476802.us-central1.run.app`) — a non-existent run.app host that Google's frontend 404s (scheduler attempt `status.code=5`), so the daily jobs fire and silently die. Without `SCHEDULER_SERVICE_ACCOUNT`, the app-level OIDC check rejects the scheduler's token with 401 (expects `scheduler-sa@…`). The Replit deployment also runs this boot sync, so both vars must ALSO exist in Replit's shared env vars (they do now). Debugging tip: the Scheduler `jobs.list` API can return an empty first page with only a `nextPageToken` — always `GET` jobs by name before concluding they don't exist.
- **All GCP API clients must pass `getGcpCredentials()`**: On Replit Deployments, `GoogleAuth()` with no args silently falls back to Replit's ambient compute identity (a `roid-…` project), NOT the SA whose key is in `GCP_SERVICE_ACCOUNT_KEY`. Always construct GCP SDK clients (`CloudSchedulerClient`, `JobsClient`, `BigQuery`, `Storage`, `SecretManagerServiceClient`, `GoogleAuth`) by spreading `getGcpCredentials()` from `services/cloud-run.ts` or the equivalent in `services/gcp-clients.ts`. Symptom of forgetting: PERMISSION_DENIED on a project the SA clearly owns, plus a startup log showing `gcpProjectId="roid-..."`.
- **GitHub connection must keep the `workflow` scope**: The Replit ↔ GitHub OAuth connection must be authorized with the `workflow` scope, otherwise commits touching `.github/workflows/*` are silently dropped from pushes to `github/main` (this bit us once with commit fc9d591 / the `migrate-db` CD job). If a workflow edit fails to appear on GitHub after pushing from Replit, reconnect GitHub in Replit's Connections panel and re-grant the `workflow` scope.
- **Cloud SQL schema sync on CD (plain push + guarded SQL + verification)**: `.github/workflows/cd.yml`'s `migrate-db` job runs against Cloud SQL via `cloud-sql-proxy` before the api-server/extraction-job deploy. It (1) applies **guarded idempotent SQL** (adds `uq_endpoint_parameter_name` only if missing — additive, no truncation, fails loudly on real duplicate `(endpoint_id, parameter_name)` rows — and `CREATE TABLE IF NOT EXISTS scheduled_job_run`), (2) prints a read-only prod **drift report**, (3) runs **plain** `pnpm --filter @workspace/db run push` (NO `--force`) with stdin closed, then (4) **verifies convergence** — the build fails unless `push` printed `Changes applied`, no prompt text appeared, and both `scheduled_job_run` + the constraint exist. Adding a new **table/column** in `lib/db/src/schema/*` and merging to `github/main` is sufficient — additive changes apply non-interactively. **Myth corrected (this bit us hard):** `drizzle-kit push --force` does NOT auto-approve everything. `--force` only auto-approves *data-loss* statements; it does NOT answer the interactive "add unique constraint → do you want to truncate?" arrow-key SELECT. On the non-TTY CI runner that prompt gets EOF and `push` **exits 0 having applied NOTHING** (a silent no-op that looks green), and one un-applied constraint blocks the whole push — so `scheduled_job_run` never got created in prod and job-run recording/history silently failed despite green CD. Adding a future **unique/not-null constraint on a populated table** will re-trigger that prompt → EOF-abort → the verify step turns CD red; apply such changes via a guarded idempotent SQL step like the `uq_endpoint_parameter_name` example, not by re-adding `--force`. The Replit dev DB is still synced via `pnpm --filter @workspace/db run push` locally; `push-force` remains in `lib/db/package.json` for deliberate local use only. Note: `drizzle-kit push` prints `[✓] Changes applied` even when zero statements run — it does NOT print "No changes detected", so don't gate checks on that string.

## Pointers

- **Drizzle ORM Docs**: `https://orm.drizzle.team/docs/overview`
- **Zod Docs**: `https://zod.dev/`
- **React Query Docs**: `https://tanstack.com/query/latest/docs/react/overview`
- **shadcn/ui Docs**: `https://ui.shadcn.com/docs`
- **Terraform GCP Provider Docs**: `https://registry.terraform.io/providers/hashicorp/google/latest/docs`
- **GCP Cloud Run Jobs Docs**: `https://cloud.google.com/run/docs/create-jobs`