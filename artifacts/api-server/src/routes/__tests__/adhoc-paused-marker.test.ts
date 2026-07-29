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
/** Job names (loader/processor) that were :run-triggered, in order. */
let triggeredJobs: string[];
/** When true, execution status polls report successful completion by default. */
let pollSucceeds: boolean;

/**
 * A "hold" gates a single matching fetch request: the mock signals `hit` when
 * the request arrives, then blocks the response until `release()` is called.
 * This lets tests pause the pipeline deterministically inside a race window
 * (e.g. while a Cloud Run trigger or status poll is in flight).
 */
type FetchHold = {
  match: (url: string) => boolean;
  hit: Promise<void>;
  signalHit: () => void;
  gate: Promise<void>;
  release: () => void;
  used: boolean;
};
let fetchHolds: FetchHold[];

function makeHold(match: (url: string) => boolean): FetchHold {
  let signalHit!: () => void;
  let release!: () => void;
  const hit = new Promise<void>((r) => (signalHit = r));
  const gate = new Promise<void>((r) => (release = r));
  const hold: FetchHold = { match, hit, signalHit, gate, release, used: false };
  fetchHolds.push(hold);
  return hold;
}

/** Hold the Cloud Run :run trigger for a specific job. */
function holdRunTrigger(jobName: string) {
  return makeHold((url) => url.includes(`/jobs/${jobName}:run`));
}

/** Hold the execution status poll for a specific execution (not :cancel). */
function holdPoll(execSuffix: string) {
  return makeHold(
    (url) => !url.includes(":cancel") && !url.includes(":run") && url.endsWith(execSuffix),
  );
}

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
      // Gate the request if a hold matches (one request per hold).
      const hold = fetchHolds.find((h) => !h.used && h.match(url));
      if (hold) {
        hold.used = true;
        hold.signalHit();
        await hold.gate;
      }
      if (url.includes(":run")) {
        const jobMatch = url.match(/\/jobs\/([^/:]+):run/);
        if (jobMatch) triggeredJobs.push(jobMatch[1]);
        const name = `projects/test-project/locations/us-central1/jobs/${jobMatch?.[1] || "x"}/executions/exec-${++executionCounter}`;
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
      if (pollSucceeds) {
        return jsonResponse({
          completionTime: new Date().toISOString(),
          conditions: [{ type: "Completed", state: "CONDITION_SUCCEEDED" }],
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
  triggeredJobs = [];
  fetchHolds = [];
  pollSucceeds = false;
  executionCounter = 0;
  installFetchMock();
});

const wasCancelled = (execSuffix: string) =>
  cancelledExecutions.some((n) => n.endsWith(execSuffix));

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

// ---------------------------------------------------------------------------
// Run-token race windows: a Pause that lands while a background flow is
// mid-phase must stop the flow — cancelling any just-triggered Cloud Run
// execution — and must never let the flow overwrite the paused job state
// with completed/failed or start downstream work.
// ---------------------------------------------------------------------------
describe("pause race windows — ad-hoc run", () => {
  const batchId = "adhoc_race-batch";

  async function startAdhocRun(app: any) {
    gcsStore.set(`${BUCKET}/call_list/${batchId}.txt`, "123456\n");
    const res = await request(app).post("/bq/queue-recordings/adhoc/run").send({ batchId });
    expect(res.status).toBe(200);
  }

  it("pause while the loader is being triggered cancels the loader and leaves the job paused", async () => {
    const app = await freshApp();
    const hold = holdRunTrigger("incontact-call-loader");

    await startAdhocRun(app);
    await hold.hit; // loader :run request is in flight

    const pauseRes = await request(app).post("/bq/adhoc-pause").send({});
    expect(pauseRes.status).toBe(200);

    hold.release(); // trigger completes — but the token has moved on
    await waitFor(() => wasCancelled("exec-1"));

    // Background flow must bail out: no processor, no state overwrite.
    expect(triggeredJobs).toEqual(["incontact-call-loader"]);
    const status = await request(app).get("/bq/adhoc-download-job-status");
    expect(status.body.status).toBe("idle");
    expect(status.body.step).toBe("paused");
    expect(gcsStore.has(markerKey)).toBe(true);
  });

  it("pause during the loader wait never starts the processor", async () => {
    const app = await freshApp();
    pollSucceeds = true;
    const hold = holdPoll("exec-1"); // loader status poll

    await startAdhocRun(app);
    await hold.hit; // loader triggered, poll in flight

    const pauseRes = await request(app).post("/bq/adhoc-pause").send({});
    expect(pauseRes.status).toBe(200);

    hold.release(); // poll reports loader success — token check must exit
    await tick();
    await tick();

    expect(triggeredJobs).toEqual(["incontact-call-loader"]);
    const status = await request(app).get("/bq/adhoc-download-job-status");
    expect(status.body.status).toBe("idle");
    expect(status.body.step).toBe("paused");
  });

  it("pause during the processor wait skips the completed/failed status update", async () => {
    const app = await freshApp();
    pollSucceeds = true;
    const hold = holdPoll("exec-2"); // processor status poll

    await startAdhocRun(app);
    await hold.hit; // loader done, processor triggered, poll in flight

    const pauseRes = await request(app).post("/bq/adhoc-pause").send({});
    expect(pauseRes.status).toBe(200);
    // Pause cancelled the live processor execution it knew about.
    expect(wasCancelled("exec-2")).toBe(true);

    hold.release(); // poll returns (cancelled/failed) — must not overwrite paused
    await tick();
    await tick();

    const status = await request(app).get("/bq/adhoc-download-job-status");
    expect(status.body.status).toBe("idle");
    expect(status.body.step).toBe("paused");
    expect(status.body.error).toBeUndefined();
    const marker = JSON.parse(gcsStore.get(markerKey)!);
    expect(marker.batchId).toBe(batchId);
  });
});

describe("pause race windows — ad-hoc resume", () => {
  const batchId = "adhoc_race-resume";

  async function startResume(app: any) {
    // Resume validation query: pending work exists.
    bqQueryResults.push([{ pending: 2, stale_processing: 0, total: 4 }]);
    const res = await request(app).post("/bq/adhoc-resume").send({ batchId });
    expect(res.status).toBe(200);
  }

  it("pause while resume is triggering the processor cancels it and keeps the paused state", async () => {
    const app = await freshApp();
    const hold = holdRunTrigger("incontact-call-processor");

    await startResume(app);
    await hold.hit; // processor :run in flight

    const pauseRes = await request(app).post("/bq/adhoc-pause").send({});
    expect(pauseRes.status).toBe(200);

    hold.release();
    await waitFor(() => wasCancelled("exec-1"));

    const status = await request(app).get("/bq/adhoc-download-job-status");
    expect(status.body.status).toBe("idle");
    expect(status.body.step).toBe("paused");
    expect(gcsStore.has(markerKey)).toBe(true);
  });

  it("pause during resume's processor wait skips the completed/failed status update", async () => {
    const app = await freshApp();
    pollSucceeds = true;
    const hold = holdPoll("exec-1"); // processor status poll

    await startResume(app);
    await hold.hit;

    const pauseRes = await request(app).post("/bq/adhoc-pause").send({});
    expect(pauseRes.status).toBe(200);

    hold.release();
    await tick();
    await tick();

    const status = await request(app).get("/bq/adhoc-download-job-status");
    expect(status.body.status).toBe("idle");
    expect(status.body.step).toBe("paused");
    expect(status.body.error).toBeUndefined();
  });
});

describe("pause race windows — daily pipeline (/bq/run-job)", () => {
  async function startDailyRun(app: any) {
    const res = await request(app).post("/bq/run-job").send({});
    expect(res.status).toBe(200);
  }

  it("pause while the daily loader is being triggered cancels it and leaves the daily job paused", async () => {
    const app = await freshApp();
    const hold = holdRunTrigger("incontact-call-loader");

    await startDailyRun(app);
    await hold.hit;

    const pauseRes = await request(app).post("/bq/adhoc-pause").send({});
    expect(pauseRes.status).toBe(200);

    hold.release();
    await waitFor(() => wasCancelled("exec-1"));

    expect(triggeredJobs).toEqual(["incontact-call-loader"]);
    const status = await request(app).get("/bq/download-job-status");
    expect(status.body.status).toBe("idle");
    expect(status.body.step).toBe("paused");
    expect(status.body.error).toBeUndefined();
  });

  it("pause during the daily loader wait never starts the processor", async () => {
    const app = await freshApp();
    pollSucceeds = true;
    const hold = holdPoll("exec-1"); // loader status poll

    await startDailyRun(app);
    await hold.hit;

    const pauseRes = await request(app).post("/bq/adhoc-pause").send({});
    expect(pauseRes.status).toBe(200);

    hold.release();
    await tick();
    await tick();

    expect(triggeredJobs).toEqual(["incontact-call-loader"]);
    const status = await request(app).get("/bq/download-job-status");
    expect(status.body.status).toBe("idle");
    expect(status.body.step).toBe("paused");
  });

  it("pause while the daily processor is being triggered cancels the fresh processor execution", async () => {
    const app = await freshApp();
    pollSucceeds = true; // loader completes normally
    const hold = holdRunTrigger("incontact-call-processor");

    await startDailyRun(app);
    await hold.hit; // processor :run in flight

    const pauseRes = await request(app).post("/bq/adhoc-pause").send({});
    expect(pauseRes.status).toBe(200);

    hold.release();
    await waitFor(() => wasCancelled("exec-2"));

    const status = await request(app).get("/bq/download-job-status");
    expect(status.body.status).toBe("idle");
    expect(status.body.step).toBe("paused");
    expect(status.body.error).toBeUndefined();
  });
});
