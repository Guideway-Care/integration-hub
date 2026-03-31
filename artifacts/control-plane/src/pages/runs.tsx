import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Link } from "wouter";
import { Play, XCircle, RotateCcw, Eye, Clock, CheckCircle, AlertCircle, Ban } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TableSkeleton } from "@/components/table-skeleton";

interface Run {
  runId: string;
  sourceSystemId: string;
  endpointId: string;
  runType: string;
  requestedBy: string | null;
  status: string;
  startedTs: string | null;
  endedTs: string | null;
  apiCallCount: number;
  pageCount: number;
  errorCount: number;
  createdTs: string;
}

const statusConfig: Record<string, { icon: any; color: string }> = {
  PENDING: { icon: Clock, color: "bg-yellow-100 text-yellow-700" },
  RUNNING: { icon: Play, color: "bg-blue-100 text-blue-700" },
  COMPLETED: { icon: CheckCircle, color: "bg-green-100 text-green-700" },
  FAILED: { icon: AlertCircle, color: "bg-red-100 text-red-700" },
  CANCELLED: { icon: Ban, color: "bg-gray-100 text-gray-700" },
  REPLAYED: { icon: RotateCcw, color: "bg-purple-100 text-purple-700" },
};

export default function RunsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ["runs"],
    queryFn: () => api.get<{ data: Run[]; meta: { total: number } }>("/runs?limit=50"),
    refetchInterval: 5000,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/runs/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      toast({ title: "Run cancelled", description: "The extraction run has been cancelled." });
    },
    onError: (err) => {
      toast({ title: "Cancel failed", description: (err as Error).message, variant: "destructive" });
    },
  });

  const replayMutation = useMutation({
    mutationFn: (id: string) => api.post(`/runs/${id}/replay`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      toast({ title: "Replay started", description: "A new extraction run has been triggered." });
    },
    onError: (err) => {
      toast({ title: "Replay failed", description: (err as Error).message, variant: "destructive" });
    },
  });

  const runs = data?.data ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Extraction Runs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data?.meta?.total ?? 0} total runs
          </p>
        </div>
        <Link href="/runs/new">
          <button className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90">
            <Play className="w-4 h-4" /> New Run
          </button>
        </Link>
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={9} />
      ) : error ? (
        <div className="border border-destructive/30 rounded-lg p-4 bg-destructive/5">
          <p className="text-sm text-destructive">Failed to load extraction runs.</p>
          <p className="text-xs text-muted-foreground mt-1">{(error as Error).message}</p>
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-lg">
          <Play className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No extraction runs yet</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Endpoint</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">By</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">API Calls</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Pages</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Errors</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Created</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const sc = statusConfig[run.status] || statusConfig.PENDING;
                const Icon = sc.icon;
                return (
                  <tr key={run.runId} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${sc.color}`}>
                        <Icon className="w-3 h-3" /> {run.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{run.endpointId}</td>
                    <td className="px-4 py-3 text-muted-foreground">{run.runType}</td>
                    <td className="px-4 py-3 text-muted-foreground">{run.requestedBy || "—"}</td>
                    <td className="px-4 py-3 text-center">{run.apiCallCount}</td>
                    <td className="px-4 py-3 text-center">{run.pageCount}</td>
                    <td className="px-4 py-3 text-center">
                      {run.errorCount > 0 && (
                        <span className="text-destructive font-medium">{run.errorCount}</span>
                      )}
                      {run.errorCount === 0 && "0"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(run.createdTs).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <Link href={`/runs/${run.runId}`}>
                          <button className="p-1 hover:bg-muted rounded" title="View">
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </Link>
                        {["PENDING", "RUNNING"].includes(run.status) && (
                          <button
                            onClick={() => cancelMutation.mutate(run.runId)}
                            className="p-1 hover:bg-destructive/10 rounded text-destructive"
                            title="Cancel"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {["FAILED", "COMPLETED"].includes(run.status) && (
                          <button
                            onClick={() => replayMutation.mutate(run.runId)}
                            className="p-1 hover:bg-muted rounded"
                            title="Replay"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
