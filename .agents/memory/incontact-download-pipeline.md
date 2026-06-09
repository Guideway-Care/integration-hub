---
name: InContact recording download pipeline orchestration
description: How the daily Download Recordings pipeline drains the staging queue self-sufficiently inside the Cloud Run job, and the lock/completion model the api-server uses around it.
---

# InContact recording download pipeline

The daily "Download Recordings" step (API route `/bq/run-job`) runs the loader once
(`incontact-call-loader`: call_list.txt → staging queue), waits for it, then triggers
the processor (`incontact-call-processor`) **exactly once**. The processor itself
drains the entire staging queue; the api-server does NOT loop.

## Design decision: continuation lives inside the Cloud Run job, not the api-server

**Why:** the old api-server multi-pass loop ran in the Express background AFTER the
HTTP response returned, so on Cloud Run it had no guaranteed CPU/lifetime for the many
hours a large queue needs (per-call download ~10–15s, so 7k pending ≈ ~20h). Symptom
was "operator clicks Run, no new executions appear, queue never finishes." A long-lived
background promise is the wrong tool for a multi-hour drain.

**How it works now:**
- Processor has **no batch cap**: `BATCH_LIMIT` defaults to `0` = unlimited. The
  download loop runs until `getNextPendingCall()` returns nothing (`pending == 0`).
- Processor **exits 0 on a fully-drained queue even if some recordings failed**
  (failed rows are left in `status='failed'` for separate inspection/retry). Only a
  genuine fatal error exits non-zero (via the top-level `.catch`). This is the opposite
  of the old behavior — do NOT reintroduce `process.exit(1) when failedCount>0`, it
  would trigger a pointless Cloud Run retry of an already-drained queue.
- Job config gives the single execution room to finish: `task-timeout=86400s` (24h),
  `maxRetries=3`. A task killed by timeout (or genuine crash) is retried by Cloud Run
  and **resumes draining** — `resetStaleProcessingRows()` at startup reclaims the
  in-flight `processing` row (threshold: `created_at` older than 30 min) so it goes back
  to `pending`. These values live in BOTH `cloud-run/job.yaml` and the
  `--max-retries`/`--task-timeout` flags in `.github/workflows/cd.yml` (update/create
  branches) — keep them in sync. The loader and extraction-job keep their own values.

## Completion + lock model in the api-server (`routes/bq.ts`)

Because the processor runs autonomously, completion is **not** detected by waiting on
the execution. Instead `reconcileDownloadJob()` reads the authoritative staging queue
(`getStagingActivity()` → `pending` + `processing` via COUNTIF) and, when both are 0
while the in-memory `downloadJob.step === "processor-running"`, flips
`downloadJob.status` to `completed`.

**Critical:** `reconcileDownloadJob()` must be called by EVERY endpoint that gates on
`downloadJob.status === "running"` (the status poll, `/bq/run-job`,
`/bq/staging-reset-stuck-processing`, `/bq/queue-recordings/adhoc/run`,
`/bq/adhoc-reset-stale`, `/bq/adhoc-resume`), not just the status route. Otherwise the
in-memory lock can get stuck `running` forever (returning 409 and blocking all those
operations) if nothing happens to poll the status endpoint. The lock is in-memory only,
so an api-server restart also clears it.

## Known residual risk (not yet addressed)

`resetStaleProcessingRows` keys off `created_at > 30 min`. If the processor crashes
within 30 min of rows being queued and Cloud Run retries immediately, the orphan
`processing` row is still "young", the concurrency guard sees it and exits early, and
retries can burn before the row ages out → drain stalls until a later manual run. A
proper fix would track `processing_started_at` (schema change) instead of `created_at`.

## Dedup

Both daily and ad-hoc queueing skip calls that already have a row in
`incontact.call_recordings` (LEFT JOIN … WHERE `r.acd_contact_id IS NULL` in
`buildPendingRecordingsQuery`). Re-requesting an already-pulled day is safe and only
fills gaps; a previously-failed pull (no recording row) is retried.

## Deployment note

These behavior changes only take effect in production after CD rebuilds the processor
image AND applies the new job config (max-retries/task-timeout) — i.e. merge to `main`
→ CD. The GCP Cloud Run jobs are shared, so triggering from the Replit dev control-plane
hits whatever image/config is currently deployed, not local edits.
