---
name: InContact recording download pipeline orchestration
description: Durable decisions/lessons about how the daily Download Recordings drain completes and why; not a line-level spec.
---

# InContact recording download pipeline

The daily "Download Recordings" step runs a loader (call_list.txt → staging queue)
then the recording processor, which downloads each queued call. A large queue can
take many hours (per-call download ~10–15s; thousands pending ≈ a full day).

## Decision: the drain must complete itself, not be orchestrated by the api-server

**Why:** an earlier design had the api-server trigger the processor in a loop from a
background promise that kept running after the HTTP response returned. On Cloud Run
that background work has no guaranteed CPU/lifetime, so multi-hour drains silently
stalled and the queue never finished. A long-lived server-side promise is the wrong
tool for a job that outlives a request.

**How it works now:** the processor itself drains until the queue is empty (no batch
cap), and is given a long task-timeout plus retries so one execution can finish and an
interrupted one resumes. The api-server triggers the loader, triggers the processor
once, and then just observes the queue.

**Guardrail — do not shrink the processor's Cloud Run task-timeout.** The drain is
sequential at only ~300 recordings/hour, so a multi-thousand backlog needs a many-hour
single run. An earlier 2-hour task-timeout made every execution die on the time limit
(each showed failed=1) before the queue drained — the exact "runs too long, fails,
stops" failure. The timeout must stay comfortably above worst-case full-drain time, or
that regression returns.

**Edge case to preserve:** a fully-drained run must succeed (exit 0) even when some
individual recordings failed — failed rows stay in a `failed` state for separate
retry. Do NOT make per-recording failures fail the whole execution; that only causes a
pointless retry of an already-drained queue. Genuine fatal errors should still fail.

## Lesson: an execution-wait timeout is NOT a pipeline failure

The contacts daily job's download phase awaits the processor execution with a ~10-min
cap. On big download days (1500+ recordings) that wait used to time out and record the
run `failed` ("Processor failed: Timed out waiting for execution to complete") even
though contacts data had already loaded to BigQuery (extract/transform/load finish
before download) and the processor drains to completion on its own. Fixed (July 2026):
the daily job now distinguishes `done:false` (wait timed out, processor still running →
record completed with a "download continuing in background" note) from a genuinely
failed execution (`done:true, !succeeded` → failed). The loader wait uses the longer
LOADER_WAIT_MS (~32 min) matching its 30-min task timeout. If a similar await is ever
added elsewhere, keep that done/succeeded distinction — and judge drains by BigQuery
data + queue state, not run badges. The processor work-steals queue-globally, so
overlapping daily runs' queues drain together.

## Lesson: completion/lock state must come from the queue, not in-memory polling

Completion is detected by reading the staging queue (nothing pending or processing),
not by waiting on the execution. The in-memory "running" lock is reconciled from that
queue state by EVERY endpoint that gates on it, not only the status poll — otherwise
the lock can stick "running" (returning 409 and blocking daily + ad-hoc operations)
whenever nothing happens to poll status. The lock is in-memory, so a server restart
also clears it.

## Residual risk (unaddressed)

Orphan `processing` rows are reclaimed on retry using their creation time (~30 min
threshold). A crash shortly after queueing can leave a "young" orphan that the
concurrency guard refuses to touch, burning retries until it ages out → drain stalls
until a later manual run. A proper fix tracks a processing-start timestamp instead.

## Deployment

The Cloud Run jobs are shared, so triggering from the dev control-plane hits whatever
image/config is currently deployed. Behavior changes land only after CD rebuilds and
redeploys from `main`.

## Dedup

Daily and ad-hoc queueing both skip calls that already have a recording row, so
re-requesting a day is safe and only fills gaps; a previously-failed pull is retried.
