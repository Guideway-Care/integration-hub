# Follow-ups

Deferred work captured from the scheduled-agents-pipeline task. Pick up when ready.

## Security hardening (api-server / scheduled job)

Code review surfaced these. None block correct operation today.

### High priority
- **Auth bypass via `trigger` body switch** — `POST /incontact/agents-daily-job` only enforces OIDC when `req.body.trigger === "scheduled"`. A caller can POST `{"trigger":"manual"}` with no token and run the same pipeline. Today this matches the rest of api-server's posture (the service is `--allow-unauthenticated`), but it should be closed.
  - **Fix (small, ~45 min):** Split into two routes:
    - `/incontact/agents-daily-job/scheduled` — OIDC required, audience pinned to a fixed `API_SERVER_URL`, SA email pinned to a single value (no comma-list, no header-derived audiences).
    - `/incontact/agents-daily-job/manual` — UI button hits this; no auth change.
    - Update Cloud Scheduler target URL to the new `/scheduled` path.
  - **Files:** `artifacts/api-server/src/routes/incontact.ts`, `artifacts/control-plane/src/pages/incontact.tsx`.
  - Cloud Scheduler edit:
    ```bash
    gcloud scheduler jobs update http incontact-agents-daily --location=us-central1 \
      --uri="https://api-server-g3tph2rhoa-uc.a.run.app/api/incontact/agents-daily-job/scheduled" \
      --oidc-token-audience="https://api-server-g3tph2rhoa-uc.a.run.app/api/incontact/agents-daily-job/scheduled"
    ```

### Medium priority
- **Full Cloud Run lockdown (large, 1–2 days)** — Make api-server reject anonymous traffic at the Cloud Run boundary.
  - Replace control-plane's `serve = "static"` with a Node serve script (Express + `serve-static`) that proxies `/api/*` to api-server with an OIDC token minted from the metadata server.
  - Grant `roles/run.invoker` on api-server to:
    - control-plane runtime SA: `21503686665-compute@developer.gserviceaccount.com`
    - scheduler SA: `api-controller-hub-dev@guidewaycare-476802.iam.gserviceaccount.com`
  - Then: `gcloud run services remove-iam-policy-binding api-server --region=us-central1 --member=allUsers --role=roles/run.invoker`
  - Files: `artifacts/control-plane/.replit-artifact/artifact.toml`, new `artifacts/control-plane/server.mjs`.

- **Distributed single-flight for the daily job** — Today's in-memory guard (`agentsScheduledJob.status === "running"`) only protects one Cloud Run instance. With multi-instance serving you could race on the same target date.
  - **Fix:** Postgres job-lock table keyed on `(job_name, target_date)` with `INSERT … ON CONFLICT DO NOTHING` to atomically claim a run.
  - Files: a new migration in `lib/<db lib>` + claim/release in `artifacts/api-server/src/routes/incontact.ts`.

- **Transform-wait timeout** — The poll loop in `runAgentsDailyExtraction` chain (waiting for the BQ transform job) has no upper bound. If a transform wedges in `running`, the scheduled job stays stuck.
  - **Fix:** add a 30-min timeout; mark the run failed and surface in `/status`.

### Low priority
- **Status endpoint authoritative across instances** — `/incontact/agents-daily-job/status` reflects in-memory state only. Multi-instance Cloud Run could report `idle` on instance B while instance A is mid-run. Backed by the same job-lock table above this becomes accurate.

## UI

- **"Next-up target" label semantics** — On the `Scheduled Daily Run` card in the InContact page, the displayed target date is computed as "yesterday relative to *now*", which is misleading after the morning run completes (e.g., on 5/5 afternoon it shows `2026-05-04` even though tomorrow's fire will target `2026-05-05`).
  - **Fix (small, ~10 min):** Change the label to show the date that the *next scheduled fire* will target. For a 6 AM Chicago daily schedule that's "yesterday relative to the next 6 AM Chicago boundary". Wording suggestion: `next run (2026-05-06 06:00 CT) will process 2026-05-05`.
  - File: `artifacts/control-plane/src/pages/incontact.tsx` (the `ScheduledAgentsJobPanel` component).

## CI

- **Baseline CI job fails on every commit at the `pnpm install` step.** CD is unaffected and succeeds. Worth diagnosing so green-checks are meaningful again.
