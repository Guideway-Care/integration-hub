/**
 * One-click Resume recovery for the daily download pipeline.
 *
 * Covers the operator-facing recovery path after a crash or pause:
 *   1. POST /bq/run-job-resume flips stale (>5 min) 'processing' staging rows
 *      back to 'pending' before re-triggering the processor, and reports the
 *      count as `staleReset` in its response.
 *   2. It rejects with 409 when there is nothing to resume (no pending rows
 *      even after the stale reset).
 *   3. GET /bq/staging-summary reports `staleProcessing` so the UI can show
 *      the Resume button when only stale processing rows remain.
 *
 * BigQuery, GCS, Cloud Run (fetch) and auth are all mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Fake GCS (paused-marker reads/writes only)
// ---------------------------------------------------------------------------
let gcsStore: Map<string, string>;

function makeFakeGcs() {
  return {
    bucket: (bucketName: string) => ({
      file: (path: string) => {
        const key = `${bucketName}/${path}`;
        return {
          exists: async () => [gcsStore.has(key)],
          save: async (contents: string) => {
            gcsStore.set(key, contents);
          },
          delete: async (_opts?: { ignoreNotFound?: boolean }) => {
            gcsStore.delete(key);
          },
          download: async () => [Buffer.from(gcsStore.get(key) ?? "", "utf-8")],
        };
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Fake BigQuery — per-test programmable results, with call capture
// ---------------------------------------------------------------------------
/** Queued results for bq.query() calls, shifted in order. */
let bqQueryResults: any[][];
/** Captured bq.query() call args, in order. */
let bqQueryCalls: Array<{ query: string; params?: Record<string, unknown> }>;
/** Queued DML affected-row counts for createQueryJob() calls, shifted in order. */
let bqDmlAffectedRows: number[];
/** Captured createQueryJob() call args, in order. */
let bqDmlCalls: Array<{ query: string; params?: Record<string, unknown> }>;

function makeFakeBq() {
  return {
    query: async (opts: any) => {
      bqQueryCalls.push({ query: opts.query, params: opts.params });
      return [bqQueryResults.shift() ?? []];
    },
    createQueryJob: async (opts: any) => {
      bqDmlCalls.push({ query: opts.query, params: opts.params });
      const affected = bqDmlAffectedRows.shift() ?? 0;
      return [
        {
          getQueryResults: async () => [[]],
          getMetadata: async () => [
            { statistics: { query: { numDmlAffectedRows: String(affected) } } },
          ],
        },
      ];
    },
  };
}

vi.mock("../../services/gcp-clients", () => ({
  getGCSClient: () => makeFakeGcs(),
  getBigQueryClient: () => makeFakeBq(),
  getGcpProjectId: () => "test-project",
}));

vi.mock("../../services/cloud-run", () => ({
  getGcpCredentials: () => ({}),
}));

vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    async getClient() {
      return { getAccessToken: async () => ({ token: "fake-token" }) };
    }
  },
}));

vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@workspace/db/schema", () => ({ recordingFilterRuleTable: {} }));

// ---------------------------------------------------------------------------
// Fake Cloud Run HTTP API (global fetch)
// ---------------------------------------------------------------------------
let executionCounter = 0;
/** Job names that were :run-triggered, in order. */
let triggeredJobs: string[];

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function installFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes(":run")) {
        const jobMatch = url.match(/\/jobs\/([^/:]+):run/);
        if (jobMatch) triggeredJobs.push(jobMatch[1]);
        const name = `projects/test-project/locations/us-central1/jobs/${jobMatch?.[1] || "x"}/executions/exec-${++executionCounter}`;
        return jsonResponse({ metadata: { name } });
      }
      if (url.includes("/executions?pageSize")) {
        return jsonResponse({ executions: [] });
      }
      return jsonResponse({});
    }),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function freshApp() {
  // Reset the module registry so bq.ts module-level state (downloadJob,
  // adhocDownloadJob, run tokens) starts from a cold boot.
  vi.resetModules();
  const { default: bqRouter } = await import("../bq");
  const app = express();
  app.use(express.json());
  app.use(bqRouter);
  return app;
}

const tick = () => new Promise((r) => setTimeout(r, 25));

async function waitFor(cond: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!cond() && Date.now() < deadline) await tick();
  expect(cond()).toBe(true);
}

beforeEach(() => {
  gcsStore = new Map();
  bqQueryResults = [];
  bqQueryCalls = [];
  bqDmlAffectedRows = [];
  bqDmlCalls = [];
  triggeredJobs = [];
  executionCounter = 0;
  installFetchMock();
});

// ---------------------------------------------------------------------------
// POST /bq/run-job-resume
// ---------------------------------------------------------------------------
describe("POST /bq/run-job-resume — one-click recovery", () => {
  it("resets stale processing rows back to pending before re-triggering the processor", async () => {
    const app = await freshApp();
    bqDmlAffectedRows.push(3); // stale-reset UPDATE flips 3 rows
    bqQueryResults.push([{ pending: 3, processing: 0 }]); // staging activity after reset

    const res = await request(app).post("/bq/run-job-resume").send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("running");
    expect(res.body.staleReset).toBe(3);
    expect(res.body.pending).toBe(3);

    // The reset ran before the pending check: exactly one DML statement, and
    // it targets only stale 'processing' rows with the 5-minute threshold.
    expect(bqDmlCalls).toHaveLength(1);
    const dml = bqDmlCalls[0];
    expect(dml.query).toMatch(/UPDATE/);
    expect(dml.query).toMatch(/SET status = 'pending'/);
    expect(dml.query).toMatch(/WHERE status = 'processing'/);
    expect(dml.query).toMatch(/TIMESTAMP_DIFF\(CURRENT_TIMESTAMP\(\), created_at, MINUTE\) > @stale/);
    expect(dml.params?.stale).toBe(5);

    // Only the processor is re-triggered — the loader is skipped on resume.
    await waitFor(() => triggeredJobs.length > 0);
    expect(triggeredJobs).toEqual(["incontact-call-processor"]);

    // The pipeline reports running so the UI reflects the recovered drain.
    bqQueryResults.push([{ pending: 3, processing: 0 }]); // reconcile poll
    const status = await request(app).get("/bq/download-job-status");
    expect(status.body.status).toBe("running");
    expect(status.body.step).toBe("processor-running");
  });

  it("includes staleReset in the response even when no rows were stale", async () => {
    const app = await freshApp();
    bqDmlAffectedRows.push(0); // nothing stale
    bqQueryResults.push([{ pending: 2, processing: 1 }]); // pending work exists

    const res = await request(app).post("/bq/run-job-resume").send({});
    expect(res.status).toBe(200);
    expect(res.body.staleReset).toBe(0);
    expect(res.body.pending).toBe(2);
  });

  it("rejects with 409 when nothing is resumable (no pending rows even after the stale reset)", async () => {
    const app = await freshApp();
    bqDmlAffectedRows.push(0); // stale reset finds nothing
    bqQueryResults.push([{ pending: 0, processing: 0 }]); // and no pending work

    const res = await request(app).post("/bq/run-job-resume").send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Nothing to resume/i);

    // No processor was triggered and the job stays idle.
    await tick();
    expect(triggeredJobs).toEqual([]);
    const status = await request(app).get("/bq/download-job-status");
    expect(status.body.status).toBe("idle");
  });

  it("recovers a run where ALL remaining rows are stale processing (the crash scenario)", async () => {
    const app = await freshApp();
    bqDmlAffectedRows.push(7); // all 7 stuck rows flipped back to pending
    bqQueryResults.push([{ pending: 7, processing: 0 }]); // now visible as pending

    const res = await request(app).post("/bq/run-job-resume").send({});
    expect(res.status).toBe(200);
    expect(res.body.staleReset).toBe(7);
    expect(res.body.pending).toBe(7);
    await waitFor(() => triggeredJobs.includes("incontact-call-processor"));
  });

  it("rejects with 409 when the daily pipeline is already running", async () => {
    const app = await freshApp();

    // Start a resume to put the daily job into 'running'.
    bqDmlAffectedRows.push(0);
    bqQueryResults.push([{ pending: 1, processing: 0 }]);
    const first = await request(app).post("/bq/run-job-resume").send({});
    expect(first.status).toBe(200);
    await waitFor(() => triggeredJobs.length === 1);

    // Second resume: reconcile sees work still in flight, then the gate rejects.
    bqQueryResults.push([{ pending: 1, processing: 0 }]); // reconcile poll
    const second = await request(app).post("/bq/run-job-resume").send({});
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already running/i);
    expect(triggeredJobs).toHaveLength(1); // no second trigger
  });
});

// ---------------------------------------------------------------------------
// GET /bq/staging-summary
// ---------------------------------------------------------------------------
describe("GET /bq/staging-summary — staleProcessing reporting", () => {
  it("reports staleProcessing from the processing row's stale_count", async () => {
    const app = await freshApp();
    bqQueryResults.push([
      { status: "downloaded", count: 10, stale_count: 0 },
      { status: "failed", count: 1, stale_count: 0 },
      { status: "processing", count: 4, stale_count: 3 },
    ]);

    const res = await request(app).get("/bq/staging-summary");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      pending: 0,
      processing: 4,
      downloaded: 10,
      failed: 1,
      staleProcessing: 3,
      total: 15,
    });

    // The summary query computes staleness with the shared 5-minute threshold.
    expect(bqQueryCalls).toHaveLength(1);
    expect(bqQueryCalls[0].query).toMatch(/TIMESTAMP_DIFF\(CURRENT_TIMESTAMP\(\), created_at, MINUTE\) > @stale/);
    expect(bqQueryCalls[0].params?.stale).toBe(5);
  });

  it("reports staleProcessing = 0 when no processing rows exist", async () => {
    const app = await freshApp();
    bqQueryResults.push([{ status: "pending", count: 2, stale_count: 0 }]);

    const res = await request(app).get("/bq/staging-summary");
    expect(res.status).toBe(200);
    expect(res.body.staleProcessing).toBe(0);
    expect(res.body.pending).toBe(2);
    expect(res.body.total).toBe(2);
  });

  it("ignores stale counts on non-processing statuses", async () => {
    const app = await freshApp();
    // e.g. old 'pending' rows are also >5 min old, but only processing staleness matters.
    bqQueryResults.push([
      { status: "pending", count: 5, stale_count: 5 },
      { status: "processing", count: 2, stale_count: 1 },
    ]);

    const res = await request(app).get("/bq/staging-summary");
    expect(res.body.staleProcessing).toBe(1);
  });
});
