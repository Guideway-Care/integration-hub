# Integration Hub

## Overview

Unified integration platform combining the Ingestion Controller Hub (generic API extraction pipeline) and InContact Call Recordings downloader into a single pnpm workspace monorepo. Target GCP project: `guidewaycare-476802`.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24 (dev), 20 (CI/Docker)
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + React Query
- **GCP Services**: BigQuery, Secret Manager, Cloud Storage, Cloud Run, Cloud Scheduler
- **Build**: esbuild (CJS bundle for API server), Vite (control plane)

## Structure

```text
integration-hub/
├── artifacts/                  # Deployable applications
│   ├── api-server/             # Express API server (port 8080)
│   └── control-plane/          # React+Vite frontend dashboard
├── lib/                        # Shared libraries
│   ├── api-spec/               # OpenAPI spec + Orval codegen config
│   ├── api-client-react/       # Generated React Query hooks
│   ├── api-zod/                # Zod schemas (enums.ts, schemas.ts)
│   └── db/                     # Drizzle ORM schema + DB connection
├── infra/                      # Terraform (GCP infra-as-code)
├── .github/workflows/          # CI/CD pipelines
├── cloud-run/                  # InContact Cloud Run job configs
├── bq/                         # BigQuery SQL migration scripts
├── scripts/                    # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

## GCP Configuration

- **Project**: `guidewaycare-476802`
- **Region**: `us-central1`
- **InContact BQ Dataset**: `incontact`
- **InContact GCS Bucket**: `incontact-audio`
- **InContact Secrets**: `inContact-Client-Id`, `inContact-Client-Secret` in Secret Manager
- **Cloud Run Jobs**: `incontact-call-processor`, `incontact-call-loader`, `extraction-job`
- **Service Accounts**: `api-server-sa`, `extraction-job-sa`, `incontact-job-sa`, `scheduler-sa`
- **Env Vars**: `GCP_PROJECT_ID`, `GCP_REGION`, `EXTRACTION_JOB_NAME`
- **Auth**: Workload Identity Federation (WIF) for GitHub Actions; service account keys only for local dev

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`).
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. All routes mount at `/api`.

- **Entry**: `src/index.ts` — reads `PORT`, starts Express
- **App setup**: `src/app.ts` — CORS, JSON parsing, error handler, routes at `/api`
- **Middleware**: `src/middlewares/error-handler.ts` — centralized error handling
- **Services**:
  - `src/services/gcp-clients.ts` — BigQuery, Secret Manager, Storage, Cloud Run clients
  - `src/services/cloud-run.ts` — Cloud Run job execution service
- **Routes** (`src/routes/`):
  - `dashboard.ts` — Aggregated summary metrics (DB + BigQuery)
  - `audit.ts` — Audit log entries with filtering/pagination; exports `logAudit()` helper
  - `export.ts` — CSV/JSON data export for recordings and staging queue
  - `source-systems.ts` — CRUD for source systems (audit-logged)
  - `endpoints.ts` — CRUD for endpoint definitions (audit-logged)
  - `parameters.ts` — CRUD for endpoint parameters
  - `runs.ts` — Extraction run management with audit logging (create, cancel, replay, detail with events)
  - `scheduler.ts` — Cloud Scheduler sync
  - `monitor.ts` — BigQuery contact daily counts for heatmap
  - `incontact.ts` — InContact API proxy (auth test, fetch, endpoints list)
  - `bq.ts` — BigQuery staging queue management (summary, add, reset, recordings, queue-recordings, download pipeline orchestration with loader→processor sequencing)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle

### `artifacts/control-plane` (`@workspace/control-plane`)

React + Vite frontend dashboard. "API Controller Hub" branding throughout.

- **Layout**: Sidebar navigation with 10 sections
- **Pages**:
  - Dashboard — Homepage with summary metrics cards, extraction pipeline stats, InContact staging health, recent runs (skeleton loading)
  - Source Systems — CRUD cards for API source systems (toast notifications on create/update/delete)
  - Endpoints — Table with method badges, pagination/incremental config
  - Runs — Table with status badges, cancel/replay actions (toast notifications, skeleton loading, error state)
  - Run Detail — Metrics cards + event log timeline
  - Run New — Form to trigger manual extraction runs (toast on success/error)
  - Monitor — BigQuery contact volume heatmap
  - InContact — Unified pipeline page with tabs: Pipeline (4-step flow: Retrieve → Transform → Queue → Download, with Run Now buttons, date filters, monthly calendar grid with DOW averages), Staging Queue (queue management + job triggers), Recordings (call recordings table), API Explorer (raw API testing)
  - Audit Log — Filterable audit trail of all platform changes with pagination (skeleton loading)
  - Scripts — Copiable BigQuery SQL setup scripts
- **Shared components**: `table-skeleton.tsx` (TableSkeleton, CardSkeleton, MetricsSkeleton)
- **Toast system**: shadcn/ui toast with `useToast` hook, Toaster mounted in App.tsx
- **API Client**: `src/lib/api.ts` — fetch wrapper proxied to API server via Vite
- Vite proxy: `/api` → `http://0.0.0.0:8080`

### `lib/execution-engine` (`@workspace/execution-engine`)

Extraction engine that runs as a Cloud Run Job. Ported from the original Pipeline-API-Ingestion-Controller repo.

- **Entry**: `src/index.ts` — reads `RUN_ID` env var, connects to PostgreSQL, calls `executeRun()`
- **Orchestrator**: `src/orchestrator.ts` — looks up run/endpoint/source-system/parameters from DB, authenticates, paginates, writes to BigQuery, tracks progress
- **BigQuery Writer**: `src/bq-writer.ts` — writes raw API response pages to `raw.api_payload` table with SHA-256 hash, retry logic
- **Paginator**: `src/paginator.ts` — supports NONE, PAGE_NUMBER, OFFSET_LIMIT, NEXT_TOKEN strategies
- **Auth Manager**: `src/auth.ts` — resolves credentials from Secret Manager, handles OAuth2 token caching/refresh, API key, Basic, Bearer auth
- **Rate Limiter**: `src/rate-limiter.ts` — rate limiting with exponential/linear/fixed backoff, 429 retry
- **Event Logger**: `src/event-logger.ts` — writes structured events to `extraction_event` table
- **Build**: esbuild → `dist/index.mjs`
- **Docker**: `docker/extraction-job.Dockerfile` — Cloud Run Job container
- Depends on: `@workspace/db`

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports pool, db client, and schema.

- **Tables**: `sourceSystem`, `endpointDefinition`, `endpointParameter`, `extractionRun`, `extractionEvent`, `auditLog`
- `drizzle.config.ts` — requires `DATABASE_URL`
- Push schema: `pnpm --filter @workspace/db run push`

### `lib/api-zod` (`@workspace/api-zod`)

Zod validation schemas for all CRUD operations. Uses `zod/v4`.

- `src/enums.ts` — authType, httpMethod, paginationStrategy, incrementalStrategy, runStatus, runType, eventType, severity
- `src/schemas.ts` — Insert/Update/Select schemas for all entities

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec and Orval codegen config.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks from the OpenAPI spec.

### `scripts` (`@workspace/scripts`)

Utility scripts. Run via `pnpm --filter @workspace/scripts run <script>`.

## Infrastructure

### Terraform (`infra/`)

Provisions all GCP resources:
- Cloud SQL (Postgres 15), VPC, subnets
- Artifact Registry (Docker)
- Service accounts with IAM bindings
- Workload Identity Federation for GitHub Actions
- BigQuery datasets (`raw`, `incontact`)
- Cloud Storage bucket (`incontact-audio`)
- Secret Manager secrets

Variables: `project_id` (default: `guidewaycare-476802`), `region`, `db_tier`, `db_ha`, `github_repo`

### GitHub Actions (`.github/workflows/`)

- **CI** (`ci.yml`): Typecheck, build, Docker build test on PRs
- **CD** (`cd.yml`): Build/push images, deploy API server + control plane + extraction job + InContact jobs, sync Cloud Scheduler

### Cloud Run Jobs (`cloud-run/`)

- `job.yaml` — InContact call processor (fetches + uploads recordings)
- `job-loader.yaml` — InContact call loader (BigQuery load)
- `incontact-processor.Dockerfile` — Docker image for both jobs

### BigQuery Scripts (`bq/`)

Numbered migration scripts (parameterized with `${GCP_PROJECT_ID}`):
1. `staging_call_queue` table
2. `call_recordings` table
3. `v_pending_downloads` view
4. `v_download_summary` view
5. `incontact` dataset creation

Deploy: `./bq/deploy.sh`

## Development

```bash
# Start API server
pnpm --filter @workspace/api-server run dev

# Start control plane (auto-proxies to API server)
pnpm --filter @workspace/control-plane run dev

# Push DB schema
pnpm --filter @workspace/db run push

# Typecheck everything
pnpm run typecheck
```

