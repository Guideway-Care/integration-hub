/**
 * Regression coverage for the task-20 product decision inside
 * runContactsScheduledJob (routes/incontact.ts):
 *
 *   When an operator Pause is active (durable GCS paused marker present), the
 *   6:30 AM scheduled contacts daily run must still perform extract +
 *   transform, but SKIP the queue/download phases, record the
 *   scheduled_job_run row as "skipped" with the paused note, and never
 *   trigger the loader/processor Cloud Run jobs.
 *
 * The /bq/run-job short-circuit is covered elsewhere
 * (adhoc-paused-marker.test.ts); this file covers the skip block that lives
 * inside the contacts daily pipeline itself.
 *
 * Mocking strategy:
 * - @workspace/db: fake db/pool that records extraction_run and
 *   scheduled_job_run writes; waitForRunCompletion sees "COMPLETED" instantly.
 * - services/gcp-clients: in-memory GCS store so the REAL bq.isDownloadPaused
 *   reads the real daily paused marker path.
 * - ../bq: importOriginal, overriding only the transform pipeline (instant
 *   success) and the loader/processor triggers (spies) — isDownloadPaused and
 *   the paused-marker reading stay real.
 * - global fetch: fake metadata token + extraction-job Cloud Run trigger; any
 *   Cloud Run `:run` call is recorded so we can assert no loader/processor
 *   trigger happened at the HTTP level either.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const BUCKET = "incontact-audio";
const DAILY_PAUSED_MARKER = "daily_state/paused.json";
const ADHOC_PAUSED_MARKER = "adhoc_state/paused.json";

// ---------------------------------------------------------------------------
// Hoisted shared state (visible inside vi.mock factories)
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  const state = {
    gcsStore: new Map<string, string>(),
    /** scheduled_job_run rows: inserts and the update patches applied to them */
    scheduledRunInserts: [] as any[],
    scheduledRunUpdates: [] as any[],
    extractionRunInserts: [] as any[],
    /** Cloud Run job names hit with `:run` at the HTTP (fetch) level */
    httpRunTriggers: [] as string[],
    transformStarted: 0,
  };
  const triggerLoaderJob = vi.fn(async () => ({ executionName: "exec-loader" }));
  const triggerProcessorJob = vi.fn(async () => ({ executionName: "exec-processor" }));
  const writePendingRecordingsToGcs = vi.fn(async () => {});
  const loadActiveDailyRules = vi.fn(async () => ({
    rules: [{ campaignName: "Test Campaign", dispositionPattern: "%" }],
    usedFallback: false,
  }));
  const findPendingRecordingContactIds = vi.fn(async () => [] as string[]);
  return {
    state,
    triggerLoaderJob,
    triggerProcessorJob,
    writePendingRecordingsToGcs,
    loadActiveDailyRules,
    findPendingRecordingContactIds,
  };
});

// ---------------------------------------------------------------------------
// GCP clients — in-memory GCS so bq's REAL readPausedMarker/isDownloadPaused
// operate on a controllable store.
// ---------------------------------------------------------------------------
vi.mock("../../services/gcp-clients", () => ({
  getGCSClient: () => ({
    bucket: (bucketName: string) => ({
      file: (path: string) => {
        const key = `${bucketName}/${path}`;
        return {
          exists: async () => [h.state.gcsStore.has(key)],
          save: async (contents: string) => {
            h.state.gcsStore.set(key, contents);
          },
          delete: async () => {
            h.state.gcsStore.delete(key);
          },
          download: async () => [Buffer.from(h.state.gcsStore.get(key) ?? "", "utf-8")],
        };
      },
    }),
  }),
  getBigQueryClient: () => ({
    query: async () => [[]],
    createQueryJob: async () => [
      {
        getQueryResults: async () => [[]],
        getMetadata: async () => [{ statistics: { query: { numDmlAffectedRows: 0 } } }],
      },
    ],
  }),
  getGcpProjectId: () => "test-project",
  getGcpSecretManagerClient: () => ({}),
  getSecretValue: async () => "fake-secret",
}));

vi.mock("../../services/cloud-run", () => ({
  getGcpCredentials: () => ({}),
}));

// ---------------------------------------------------------------------------
// Database — fake drizzle db + pg pool.
// ---------------------------------------------------------------------------
const schemaTables = vi.hoisted(() => {
  const mkTable = (name: string, cols: string[]) => {
    const t: any = { __table: name };
    for (const c of cols) t[c] = { table: name, column: c };
    return t;
  };
  return {
    sourceSystemTable: mkTable("source_system", ["id"]),
    endpointDefinitionTable: mkTable("endpoint_definition", ["id"]),
    endpointParameterTable: mkTable("endpoint_parameter", ["id"]),
    extractionRunTable: mkTable("extraction_run", ["runId", "status", "endpointId"]),
    scheduledJobRunTable: mkTable("scheduled_job_run", ["id", "jobName", "status"]),
    recordingFilterRuleTable: mkTable("recording_filter_rule", ["id", "isActive"]),
  };
});

vi.mock("@workspace/db/schema", () => schemaTables);

vi.mock("drizzle-orm", () => {
  const op = (..._args: any[]) => ({});
  return { eq: op, desc: op, gte: op, and: op, lt: op, inArray: op, sql: op };
});

vi.mock("@workspace/db", () => {
  let runCounter = 0;
  const db = {
    insert: (table: any) => ({
      values: (v: any) => ({
        returning: async (_sel?: any) => {
          if (table.__table === "scheduled_job_run") {
            const id = `sched-${h.state.scheduledRunInserts.length + 1}`;
            h.state.scheduledRunInserts.push({ id, ...v });
            return [{ id }];
          }
          const runId = `run-${++runCounter}`;
          h.state.extractionRunInserts.push({ runId, ...v });
          return [{ runId }];
        },
      }),
    }),
    update: (table: any) => ({
      set: (patch: any) => ({
        where: async (_cond: any) => {
          if (table.__table === "scheduled_job_run") {
            h.state.scheduledRunUpdates.push(patch);
          }
        },
      }),
    }),
    // waitForRunCompletion: every extraction run completes instantly.
    select: (_sel?: any) => ({
      from: (_t: any) => ({
        where: (_c: any) => ({
          limit: async (_n: number) => [{ status: "COMPLETED" }],
        }),
      }),
    }),
  };
  const pool = {
    connect: async () => ({
      query: async (_sql: string, _params?: any[]) => ({ rows: [] }),
      release: () => {},
    }),
  };
  return { db, pool };
});

// ---------------------------------------------------------------------------
// bq module — keep the REAL isDownloadPaused / paused-marker logic, but make
// the transform instant and spy on the download-phase entry points.
// ---------------------------------------------------------------------------
vi.mock("../bq", async (importOriginal) => {
  const original = await importOriginal<any>();
  return {
    ...original,
    startContactsTransformPipeline: () => {
      h.state.transformStarted++;
      return true;
    },
    getContactsTransformJob: () => ({ status: "completed" }),
    loadActiveDailyRules: h.loadActiveDailyRules,
    findPendingRecordingContactIds: h.findPendingRecordingContactIds,
    writePendingRecordingsToGcs: h.writePendingRecordingsToGcs,
    triggerLoaderJob: h.triggerLoaderJob,
    triggerProcessorJob: h.triggerProcessorJob,
    awaitExecution: vi.fn(async () => ({ done: true, succeeded: true })),
  };
});

// ---------------------------------------------------------------------------
// fetch — metadata token + Cloud Run job triggers. Records every `:run` hit.
// ---------------------------------------------------------------------------
function installFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any) => {
      const url = String(input);
      const json = (body: unknown, status = 200) =>
        ({
          ok: status >= 200 && status < 300,
          status,
          json: async () => body,
          text: async () => JSON.stringify(body),
        }) as Response;
      if (url.includes("metadata.google.internal")) {
        return json({ access_token: "fake-token" });
      }
      const runMatch = url.match(/\/jobs\/([^/:]+):run/);
      if (runMatch) {
        h.state.httpRunTriggers.push(runMatch[1]);
        return json({ metadata: { name: `namespaces/test-project/executions/${runMatch[1]}-exec-1` } });
      }
      return json({});
    }),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function freshApp() {
  vi.resetModules();
  const { default: incontactRouter } = await import("../incontact");
  const app = express();
  app.use(express.json());
  app.use(incontactRouter);
  return app;
}

const tick = () => new Promise((r) => setTimeout(r, 25));
async function waitFor(cond: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!cond() && Date.now() < deadline) await tick();
  expect(cond()).toBe(true);
}

async function waitForRunToSettle(app: any) {
  let last: any;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const res = await request(app).get("/incontact/contacts-daily-job/status");
    last = res.body.data;
    if (last && last.status !== "running" && last.status !== "idle") return last;
    await tick();
  }
  throw new Error(`contacts daily job never settled: ${JSON.stringify(last)}`);
}

beforeEach(() => {
  h.state.gcsStore.clear();
  h.state.scheduledRunInserts.length = 0;
  h.state.scheduledRunUpdates.length = 0;
  h.state.extractionRunInserts.length = 0;
  h.state.httpRunTriggers.length = 0;
  h.state.transformStarted = 0;
  h.triggerLoaderJob.mockClear();
  h.triggerProcessorJob.mockClear();
  h.writePendingRecordingsToGcs.mockClear();
  h.loadActiveDailyRules.mockClear();
  h.findPendingRecordingContactIds.mockClear();
  installFetchMock();
  // The scheduled trigger path skips OIDC verification in development.
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("scheduled contacts daily run while paused (task 20 skip block)", () => {
  it("runs extract + transform but skips queue/download and records the run as skipped (paused)", async () => {
    // Durable daily paused marker present — exactly what an operator Pause leaves behind.
    h.state.gcsStore.set(
      `${BUCKET}/${DAILY_PAUSED_MARKER}`,
      JSON.stringify({ batchId: null, pausedAt: "2026-07-29T18:00:00Z" }),
    );

    const app = await freshApp();
    const res = await request(app)
      .post("/incontact/contacts-daily-job")
      .send({ trigger: "scheduled", date: "2026-07-29" });
    expect(res.status).toBe(200);

    const final = await waitForRunToSettle(app);

    // Extract + transform DID run (data freshness preserved).
    expect(h.state.extractionRunInserts.length).toBeGreaterThan(0);
    expect(h.state.httpRunTriggers).toContain("extraction-job");
    expect(h.state.transformStarted).toBe(1);

    // Skip landed after transform: status skipped, phase done.
    expect(final.status).toBe("skipped");
    expect(final.phase).toBe("done");
    expect(final.date).toBe("2026-07-29");
    expect(final.trigger).toBe("scheduled");

    // Queue/download phases never happened.
    expect(h.loadActiveDailyRules).not.toHaveBeenCalled();
    expect(h.findPendingRecordingContactIds).not.toHaveBeenCalled();
    expect(h.writePendingRecordingsToGcs).not.toHaveBeenCalled();
    expect(final.queuedCount).toBeUndefined();

    // No loader/processor Cloud Run trigger — neither via the bq helpers nor
    // via any raw Cloud Run HTTP call.
    expect(h.triggerLoaderJob).not.toHaveBeenCalled();
    expect(h.triggerProcessorJob).not.toHaveBeenCalled();
    expect(
      h.state.httpRunTriggers.filter((j) => j !== "extraction-job"),
    ).toEqual([]);

    // scheduled_job_run row: started as running, finalized as skipped with the paused note.
    expect(h.state.scheduledRunInserts).toHaveLength(1);
    expect(h.state.scheduledRunInserts[0].jobName).toBe("contacts-daily");
    expect(h.state.scheduledRunInserts[0].trigger).toBe("scheduled");
    await waitFor(() => h.state.scheduledRunUpdates.length === 1);
    const patch = h.state.scheduledRunUpdates[0];
    expect(patch.status).toBe("skipped");
    expect(patch.phase).toBe("done");
    expect(patch.detailJson?.note).toMatch(/paused by operator/i);
    expect(patch.detailJson?.note).toMatch(/queue\/download skipped/i);

    // The paused marker is NOT cleared by the scheduled run — only Resume does that.
    expect(h.state.gcsStore.has(`${BUCKET}/${DAILY_PAUSED_MARKER}`)).toBe(true);
  });

  it("an ad-hoc paused marker also holds back the scheduled download", async () => {
    h.state.gcsStore.set(
      `${BUCKET}/${ADHOC_PAUSED_MARKER}`,
      JSON.stringify({ batchId: "adhoc_x", pausedAt: "2026-07-29T18:00:00Z" }),
    );

    const app = await freshApp();
    const res = await request(app)
      .post("/incontact/contacts-daily-job")
      .send({ trigger: "scheduled", date: "2026-07-29" });
    expect(res.status).toBe(200);

    const final = await waitForRunToSettle(app);
    expect(final.status).toBe("skipped");
    expect(h.triggerLoaderJob).not.toHaveBeenCalled();
    expect(h.triggerProcessorJob).not.toHaveBeenCalled();
    await waitFor(() => h.state.scheduledRunUpdates.length === 1);
    expect(h.state.scheduledRunUpdates[0].status).toBe("skipped");
  });

  it("sanity: with no paused marker the same harness proceeds into the queue phase", async () => {
    // Guards against the skip assertions passing vacuously: prove this test
    // setup reaches the queue phase when NOT paused.
    const app = await freshApp();
    const res = await request(app)
      .post("/incontact/contacts-daily-job")
      .send({ trigger: "scheduled", date: "2026-07-29" });
    expect(res.status).toBe(200);

    const final = await waitForRunToSettle(app);

    // Queue phase ran (no pending ids → completes without download).
    expect(h.loadActiveDailyRules).toHaveBeenCalledTimes(1);
    expect(h.findPendingRecordingContactIds).toHaveBeenCalledTimes(1);
    expect(final.status).toBe("completed");
    expect(final.queuedCount).toBe(0);
    await waitFor(() => h.state.scheduledRunUpdates.length === 1);
    expect(h.state.scheduledRunUpdates[0].status).toBe("completed");
  });
});
