import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AudioLines, AlertTriangle, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";

interface TranscriptionStatus {
  backlog: number;
  totals: {
    total: number;
    completed: number;
    errors: number;
    transcribed24h: number;
    cost24h: number;
    lastProcessedAt: string | null;
  };
  daily: {
    day: string;
    calls: number;
    errors: number;
    deepgramCost: number;
    geminiCost: number;
  }[];
  job: {
    name: string | null;
    createTime: string | null;
    completionTime: string | null;
    state: "running" | "succeeded" | "failed";
  } | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || Number.isNaN(ms)) return "—";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function TranscriptionCard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["transcription-status"],
    queryFn: () => api.get<TranscriptionStatus>("/bq/transcription-status"),
    refetchInterval: 60_000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="border border-border rounded-lg p-4 bg-card mb-6">
        <div className="flex items-center gap-2 mb-3">
          <AudioLines className="w-4 h-4 text-purple-500" />
          <h3 className="text-sm font-semibold">Transcription Pipeline</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="border border-border rounded-lg p-4 bg-card mb-6">
        <div className="flex items-center gap-2">
          <AudioLines className="w-4 h-4 text-purple-500" />
          <h3 className="text-sm font-semibold">Transcription Pipeline</h3>
          <span className="text-xs text-muted-foreground ml-auto">
            {error ? "Failed to load transcription status" : "No data"}
          </span>
        </div>
      </div>
    );
  }

  const jobLabel = !data.job
    ? "unknown"
    : data.job.state === "running"
      ? `running (started ${timeAgo(data.job.createTime)})`
      : `${data.job.state} ${timeAgo(data.job.completionTime)}`;

  return (
    <div className="border border-border rounded-lg p-4 bg-card mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <AudioLines className="w-4 h-4 text-purple-500" />
          Transcription Pipeline
          {data.backlog > 5000 && <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />}
        </h3>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {data.job?.state === "running" && (
            <RefreshCw className="w-3 h-3 animate-spin text-blue-500" />
          )}
          <span>
            audioflow job:{" "}
            <span
              className={
                data.job?.state === "failed"
                  ? "text-red-600 font-medium"
                  : data.job?.state === "running"
                    ? "text-blue-600 font-medium"
                    : "text-foreground"
              }
            >
              {jobLabel}
            </span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center mb-3">
        <div>
          <div className={`text-lg font-bold ${data.backlog > 5000 ? "text-yellow-600" : "text-foreground"}`}>
            {data.backlog.toLocaleString()}
          </div>
          <div className="text-[10px] text-muted-foreground">Awaiting Transcription (30d)</div>
        </div>
        <div>
          <div className="text-lg font-bold text-blue-600">{data.totals.transcribed24h.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground">Transcribed (24h)</div>
        </div>
        <div>
          <div className="text-lg font-bold text-foreground">{fmtUsd(data.totals.cost24h)}</div>
          <div className="text-[10px] text-muted-foreground">Cost (24h)</div>
        </div>
        <div>
          <div className="text-lg font-bold text-green-600">{data.totals.completed.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground">Total Transcribed</div>
        </div>
        <div>
          <div className={`text-lg font-bold ${data.totals.errors > 0 ? "text-red-600" : "text-muted-foreground"}`}>
            {data.totals.errors.toLocaleString()}
          </div>
          <div className="text-[10px] text-muted-foreground">Errors (all-time)</div>
        </div>
      </div>

      {data.daily.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left font-medium py-1.5 pr-2">Day</th>
                <th className="text-right font-medium py-1.5 px-2">Calls</th>
                <th className="text-right font-medium py-1.5 px-2">Errors</th>
                <th className="text-right font-medium py-1.5 px-2">Deepgram</th>
                <th className="text-right font-medium py-1.5 pl-2">Gemini</th>
              </tr>
            </thead>
            <tbody>
              {data.daily.map((d) => (
                <tr key={d.day} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 pr-2 font-mono">{d.day}</td>
                  <td className="py-1.5 px-2 text-right">{d.calls.toLocaleString()}</td>
                  <td className={`py-1.5 px-2 text-right ${d.errors > 0 ? "text-red-600" : "text-muted-foreground"}`}>
                    {d.errors}
                  </td>
                  <td className="py-1.5 px-2 text-right">{fmtUsd(d.deepgramCost)}</td>
                  <td className="py-1.5 pl-2 text-right">{fmtUsd(d.geminiCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Last transcript processed {timeAgo(data.totals.lastProcessedAt)}</span>
        <Link href="/recordings">
          <span className="text-primary hover:underline cursor-pointer">Open Recordings</span>
        </Link>
      </div>
    </div>
  );
}
