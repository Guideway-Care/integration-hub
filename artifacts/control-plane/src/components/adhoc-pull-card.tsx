import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import {
  Play,
  Loader2,
  Eye,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  X,
  Clock,
  Download,
} from "lucide-react";

type PreviewDiagnostics = {
  totalMatchingAnyDate: number;
  totalMatchingInRange: number;
  alreadyDownloaded: number;
  minDate: string | null;
  maxDate: string | null;
};
type PreviewResp = { count: number; sample: string[]; diagnostics?: PreviewDiagnostics };
type AdhocResp = { queued: number; batchId?: string; gcsPath?: string; message?: string };
type AdhocStatus = {
  status: "idle" | "running" | "completed" | "failed";
  step: string;
  batchId?: string;
  gcsPath?: string;
  startedAt?: string;
  completedAt?: string;
  loaderExecution?: string;
  processorExecution?: string;
  error?: string;
};
type DailyStatus = { status: string; phase?: string };

function todayMinusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function MultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  disabled,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = useMemo(
    () => options.filter((o) => o.toLowerCase().includes(search.toLowerCase())),
    [options, search],
  );
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className="w-full min-h-[36px] px-2 py-1.5 border border-input rounded-md text-sm bg-background flex items-center flex-wrap gap-1 text-left disabled:opacity-50"
      >
        {selected.length === 0 ? (
          <span className="text-muted-foreground text-xs">{placeholder}</span>
        ) : (
          selected.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded text-xs"
            >
              {s}
              <X
                className="w-3 h-3 cursor-pointer hover:opacity-70"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(selected.filter((x) => x !== s));
                }}
              />
            </span>
          ))
        )}
        <ChevronDown className="w-3 h-3 ml-auto text-muted-foreground shrink-0" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute z-20 left-0 right-0 mt-1 max-h-64 overflow-auto border border-border rounded-md bg-popover shadow-lg">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search dispositions..."
              className="w-full px-2 py-1.5 border-b border-border text-xs bg-background sticky top-0"
            />
            {filtered.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground text-center">No matches</div>
            )}
            {filtered.map((opt) => {
              const isSel = selected.includes(opt);
              return (
                <button
                  type="button"
                  key={opt}
                  onClick={() =>
                    onChange(isSel ? selected.filter((x) => x !== opt) : [...selected, opt])
                  }
                  className={`w-full px-2 py-1.5 text-xs text-left hover:bg-muted flex items-center gap-2 ${
                    isSel ? "bg-primary/5 font-medium" : ""
                  }`}
                >
                  <input type="checkbox" checked={isSel} readOnly className="pointer-events-none" />
                  <span className="truncate">{opt}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function AdhocPullCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [campaign, setCampaign] = useState("");
  const [dispositions, setDispositions] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState(() => todayMinusDays(7));
  const [dateTo, setDateTo] = useState(() => todayMinusDays(0));
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);

  const { data: campaigns } = useQuery({
    queryKey: ["bq-campaigns"],
    queryFn: () => api.get<{ data: string[] }>("/bq/distinct-campaigns").catch(() => ({ data: [] })),
  });

  const { data: dispositionOptions, isFetching: dispositionsLoading } = useQuery({
    queryKey: ["bq-dispositions", campaign],
    queryFn: () =>
      api
        .get<{ data: string[] }>(
          campaign
            ? `/bq/distinct-dispositions?campaign=${encodeURIComponent(campaign)}`
            : "/bq/distinct-dispositions",
        )
        .catch(() => ({ data: [] })),
  });

  const { data: dailyStatus } = useQuery({
    queryKey: ["download-job-status"],
    queryFn: () => api.get<DailyStatus>("/bq/download-job-status").catch(() => ({ status: "idle" } as DailyStatus)),
    refetchInterval: 15000,
  });

  const { data: adhocStatus } = useQuery({
    queryKey: ["adhoc-download-job-status"],
    queryFn: () => api.get<AdhocStatus>("/bq/adhoc-download-job-status"),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 3000 : 15000),
  });

  // Reset selected dispositions when campaign changes
  useEffect(() => {
    setDispositions([]);
    setPreview(null);
  }, [campaign]);

  const isAdhocActive = adhocStatus?.status === "running";
  const isDailyActive = dailyStatus?.status === "running";
  const isAnyDownloadActive = isAdhocActive || isDailyActive;

  const inputsValid =
    campaign.trim().length > 0 &&
    dispositions.length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) &&
    /^\d{4}-\d{2}-\d{2}$/.test(dateTo) &&
    dateFrom <= dateTo;

  const previewMutation = useMutation({
    mutationFn: () =>
      api.post<PreviewResp>("/bq/queue-recordings/preview", {
        campaignName: campaign,
        dispositionPatterns: dispositions,
        dateFrom,
        dateTo,
      }),
    onSuccess: (data) => {
      setPreview(data);
      toast({ title: "Preview", description: `${data.count.toLocaleString()} contacts match` });
    },
    onError: (err) =>
      toast({ title: "Preview failed", description: (err as Error).message, variant: "destructive" }),
  });

  const queueAndRunMutation = useMutation({
    mutationFn: async () => {
      const queued = await api.post<AdhocResp>("/bq/queue-recordings/adhoc", {
        campaignName: campaign,
        dispositionPatterns: dispositions,
        dateFrom,
        dateTo,
      });
      if (!queued.batchId || queued.queued === 0) return queued;
      await api.post<unknown>("/bq/queue-recordings/adhoc/run", { batchId: queued.batchId });
      return queued;
    },
    onSuccess: (data) => {
      if (!data.batchId || data.queued === 0) {
        toast({ title: "Nothing to download", description: data.message || "No matching pending contacts" });
        return;
      }
      setActiveBatchId(data.batchId);
      toast({
        title: "Ad-hoc download started",
        description: `Batch ${data.batchId} — ${data.queued.toLocaleString()} contacts`,
      });
      queryClient.invalidateQueries({ queryKey: ["adhoc-download-job-status"] });
    },
    onError: (err) =>
      toast({ title: "Failed to start download", description: (err as Error).message, variant: "destructive" }),
  });

  // Refresh recordings list when ad-hoc job completes
  useEffect(() => {
    if (adhocStatus?.status === "completed" && activeBatchId) {
      queryClient.invalidateQueries({ queryKey: ["recordings"] });
    }
  }, [adhocStatus?.status, activeBatchId, queryClient]);

  const showStatus = adhocStatus && adhocStatus.status !== "idle";

  return (
    <div className="border border-border rounded-lg bg-card mb-6">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Download className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold">Ad-hoc Recording Pull</h2>
        <span className="text-xs text-muted-foreground">
          Queue and download recordings for a specific campaign + dispositions + date range
        </span>
      </div>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Campaign</label>
            <input
              list="adhoc-campaign-list"
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
              placeholder="Start typing or select a campaign..."
              className="w-full px-2 py-1.5 border border-input rounded-md text-sm bg-background"
            />
            <datalist id="adhoc-campaign-list">
              {(campaigns?.data ?? []).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Date From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-2 py-1.5 border border-input rounded-md text-sm bg-background"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Date To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-2 py-1.5 border border-input rounded-md text-sm bg-background"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Dispositions {dispositionsLoading && <span className="opacity-60">(loading...)</span>}
          </label>
          <MultiSelect
            options={dispositionOptions?.data ?? []}
            selected={dispositions}
            onChange={(next) => {
              setDispositions(next);
              setPreview(null);
            }}
            placeholder={
              campaign
                ? "Select one or more dispositions to include"
                : "Pick a campaign first to load dispositions"
            }
            disabled={!campaign}
          />
          {!campaign && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Dispositions are filtered to those seen on the selected campaign.
            </p>
          )}
        </div>

        {dateFrom > dateTo && (
          <div className="flex items-center gap-2 text-xs text-red-600">
            <AlertTriangle className="w-3 h-3" />
            Date From must be on or before Date To
          </div>
        )}

        {isDailyActive && !isAdhocActive && (
          <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            Daily download pipeline is currently running ({dailyStatus?.phase || "—"}). Ad-hoc runs are blocked until it finishes.
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => previewMutation.mutate()}
            disabled={!inputsValid || previewMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-md text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            {previewMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Eye className="w-3 h-3" />
            )}
            Preview
          </button>
          <button
            type="button"
            onClick={() => queueAndRunMutation.mutate()}
            disabled={!inputsValid || queueAndRunMutation.isPending || isAnyDownloadActive}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:opacity-90 disabled:opacity-50"
            title={
              isDailyActive
                ? "Blocked while the daily download is running"
                : isAdhocActive
                  ? "An ad-hoc download is already in progress"
                  : "Queue contacts to GCS and start the download pipeline"
            }
          >
            {queueAndRunMutation.isPending || isAdhocActive ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            Queue & Download
          </button>

          {preview && (
            <span className="ml-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{preview.count.toLocaleString()}</span>{" "}
              pending contact{preview.count === 1 ? "" : "s"} match
              {preview.sample.length > 0 && (
                <span className="ml-2 opacity-70">
                  e.g. {preview.sample.slice(0, 3).join(", ")}
                </span>
              )}
            </span>
          )}
        </div>

        {preview?.diagnostics && (
          <div className="mt-2 p-3 rounded-md border border-border bg-muted/40 text-xs space-y-1">
            <div className="font-medium text-foreground">Match breakdown</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-muted-foreground">
              <div>
                <span className="font-semibold text-foreground">
                  {preview.diagnostics.totalMatchingAnyDate.toLocaleString()}
                </span>{" "}
                total calls match campaign + dispositions
              </div>
              <div>
                <span className="font-semibold text-foreground">
                  {preview.diagnostics.totalMatchingInRange.toLocaleString()}
                </span>{" "}
                of those fall in {dateFrom} → {dateTo}
              </div>
              <div>
                <span className="font-semibold text-foreground">
                  {preview.diagnostics.alreadyDownloaded.toLocaleString()}
                </span>{" "}
                already downloaded (excluded)
              </div>
              <div>
                <span className="font-semibold text-foreground">
                  {preview.count.toLocaleString()}
                </span>{" "}
                pending — what gets queued
              </div>
            </div>
            {(preview.diagnostics.minDate || preview.diagnostics.maxDate) && (
              <div className="text-muted-foreground pt-1 border-t border-border/50">
                Available data for these dispositions spans{" "}
                <span className="font-mono text-foreground">{preview.diagnostics.minDate ?? "—"}</span>
                {" → "}
                <span className="font-mono text-foreground">{preview.diagnostics.maxDate ?? "—"}</span>
                {preview.count === 0 && preview.diagnostics.totalMatchingAnyDate > 0 &&
                  preview.diagnostics.totalMatchingInRange === 0 && (
                    <span className="ml-2 text-amber-700">
                      → no calls in your date range; widen it.
                    </span>
                  )}
                {preview.count === 0 && preview.diagnostics.totalMatchingInRange > 0 &&
                  preview.diagnostics.alreadyDownloaded === preview.diagnostics.totalMatchingInRange && (
                    <span className="ml-2 text-amber-700">
                      → everything in range was already downloaded.
                    </span>
                  )}
                {preview.diagnostics.totalMatchingAnyDate === 0 && (
                  <span className="ml-2 text-amber-700">
                    → no calls at all match this campaign + disposition combo.
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {showStatus && (
          <div
            className={`mt-2 p-3 rounded-md border text-xs space-y-1 ${
              adhocStatus!.status === "running"
                ? "bg-blue-50 border-blue-200 text-blue-800"
                : adhocStatus!.status === "completed"
                  ? "bg-green-50 border-green-200 text-green-800"
                  : "bg-red-50 border-red-200 text-red-800"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium inline-flex items-center gap-1.5">
                {adhocStatus!.status === "running" && <Loader2 className="w-3 h-3 animate-spin" />}
                {adhocStatus!.status === "completed" && <CheckCircle2 className="w-3 h-3" />}
                {adhocStatus!.status === "failed" && <XCircle className="w-3 h-3" />}
                Ad-hoc Download — {adhocStatus!.status.toUpperCase()}
                {adhocStatus!.step && ` · ${adhocStatus!.step}`}
              </span>
              <span className="text-[10px] opacity-75 inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {adhocStatus!.startedAt && `started ${new Date(adhocStatus!.startedAt).toLocaleTimeString()}`}
                {adhocStatus!.completedAt && ` · finished ${new Date(adhocStatus!.completedAt).toLocaleTimeString()}`}
              </span>
            </div>
            {adhocStatus!.batchId && (
              <div className="font-mono text-[11px] opacity-80">batch: {adhocStatus!.batchId}</div>
            )}
            {adhocStatus!.error && <div className="mt-1">Error: {adhocStatus!.error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
