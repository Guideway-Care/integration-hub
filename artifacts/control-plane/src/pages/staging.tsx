import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import { Database, Plus, RotateCcw, Trash2, Play, Loader2, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MetricsSkeleton, TableSkeleton } from "@/components/table-skeleton";

interface StagingSummary {
  pending: number;
  processing: number;
  downloaded: number;
  failed: number;
  total: number;
}

interface QueueItem {
  id: string;
  call_id: string;
  status: string;
  error_message: string | null;
  batch_id: string | null;
  created_at: string;
  processed_at: string | null;
}

export default function StagingPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [callIds, setCallIds] = useState("");
  const [batchId, setBatchId] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["staging-summary"],
    queryFn: () => api.get<StagingSummary>("/bq/staging-summary"),
    retry: false,
  });

  const { data: queue, isLoading: queueLoading, error: queueError } = useQuery({
    queryKey: ["staging-queue"],
    queryFn: () => api.get<QueueItem[]>("/bq/staging-queue"),
    retry: false,
  });

  const { data: callListStatus } = useQuery({
    queryKey: ["call-list-status"],
    queryFn: () => api.get<{ exists: boolean; lineCount: number }>("/bq/call-list-status"),
    retry: false,
  });

  const addMutation = useMutation({
    mutationFn: () => {
      const ids = callIds
        .split(/[\n,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      return api.post<{ added: number; batchId: string }>("/bq/staging-add", {
        callIds: ids,
        batchId: batchId || undefined,
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["staging-summary"] });
      queryClient.invalidateQueries({ queryKey: ["staging-queue"] });
      setCallIds("");
      setBatchId("");
      toast({ title: "Call IDs added", description: `${data.added} call ID(s) added to the staging queue.` });
    },
    onError: (err) => {
      toast({ title: "Failed to add call IDs", description: (err as Error).message, variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => api.post("/bq/staging-reset-failed"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staging-summary"] });
      queryClient.invalidateQueries({ queryKey: ["staging-queue"] });
      toast({ title: "Failed rows reset", description: "All failed rows have been reset to pending." });
    },
    onError: (err) => {
      toast({ title: "Reset failed", description: (err as Error).message, variant: "destructive" });
    },
  });

  const runJobMutation = useMutation({
    mutationFn: () => api.post("/bq/run-job"),
    onSuccess: () => {
      toast({ title: "Job started", description: "Call Processor job has been triggered on Cloud Run." });
    },
    onError: (err) => {
      toast({ title: "Job failed to start", description: (err as Error).message, variant: "destructive" });
    },
  });

  const runLoaderMutation = useMutation({
    mutationFn: () => api.post("/bq/run-loader"),
    onSuccess: () => {
      toast({ title: "Job started", description: "Call Loader job has been triggered on Cloud Run." });
    },
    onError: (err) => {
      toast({ title: "Job failed to start", description: (err as Error).message, variant: "destructive" });
    },
  });

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-700",
    processing: "bg-blue-100 text-blue-700",
    downloaded: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
  };

  const allItems = queue ?? [];
  const totalPages = Math.max(1, Math.ceil(allItems.length / pageSize));
  const clampedPage = Math.min(page, totalPages - 1);
  if (clampedPage !== page) setPage(clampedPage);
  const pagedItems = allItems.slice(clampedPage * pageSize, (clampedPage + 1) * pageSize);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Staging Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage the InContact call recording staging queue in BigQuery
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/api/export/staging-queue?format=csv"
            download
            className="text-xs border border-border rounded px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-1.5"
          >
            <Download className="w-3 h-3" />
            CSV
          </a>
          <a
            href="/api/export/staging-queue?format=json"
            download
            className="text-xs border border-border rounded px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-1.5"
          >
            <Download className="w-3 h-3" />
            JSON
          </a>
        </div>
      </div>

      {queueError ? (
        <div className="border border-destructive/30 rounded-lg p-4 bg-destructive/5 mb-6">
          <p className="text-sm text-destructive">
            Unable to connect to BigQuery. Make sure GCP credentials are configured.
          </p>
        </div>
      ) : null}

      {summaryLoading ? (
        <div className="mb-6"><MetricsSkeleton /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-5 mb-6">
          {["pending", "processing", "downloaded", "failed", "total"].map((key) => (
            <div key={key} className="border border-border rounded-lg p-3 bg-card text-center">
              <div className="text-2xl font-bold">{summary?.[key as keyof StagingSummary] ?? "—"}</div>
              <div className="text-xs text-muted-foreground capitalize">{key}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 mb-6">
        <div className="border border-border rounded-lg p-4 bg-card">
          <h3 className="text-sm font-semibold mb-3">Add Call IDs</h3>
          <textarea
            value={callIds}
            onChange={(e) => setCallIds(e.target.value)}
            placeholder="Enter call IDs (one per line or comma-separated)"
            rows={4}
            className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background resize-none mb-2"
          />
          <input
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            placeholder="Batch ID (optional)"
            className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background mb-3"
          />
          <button
            onClick={() => addMutation.mutate()}
            disabled={!callIds.trim() || addMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add to Queue
          </button>
        </div>

        <div className="border border-border rounded-lg p-4 bg-card">
          <h3 className="text-sm font-semibold mb-3">Actions</h3>
          <div className="space-y-2">
            <button
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
              className="w-full inline-flex items-center gap-2 px-3 py-2 border border-border rounded-md text-sm hover:bg-muted disabled:opacity-50"
            >
              {resetMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              Reset Failed to Pending
            </button>
            <button
              onClick={() => runJobMutation.mutate()}
              disabled={runJobMutation.isPending}
              className="w-full inline-flex items-center gap-2 px-3 py-2 border border-border rounded-md text-sm hover:bg-muted disabled:opacity-50"
            >
              {runJobMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Run Call Processor Job
            </button>
            <button
              onClick={() => runLoaderMutation.mutate()}
              disabled={runLoaderMutation.isPending}
              className="w-full inline-flex items-center gap-2 px-3 py-2 border border-border rounded-md text-sm hover:bg-muted disabled:opacity-50"
            >
              {runLoaderMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              Run Call Loader Job
            </button>
          </div>
          {callListStatus && (
            <div className="mt-3 text-xs text-muted-foreground">
              Call list file: {callListStatus.exists ? `${callListStatus.lineCount} IDs` : "Not found"}
            </div>
          )}
        </div>
      </div>

      {queueLoading ? (
        <TableSkeleton rows={8} cols={6} />
      ) : (
        <>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Call ID</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Batch</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Created</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Processed</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Error</th>
                </tr>
              </thead>
              <tbody>
                {pagedItems.map((item) => (
                  <tr key={item.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs">{item.call_id}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColors[item.status] ?? ""}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{item.batch_id || "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{item.created_at ? new Date(item.created_at).toLocaleString() : "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{item.processed_at ? new Date(item.processed_at).toLocaleString() : "—"}</td>
                    <td className="px-4 py-3 text-xs text-destructive max-w-[200px] truncate">{item.error_message || ""}</td>
                  </tr>
                ))}
                {pagedItems.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      {queueError ? "Unable to load queue data" : "No items in queue"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-xs text-muted-foreground">
                Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, allItems.length)} of {allItems.length}
              </span>
              <div className="flex gap-1">
                <button
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                  className="p-1.5 border border-border rounded hover:bg-muted disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(page + 1)}
                  className="p-1.5 border border-border rounded hover:bg-muted disabled:opacity-30 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
