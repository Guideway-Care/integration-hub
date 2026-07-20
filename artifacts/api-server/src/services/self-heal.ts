import { and, eq, lt, ne } from "drizzle-orm";
import { db } from "@workspace/db";
import { scheduledJobRunTable } from "@workspace/db/schema";
import { logger } from "../lib/logger";

/**
 * The daily-job orchestration runs as background work after the scheduler's
 * HTTP request has been answered. Cloud Run can stop the instance at any
 * point once no requests are active (scale-to-zero), which kills that
 * background chain mid-flight. These sweeps make the system self-heal:
 *
 * 1. sweepOrphanedScheduledRuns — a run row stuck in 'running' long past any
 *    plausible runtime means the orchestrating instance died. Mark it failed
 *    with a clear error instead of leaving a permanent "Stalled" badge.
 *
 * 2. ensureQueueDraining — if recordings sit 'pending' with no processor
 *    execution running, the loader→processor hand-off was dropped. Trigger
 *    the processor; it drains the queue globally and tolerates concurrent
 *    executions (work-stealing), so a redundant trigger is harmless.
 *
 * 3. resumeContactsBackfill — the multi-hour contacts backfill persists a
 *    per-day heartbeat; if its row is 'running' with a stale heartbeat and no
 *    in-memory loop, the driving instance died — restart the loop (skip
 *    logic makes the resume idempotent). The backfill is deliberately
 *    EXCLUDED from the 90-min orphan sweep: it legitimately runs for hours.
 */

/** Longest plausible orchestration: extract+transform+queue+loader wait (~32m cap) + processor wait (10m). */
const ORPHAN_RUN_MINUTES = 90;
/** Normal hand-off latency is seconds; 15 min pending with no processor means the trigger was lost. */
const PENDING_STALE_MINUTES = 15;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

export async function sweepOrphanedScheduledRuns(): Promise<void> {
  const cutoff = new Date(Date.now() - ORPHAN_RUN_MINUTES * 60 * 1000);
  const rows = await db
    .update(scheduledJobRunTable)
    .set({
      status: "failed",
      completedAt: new Date(),
      error:
        "orchestration interrupted: the server instance stopped mid-run. Check BigQuery for loaded data and the staging queue for recording downloads before re-running.",
    })
    .where(
      and(
        eq(scheduledJobRunTable.status, "running"),
        lt(scheduledJobRunTable.startedAt, cutoff),
        // The contacts backfill runs for many hours by design; it has its own
        // heartbeat-based orphan detection + auto-resume (see below).
        ne(scheduledJobRunTable.jobName, "contacts-backfill"),
      ),
    )
    .returning({
      id: scheduledJobRunTable.id,
      jobName: scheduledJobRunTable.jobName,
      runDate: scheduledJobRunTable.runDate,
    });
  for (const row of rows) {
    logger.warn(row, "[self-heal] marked orphaned scheduled run as failed");
  }
}

export async function ensureQueueDraining(): Promise<void> {
  const bq = await import("../routes/bq");
  const stalePending = await bq.countStalePendingRecordings(PENDING_STALE_MINUTES);
  if (stalePending === 0) return;
  if (await bq.hasActiveProcessorExecution()) return;
  logger.warn(
    { stalePending },
    "[self-heal] pending recordings with no active processor execution — triggering processor",
  );
  const result = await bq.triggerProcessorJob();
  logger.info({ executionName: result.executionName }, "[self-heal] processor triggered");
}

export async function resumeContactsBackfill(): Promise<void> {
  const incontact = await import("../routes/incontact");
  await incontact.resumeOrphanedContactsBackfill();
}

export function startSelfHealLoop(): void {
  const run = async () => {
    await sweepOrphanedScheduledRuns().catch((err: any) =>
      logger.error({ err: err.message }, "[self-heal] orphaned-run sweep failed"),
    );
    await ensureQueueDraining().catch((err: any) =>
      logger.error({ err: err.message }, "[self-heal] queue-drain check failed"),
    );
    await resumeContactsBackfill().catch((err: any) =>
      logger.error({ err: err.message }, "[self-heal] backfill resume check failed"),
    );
  };
  void run();
  const timer = setInterval(() => void run(), SWEEP_INTERVAL_MS);
  timer.unref();
}
