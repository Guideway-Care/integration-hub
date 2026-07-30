import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { api } from "@/lib/api";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  CircleDashed,
  Clock,
  PauseCircle,
} from "lucide-react";

export interface ScheduledRun {
  id: string;
  jobName: string;
  runDate: string;
  trigger: "manual" | "scheduled";
  status: "running" | "completed" | "failed" | "skipped";
  phase: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  error: string | null;
  detail: Record<string, unknown> | null;
  createdTs: string;
  stale: boolean;
}

export interface ScheduleMeta {
  jobName: string;
  humanLabel: string;
  description: string;
  schedule: string;
  timeZone: string;
}

export interface ScheduledJobsHistory {
  schedules: ScheduleMeta[];
  jobs: Record<string, { runs: ScheduledRun[]; current: unknown }>;
  days: number;
  historyAvailable: boolean;
  nowChicago: string;
  yesterdayChicago: string;
}

const JOB_TITLES: Record<string, string> = {
  "agents-daily": "Agent Performance",
  "contacts-daily": "Contacts & Recordings",
};

export function useScheduledJobsHistory(days = 3) {
  return useQuery({
    queryKey: ["scheduled-jobs-history", days],
    queryFn: () => api.get<ScheduledJobsHistory>(`/incontact/scheduled-jobs/history?days=${days}`),
    retry: false,
    refetchInterval: 60_000,
  });
}

function subtractDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const u = new Date(Date.UTC(y, m - 1, d));
  u.setUTCDate(u.getUTCDate() - n);
  return u.toISOString().slice(0, 10);
}

function shortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function formatDuration(ms: number | null): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

type DayStatus = "completed" | "failed" | "running" | "stale" | "skipped" | "missing";

function dayVisual(status: DayStatus) {
  switch (status) {
    case "completed":
      return { Icon: CheckCircle2, cls: "text-green-600", bg: "bg-green-50 border-green-200", label: "Pulled" };
    case "skipped":
      return { Icon: PauseCircle, cls: "text-slate-600", bg: "bg-slate-50 border-slate-200", label: "Skipped (paused)" };
    case "failed":
      return { Icon: XCircle, cls: "text-red-600", bg: "bg-red-50 border-red-200", label: "Failed" };
    case "running":
      return { Icon: Loader2, cls: "text-blue-600 animate-spin", bg: "bg-blue-50 border-blue-200", label: "Running" };
    case "stale":
      return { Icon: AlertTriangle, cls: "text-amber-600", bg: "bg-amber-50 border-amber-200", label: "Stalled" };
    default:
      return { Icon: CircleDashed, cls: "text-amber-600", bg: "bg-amber-50 border-amber-200", label: "No run" };
  }
}

function DayChip({ date, status }: { date: string; status: DayStatus }) {
  const v = dayVisual(status);
  return (
    <div className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${v.bg}`}>
      <v.Icon className={`w-3.5 h-3.5 shrink-0 ${v.cls}`} />
      <div className="leading-tight">
        <div className="text-[11px] font-medium text-foreground">{shortDate(date)}</div>
        <div className={`text-[10px] ${v.cls}`}>{v.label}</div>
      </div>
    </div>
  );
}

function PipelineBlock({
  meta,
  runs,
  yesterdayChicago,
  days,
  historyAvailable,
}: {
  meta: ScheduleMeta;
  runs: ScheduledRun[];
  yesterdayChicago: string;
  days: number;
  historyAvailable: boolean;
}) {
  const title = JOB_TITLES[meta.jobName] ?? meta.jobName;
  const latest = runs[0];

  // Expected data-pull dates: the scheduled job runs at ~6 AM CT and pulls the
  // PREVIOUS day, so the most recent expected data date is "yesterday".
  const expectedDates = Array.from({ length: days }, (_, i) => subtractDays(yesterdayChicago, i));

  // Latest run per data date (runs are already sorted newest-first).
  const latestByDate = new Map<string, ScheduledRun>();
  for (const r of runs) {
    if (!latestByDate.has(r.runDate)) latestByDate.set(r.runDate, r);
  }

  const statusForDate = (date: string): DayStatus => {
    const r = latestByDate.get(date);
    if (!r) return "missing";
    if (r.stale) return "stale";
    return r.status as DayStatus;
  };

  const yesterdayMissing = runs.length > 0 && !latestByDate.has(yesterdayChicago);

  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-muted rounded px-2 py-0.5">
          <CalendarClock className="w-3 h-3" />
          {meta.humanLabel}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">{meta.description}</p>

      {!historyAvailable ? (
        <div className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
          Run history will appear here after the next scheduled run.
        </div>
      ) : runs.length === 0 ? (
        <div className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
          Awaiting first recorded run — logging starts with the next scheduled or manual run.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {expectedDates.map((date) => (
              <DayChip key={date} date={date} status={statusForDate(date)} />
            ))}
          </div>

          {yesterdayMissing && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-700">
              <AlertTriangle className="w-3.5 h-3.5" />
              Yesterday ({shortDate(yesterdayChicago)}) has no recorded run yet.
            </div>
          )}

          {latest && (
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock className="w-3 h-3" />
              Last run {relativeTime(latest.completedAt ?? latest.startedAt)}
              {latest.trigger === "manual" && " · manual"}
              {formatDuration(latest.durationMs) && ` · ${formatDuration(latest.durationMs)}`}
              {latest.status === "failed" && <span className="text-red-600 font-medium">· failed</span>}
              {latest.status === "skipped" && <span className="text-slate-600 font-medium">· skipped (paused)</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Prominent dashboard banner shown the morning a scheduled daily download was
 * skipped because downloads are paused. Renders only when BOTH are true:
 *   1. the latest contacts-daily run has status "skipped", and
 *   2. the daily paused marker still exists (download-job-status reports
 *      idle + step "paused"), i.e. the operator hasn't resumed yet.
 */
export function SkippedDownloadNotice() {
  const { data: history } = useScheduledJobsHistory(3);
  const { data: dailyStatus } = useQuery({
    queryKey: ["download-job-status"],
    queryFn: () =>
      api.get<{ status: string; step: string }>("/bq/download-job-status"),
    retry: false,
    refetchInterval: 60_000,
  });

  const latest = history?.jobs["contacts-daily"]?.runs?.[0];
  const latestSkipped = latest?.status === "skipped";
  const stillPaused = dailyStatus?.status === "idle" && dailyStatus?.step === "paused";

  if (!latestSkipped || !stillPaused) return null;

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
      <PauseCircle className="w-5 h-5 shrink-0 text-amber-600" />
      <p className="flex-1 min-w-[16rem] text-sm text-amber-800">
        <span className="font-semibold">Yesterday's recording download was skipped</span>{" "}
        because downloads are paused — Resume to catch up.
      </p>
      <Link href="/recordings">
        <span className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-amber-400 bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-200">
          Go to Recordings to Resume
          <ArrowRight className="w-3.5 h-3.5" />
        </span>
      </Link>
    </div>
  );
}

export function AutomatedDailyJobsCard() {
  const { data, isLoading, error } = useScheduledJobsHistory(3);

  return (
    <div className="border border-border rounded-lg bg-card p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <CalendarClock className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Automated Daily Jobs</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Scheduled pipelines and whether each day's data was pulled. Recent days shown newest first.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading schedule…
        </div>
      ) : error || !data ? (
        <div className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
          Unable to load scheduled-job status right now.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.schedules.map((meta) => (
            <PipelineBlock
              key={meta.jobName}
              meta={meta}
              runs={data.jobs[meta.jobName]?.runs ?? []}
              yesterdayChicago={data.yesterdayChicago}
              days={data.days}
              historyAvailable={data.historyAvailable}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Compact single-line schedule + last-pull indicator for a specific job. */
export function ScheduleIndicator({ jobName }: { jobName: string }) {
  const { data, isLoading } = useScheduledJobsHistory(3);

  if (isLoading || !data) return null;
  const meta = data.schedules.find((s) => s.jobName === jobName);
  if (!meta) return null;

  const runs = data.jobs[jobName]?.runs ?? [];
  const latest = runs[0];
  const latestByDate = new Map<string, ScheduledRun>();
  for (const r of runs) if (!latestByDate.has(r.runDate)) latestByDate.set(r.runDate, r);
  const yesterdayPulled = latestByDate.get(data.yesterdayChicago);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <CalendarClock className="w-3.5 h-3.5" />
        Runs automatically · {meta.humanLabel}
      </span>
      {latest ? (
        <span className="inline-flex items-center gap-1.5">
          {yesterdayPulled ? (
            yesterdayPulled.status === "failed" || yesterdayPulled.stale ? (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            ) : yesterdayPulled.status === "skipped" ? (
              <PauseCircle className="w-3.5 h-3.5 text-slate-600" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
            )
          ) : (
            <CircleDashed className="w-3.5 h-3.5 text-amber-600" />
          )}
          {yesterdayPulled
            ? `Yesterday (${shortDate(data.yesterdayChicago)}) ${yesterdayPulled.stale ? "stalled" : yesterdayPulled.status === "skipped" ? "skipped (paused)" : yesterdayPulled.status}`
            : `Yesterday (${shortDate(data.yesterdayChicago)}) not yet pulled`}
          <span className="text-muted-foreground/60">· last run {relativeTime(latest.completedAt ?? latest.startedAt)}</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <CircleDashed className="w-3.5 h-3.5" />
          No runs recorded yet
        </span>
      )}
    </div>
  );
}
