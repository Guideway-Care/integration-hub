import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import {
  RefreshCw,
  Database,
  CheckCircle2,
  Clock,
  ListChecks,
  AlertTriangle,
  Loader2,
  Zap,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

interface DispositionStats {
  total: number;
  active: number;
  inactive: number;
  newestLastUpdated: string | null;
}

interface SyncResult {
  synced: number;
  timestamp?: string;
  message?: string;
}

function StatCard({
  label,
  value,
  icon: Icon,
  color = "text-primary",
  sub,
}: {
  label: string;
  value: string | number;
  icon: any;
  color?: string;
  sub?: string;
}) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="flex items-center justify-between mb-2">
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div className="text-2xl font-bold text-foreground">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export default function DispositionRefreshPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);

  const {
    data: stats,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["disposition-stats"],
    queryFn: () => api.get<DispositionStats>("/incontact/dispositions-stats"),
    retry: false,
  });

  const syncMutation = useMutation({
    mutationFn: () => api.post<SyncResult>("/incontact/sync-dispositions", {}),
    onSuccess: (data) => {
      setLastSync(data);
      toast({
        title: "Dispositions refreshed",
        description: `${data.synced.toLocaleString()} dispositions written to BigQuery`,
      });
      queryClient.invalidateQueries({ queryKey: ["disposition-stats"] });
    },
    onError: (err) => {
      toast({
        title: "Refresh failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    },
  });

  const syncing = syncMutation.isPending;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <RefreshCw className="w-6 h-6" />
            Disposition Refresh
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pull the latest disposition codes from NICE CXone into BigQuery.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs text-muted-foreground border border-border rounded px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          Refresh stats
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="border border-border rounded-lg p-4 bg-card">
              <Skeleton className="h-5 w-5 mb-2" />
              <Skeleton className="h-7 w-16 mb-1" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))
        ) : error ? (
          <div className="col-span-full border border-destructive/30 rounded-lg p-4 bg-destructive/5 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive mt-0.5" />
            <div>
              <p className="text-sm text-destructive">Could not load current disposition stats</p>
              <p className="text-xs text-muted-foreground mt-0.5">{(error as Error).message}</p>
            </div>
          </div>
        ) : (
          <>
            <StatCard
              label="Total dispositions"
              value={stats!.total}
              icon={ListChecks}
              color="text-indigo-500"
            />
            <StatCard
              label="Active"
              value={stats!.active}
              icon={CheckCircle2}
              color="text-green-600"
              sub={`${stats!.inactive.toLocaleString()} inactive`}
            />
            <StatCard
              label="Newest record"
              value={
                stats!.newestLastUpdated
                  ? new Date(stats!.newestLastUpdated).toLocaleDateString()
                  : "—"
              }
              icon={Clock}
              color="text-blue-500"
              sub="Max last_updated in table"
            />
          </>
        )}
      </div>

      <div className="border border-border rounded-lg p-5 bg-card mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              Refresh from NICE CXone
            </h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              Fetches all disposition codes from the NICE CXone Dispositions API and replaces the{" "}
              <code className="text-[11px] bg-muted px-1 py-0.5 rounded">incontact.dispositions</code>{" "}
              table with a fresh snapshot.
            </p>
          </div>
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncing}
            className="shrink-0 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {syncing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {syncing ? "Refreshing…" : "Refresh Dispositions"}
          </button>
        </div>

        {lastSync &&
          (lastSync.synced > 0 ? (
            <div className="mt-4 flex items-center gap-2 text-sm rounded-md border border-green-200 bg-green-50 px-3 py-2 text-green-700">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                Last refresh wrote{" "}
                <strong>{lastSync.synced.toLocaleString()}</strong> dispositions
                {lastSync.timestamp
                  ? ` · ${new Date(lastSync.timestamp).toLocaleString()}`
                  : ""}
              </span>
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-2 text-sm rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{lastSync.message ?? "No dispositions returned — table left unchanged."}</span>
            </div>
          ))}
      </div>

      <div className="border border-border rounded-lg p-5 bg-card">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Database className="w-4 h-4 text-muted-foreground" />
          How it works
        </h3>
        <ul className="space-y-2 text-sm text-muted-foreground list-disc pl-5">
          <li>
            Source:{" "}
            <code className="text-[11px] bg-muted px-1 py-0.5 rounded">
              GET /incontactapi/services/v28.0/dispositions
            </code>{" "}
            (NICE CXone), authenticated with the InContact access key from GCP Secret Manager.
          </li>
          <li>
            Destination:{" "}
            <code className="text-[11px] bg-muted px-1 py-0.5 rounded">incontact.dispositions</code>{" "}
            in BigQuery.
          </li>
          <li>
            <strong>Full replace</strong> — existing rows are deleted and re-inserted on every run.
            This is a point-in-time snapshot, not an append.
          </li>
          <li>
            Safe to re-run: if the API returns no dispositions, the table is left untouched.
          </li>
        </ul>
      </div>
    </div>
  );
}
