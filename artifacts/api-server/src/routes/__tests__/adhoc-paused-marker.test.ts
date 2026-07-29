/**
 * Lifecycle tests for the durable ad-hoc "Paused" marker
 * (gs://incontact-audio/adhoc_state/paused.json).
 *
 * Covers the regression where the Paused banner vanished after an api-server
 * restart:
 *   1. /bq/adhoc-pause writes the marker
 *   2. /bq/queue-recordings/adhoc/run and /bq/adhoc-resume clear it
 *   3. /bq/adhoc-download-job-status hydrates paused state from the marker
 *      after a cold start (fresh module = fresh in-memory state)
 *
 * GCS, BigQuery, Cloud Run (fetch) and auth are all mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const PAUSED_MARKER = "adhoc_state/paused.json";
const BUCKET = "incontact-audio";

// ---------------------------------------------------------------------------
// In-memory fake GCS
// ---------------------------------------------------------------------------
type GcsStore = Map<string, string>; // key: `${bucket}/${path}`
let gcsStore: GcsStore;

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
// Fake BigQuery — per-test programmable query results
// ---------------------------------------------------------------------------
let bqQueryResults: any[][] = [];
function makeFakeBq() {
  return {
    query: async () => {
      const next = bqQueryResults.shift() ?? [];
      return [next];
    },
    createQueryJob: async () => [
      {
        getQueryResults: async () => [[]],
        getMetadata: async () => [{ statistics: { query: { numDmlAffectedRows: 0 } } }],
      },
    ],
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
let cancelledExecutions: string[];
let activeProcessorExecutions: Array<{ name: string; completionTime?: string }>;

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
        const name = `projects/test-project/locations/us-central1/jobs/x/executions/exec-${++executionCounter}`;
        return jsonResponse({ metadata: { name } });
      }
      if (url.includes(":cancel")) {
        const name = url
          .replace("https://run.googleapis.com/v2/", "")
          .replace(":cancel", "");
        cancelledExecutions.push(name);
        return jsonResponse({});
      }
      if (url.includes("/executions?pageSize")) {
        return jsonResponse({ executions: activeProcessorExecutions });
      }
      // Execution status poll: report completion (cancelled) once cancelled,
      // otherwise still running.
      const execName = url.replace("https://run.googleapis.com/v2/", "");
      if (cancelledExecutions.includes(execName)) {
        return jsonResponse({
          completionTime: new Date().toISOString(),
          conditions: [{ type: "Completed", state: "CONDITION_FAILED", message: "cancelled" }],
        });
      }
      return jsonResponse({});
    }),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function freshApp() {
  // Reset module registry so bq.ts module-level state (adhocDownloadJob,
  // pausedMarkerHydrated, run tokens) starts from a cold boot.
  vi.resetModules();
  const { default: bqRouter } = await import("../bq");
  const app = express();
  app.use(express.json());
  app.use(bqRouter);
  return app;
}

const markerKey = `${BUCKET}/${PAUSED_MARKER}`;
const tick = () => new Promise((r) => setTimeout(r, 25));

async function waitFor(cond: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!cond() && Date.now() < deadline) await tick();
  expect(cond()).toBe(true);
}

beforeEach(() => {
  gcsStore = new Map();
  bqQueryResults = [];
  cancelledExecutions = [];
  activeProcessorExecutions = [];
  installFetchMock();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("paused marker lifecycle", () => {
  it("pause during a tracked ad-hoc run writes the marker; run had cleared it first", async () => {
    const app = await freshApp();
    const batchId = "adhoc_test-batch-1";
    // Pre-seed: a stale marker from an older pause + the batch call list file.
    gcsStore.set(markerKey, JSON.stringify({ batchId: "adhoc_old", pausedAt: "2026-01-01T00:00:00Z" }));
    gcsStore.set(`${BUCKET}/call_list/${batchId}.txt`, "123456\n");

    const runRes = await request(app)
      .post("/bq/queue-recordings/adhoc/run")
      .send({ batchId });
    expect(runRes.status).toBe(200);

    // A new run supersedes the previous paused batch — marker must be cleared.
    await waitFor(() => !gcsStore.has(markerKey));

    // Now pause the in-flight run.
    const pauseRes = await request(app).post("/bq/adhoc-pause").send({});
    expect(pauseRes.status).toBe(200);

    // Marker is written durably with the running batch id.
    await waitFor(() => gcsStore.has(markerKey));
    const marker = JSON.parse(gcsStore.get(markerKey)!);
    expect(marker.batchId).toBe(batchId);
    expect(marker.pausedAt).toBeTruthy();

    // And the in-memory job reports paused.
    const statusRes = await request(app).get("/bq/adhoc-download-job-status");
    expect(statusRes.body.status).toBe("idle");
    expect(statusRes.body.step).toBe("paused");
  });

  it("pause with no in-memory job (post-restart) still writes the marker when it cancels live work", async () => {
    const app = await freshApp();
    activeProcessorExecutions = [
      { name: "projects/test-project/locations/us-central1/jobs/incontact-call-processor/executions/exec-live" },
    ];

    const res = await request(app)
      .post("/bq/adhoc-pause")
      .send({ batchId: "adhoc_from-client" });
    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(1);

    await waitFor(() => gcsStore.has(markerKey));
    expect(JSON.parse(gcsStore.get(markerKey)!).batchId).toBe("adhoc_from-client");
  });

  it("resume clears the marker", async () => {
    const app = await freshApp();
    const batchId = "adhoc_test-batch-2";
    gcsStore.set(markerKey, JSON.stringify({ batchId, pausedAt: "2026-07-01T00:00:00Z" }));
    // Resume validation query: pending work exists.
    bqQueryResults.push([{ pending: 3, stale_processing: 0, total: 5 }]);

    const res = await request(app).post("/bq/adhoc-resume").send({ batchId });
    expect(res.status).toBe(200);

    await waitFor(() => !gcsStore.has(markerKey));
  });

  it("status endpoint hydrates paused state from the marker after a cold start", async () => {
    const batchId = "adhoc_survivor";
    const pausedAt = "2026-07-28T12:00:00.000Z";
    gcsStore.set(markerKey, JSON.stringify({ batchId, pausedAt }));

    // Fresh module = simulated api-server restart (in-memory state wiped).
    const app = await freshApp();
    const res = await request(app).get("/bq/adhoc-download-job-status");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("idle");
    expect(res.body.step).toBe("paused");
    expect(res.body.batchId).toBe(batchId);
    expect(res.body.completedAt).toBe(pausedAt);

    // Subsequent polls keep reporting paused (hydration is one-shot, state sticks).
    const res2 = await request(app).get("/bq/adhoc-download-job-status");
    expect(res2.body.step).toBe("paused");
    expect(res2.body.batchId).toBe(batchId);
  });

  it("status endpoint stays idle after a cold start when no marker exists", async () => {
    const app = await freshApp();
    const res = await request(app).get("/bq/adhoc-download-job-status");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("idle");
    expect(res.body.step).toBe("");
  });
});
