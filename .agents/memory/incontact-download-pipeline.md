---
name: InContact recording download pipeline orchestration
description: How the daily Download Recordings pipeline drains the staging queue, and the non-obvious processor exit-code semantics that constrain any re-trigger logic.
---

# InContact recording download pipeline

The daily "Download Recordings" step (API route `/bq/run-job`) runs a loader once
(`incontact-call-loader`: call_list.txt → staging queue) then repeatedly triggers
the processor (`incontact-call-processor`) until the staging queue has no
`pending` rows left.

## Non-obvious gotchas

- **The processor exits non-zero whenever ANY single recording fails**, not just on
  fatal errors (`cloud-run/index.js` ends with `process.exit(1)` when
  `failedCount > 0`). So a Cloud Run execution can report *failed* while it actually
  downloaded hundreds of recordings successfully.
  **Implication:** any code that re-triggers the processor must judge progress by the
  staging-queue `pending` count dropping, NOT by the execution's success/exit status.
  Using exit status would abort a perfectly-progressing drain the moment one call errors.

- **The processor caps each execution at `BATCH_LIMIT` recordings (default 500)** then
  stops with "Batch limit reached." Large lists therefore need multiple executions —
  the orchestrator loops, it does not raise this cap.

- **The processor self-guards against concurrent runs** by checking for rows in
  `processing` status and exiting early if any exist. So the orchestrator's wait for
  one execution must be long enough to match the job's ~2h task timeout
  (`PROCESSOR_WAIT_MS`); waiting too short risks triggering an overlapping run that
  immediately no-ops, which the drain loop then misreads as a stall.

## Drain-loop termination

- Stop when `pending == 0` (success — note some rows may be `failed`, left for a
  separate resume/inspection, which is intentional).
- Stop (error) when a pass makes no forward progress (`remaining >= before`) — guards
  against an infinite loop when remaining rows genuinely can't be drained.
- `MAX_PROCESSOR_PASSES` is a final backstop.

**Why:** failed recordings move to `failed` (not `pending`), so they leave the pending
pool and never cause an infinite retry loop; the loop naturally terminates.

## Two layers of "continue" — only one is reliable

The queue actually drains via TWO independent mechanisms, which is easy to confuse:

1. **Cloud Run task retry (job config `maxRetries: 1`, deployed via `cd.yml --max-retries=1`).**
   Because the processor `process.exit(1)`s after each batch (whenever `failedCount>0`,
   which is almost always), Cloud Run treats the task as failed and RETRIES it inside the
   SAME execution. So one execution = ~2 batches (~1000 recordings) and then ends as
   "Failed with errors." This is what an operator sees as "the job started over by itself
   in the same execution" — it is NOT the api-server creating a new execution. It is also
   accidental: a batch with zero failures exits 0 and does NOT retry.

2. **api-server orchestration loop (`/bq/run-job`, the multi-pass loop).** Meant to trigger
   fresh EXECUTIONS until pending==0. **This runs in the Express background AFTER the HTTP
   response returns, so on Cloud Run it is not guaranteed CPU/lifetime** for the many hours
   a large queue needs (per-call download is ~10–15s, so 7k pending ≈ ~20h of processing).
   Symptom: operator clicks Run, sees continuation happen inside one execution (the retry)
   but NO new execution rows appear — the loop isn't reliably alive.

**Lesson / decision:** for reliable full-drain, continuation must live INSIDE the Cloud Run
job (deliberate `exit(1)` while `pending>0`, `exit(0)` when empty, with a high `maxRetries`;
or have the job self-trigger a fresh execution), NOT in an api-server background promise.
Do not trust the api-server background loop to survive long enough on Cloud Run.

## Dedup

Both daily and ad-hoc queueing skip calls that already have a row in
`incontact.call_recordings` (LEFT JOIN … WHERE `r.acd_contact_id IS NULL` in
`buildPendingRecordingsQuery`). Re-requesting an already-pulled day is safe and only
fills gaps; a previously-failed pull (no recording row) is retried.
