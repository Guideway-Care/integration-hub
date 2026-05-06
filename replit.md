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
- **Live Monitoring**: Provides a real-time dashboard for NICE CXone agents, skills, teams, and active calls.
- **Audit Logging**: Comprehensive trail of platform changes and user actions.
- **BigQuery Integration**: Stores extracted data and facilitates reporting/analytics.

## User preferences

- _Populate as you build_

## Gotchas

- **DB Table Dependency**: Do not drop `extraction_run`, `source_system`, or `endpoint_definition` tables until the InContact daily jobs' state tracking is refactored.
- **Typechecking**: Always run `pnpm run typecheck` from the root to ensure correct type validation across all composite TypeScript projects.
- **Daily vs. Ad-hoc Downloads**: Daily and ad-hoc call recording downloads are mutually exclusive due to in-process locks.
- **InContact Daily Jobs**: Agents pipeline runs at 6:00 AM Chicago, Contacts pipeline at 6:30 AM Chicago. Both use Chicago-local day boundaries.
- **Cloud Scheduler bootstrap**: `incontact-agents-daily` and `incontact-contacts-daily` are auto-synced from `app.ts` on every API server boot. The runtime SA must hold `roles/cloudscheduler.admin` on the project AND `roles/iam.serviceAccountUser` on `scheduler-sa@…` — otherwise `getJob` returns PERMISSION_DENIED, no fallback creates the job, and the daily extraction silently never fires. Bindings live in `infra/main.tf` for both `api-server-sa` (Cloud Run) and `api-controller-hub-dev` (Replit deploy).

## Pointers

- **Drizzle ORM Docs**: `https://orm.drizzle.team/docs/overview`
- **Zod Docs**: `https://zod.dev/`
- **React Query Docs**: `https://tanstack.com/query/latest/docs/react/overview`
- **shadcn/ui Docs**: `https://ui.shadcn.com/docs`
- **Terraform GCP Provider Docs**: `https://registry.terraform.io/providers/hashicorp/google/latest/docs`
- **GCP Cloud Run Jobs Docs**: `https://cloud.google.com/run/docs/create-jobs`