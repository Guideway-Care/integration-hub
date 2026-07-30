/**
 * SkippedDownloadNotice pairing tests.
 *
 * The banner must render ONLY when BOTH are true:
 *   1. the latest contacts-daily run has status "skipped", and
 *   2. /bq/download-job-status reports idle + step "paused".
 * Anything else (resumed, non-skipped latest run, loading, or erroring
 * queries) must render nothing — no stale or missing-data warnings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import React from "react";

import { SkippedDownloadNotice, type ScheduledJobsHistory, type ScheduledRun } from "../scheduled-jobs";

const BANNER_TEXT = /recording download was skipped/i;

type DownloadJobStatus = { status: string; step: string };

function makeRun(overrides: Partial<ScheduledRun> = {}): ScheduledRun {
  return {
    id: "run-1",
    jobName: "contacts-daily",
    runDate: "2026-07-29",
    trigger: "scheduled",
    status: "skipped",
    phase: null,
    startedAt: "2026-07-30T11:00:00.000Z",
    completedAt: "2026-07-30T11:00:01.000Z",
    durationMs: 1000,
    error: null,
    detail: null,
    createdTs: "2026-07-30T11:00:00.000Z",
    stale: false,
    ...overrides,
  };
}

function makeHistory(runs: ScheduledRun[]): ScheduledJobsHistory {
  return {
    schedules: [],
    jobs: { "contacts-daily": { runs, current: null } },
    days: 3,
    historyAvailable: true,
    nowChicago: "2026-07-30",
    yesterdayChicago: "2026-07-29",
  };
}

type FetchPlan = {
  history?: ScheduledJobsHistory | "error" | "pending";
  status?: DownloadJobStatus | "error" | "pending";
};

function installFetch(plan: FetchPlan) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const respond = (payload: unknown) =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      const fail = () =>
        new Response(JSON.stringify({ error: "boom" }), { status: 500 });

      let outcome: ScheduledJobsHistory | DownloadJobStatus | "error" | "pending" | undefined;
      if (url.includes("/incontact/scheduled-jobs/history")) outcome = plan.history;
      else if (url.includes("/bq/download-job-status")) outcome = plan.status;
      else throw new Error(`Unexpected fetch: ${url}`);

      if (outcome === "pending") return new Promise<Response>(() => {});
      if (outcome === "error" || outcome === undefined) return fail();
      return respond(outcome);
    }),
  );
}

function renderNotice() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <SkippedDownloadNotice />
      </Router>
    </QueryClientProvider>,
  );
}

async function flushQueries() {
  // Let react-query settle whatever fetches can resolve.
  await waitFor(() => {
    expect(vi.mocked(fetch)).toHaveBeenCalled();
  });
  // One extra microtask/macrotask hop so resolved data is rendered.
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SkippedDownloadNotice", () => {
  it("shows when the latest contacts-daily run is skipped and the paused marker is present", async () => {
    installFetch({
      history: makeHistory([makeRun({ status: "skipped" })]),
      status: { status: "idle", step: "paused" },
    });
    renderNotice();
    expect(await screen.findByText(BANNER_TEXT)).toBeInTheDocument();
    expect(screen.getByText(/go to recordings to resume/i)).toBeInTheDocument();
  });

  it("hides after Resume (status no longer paused) even if the latest run is still skipped", async () => {
    installFetch({
      history: makeHistory([makeRun({ status: "skipped" })]),
      status: { status: "idle", step: "" },
    });
    renderNotice();
    await flushQueries();
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument();
  });

  it("hides when a download is actively running (status not idle)", async () => {
    installFetch({
      history: makeHistory([makeRun({ status: "skipped" })]),
      status: { status: "running", step: "downloading" },
    });
    renderNotice();
    await flushQueries();
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument();
  });

  it("hides when the latest run is not skipped, even if still paused", async () => {
    installFetch({
      history: makeHistory([
        makeRun({ id: "run-2", status: "completed", runDate: "2026-07-29" }),
        makeRun({ id: "run-1", status: "skipped", runDate: "2026-07-28" }),
      ]),
      status: { status: "idle", step: "paused" },
    });
    renderNotice();
    await flushQueries();
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument();
  });

  it("hides when there are no contacts-daily runs at all", async () => {
    installFetch({
      history: makeHistory([]),
      status: { status: "idle", step: "paused" },
    });
    renderNotice();
    await flushQueries();
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument();
  });

  it("hides while the history query is still loading", async () => {
    installFetch({
      history: "pending",
      status: { status: "idle", step: "paused" },
    });
    renderNotice();
    await flushQueries();
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument();
  });

  it("hides while the download-job-status query is still loading", async () => {
    installFetch({
      history: makeHistory([makeRun({ status: "skipped" })]),
      status: "pending",
    });
    renderNotice();
    await flushQueries();
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument();
  });

  it("hides when the history query errors", async () => {
    installFetch({
      history: "error",
      status: { status: "idle", step: "paused" },
    });
    renderNotice();
    await flushQueries();
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument();
  });

  it("hides when the download-job-status query errors", async () => {
    installFetch({
      history: makeHistory([makeRun({ status: "skipped" })]),
      status: "error",
    });
    renderNotice();
    await flushQueries();
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument();
  });
});
