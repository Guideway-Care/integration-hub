import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useParams, Link } from "wouter";
import { ArrowLeft, Clock, AlertCircle, CheckCircle, Info } from "lucide-react";

interface RunDetail {
  runId: string;
  sourceSystemId: string;
  endpointId: string;
  runType: string;
  requestedBy: string | null;
  status: string;
  cloudRunJobName: string | null;
  cloudRunExecutionId: string | null;
  windowStartTs: string | null;
  windowEndTs: string | null;
  startedTs: string | null;
  endedTs: string | null;
  apiCallCount: number;
  pageCount: number;
  errorCount: number;
  errorSummary: string | null;
  createdTs: string;
  events: Array<{
    eventId: string;
    eventTs: string;
    eventType: string;
    severity: string;
    message: string | null;
  }>;
}

const severityColors: Record<string, string> = {
  INFO: "text-blue-600",
  WARN: "text-yellow-600",
  ERROR: "text-red-600",
};

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ["run", params.id],
    queryFn: () => api.get<{ data: RunDetail }>(`/runs/${params.id}`),
    refetchInterval: 5000,
  });

  const run = data?.data;

  if (isLoading) return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  if (!run) return <div className="text-center py-12 text-muted-foreground">Run not found</div>;

  return (
    <div>
      <Link href="/runs">
        <button className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Runs
        </button>
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold">Run Detail</h1>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
          run.status === "COMPLETED" ? "bg-green-100 text-green-700" :
          run.status === "FAILED" ? "bg-red-100 text-red-700" :
          run.status === "RUNNING" ? "bg-blue-100 text-blue-700" :
          "bg-yellow-100 text-yellow-700"
        }`}>
          {run.status}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
        {[
          { label: "Endpoint", value: run.endpointId },
          { label: "Source System", value: run.sourceSystemId },
          { label: "Type", value: run.runType },
          { label: "Requested By", value: run.requestedBy || "—" },
          { label: "API Calls", value: run.apiCallCount.toString() },
          { label: "Pages", value: run.pageCount.toString() },
          { label: "Errors", value: run.errorCount.toString() },
          { label: "Created", value: new Date(run.createdTs).toLocaleString() },
        ].map((item) => (
          <div key={item.label} className="border border-border rounded-lg p-3 bg-card">
            <div className="text-xs text-muted-foreground mb-1">{item.label}</div>
            <div className="font-medium text-sm">{item.value}</div>
          </div>
        ))}
      </div>

      {run.errorSummary && (
        <div className="border border-destructive/30 rounded-lg p-4 bg-destructive/5 mb-6">
          <div className="flex items-center gap-2 text-destructive font-medium text-sm mb-1">
            <AlertCircle className="w-4 h-4" /> Error Summary
          </div>
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap">{run.errorSummary}</pre>
        </div>
      )}

      <h2 className="text-lg font-semibold mb-3">Event Log</h2>
      {run.events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No events recorded</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Time</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Type</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Severity</th>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Message</th>
              </tr>
            </thead>
            <tbody>
              {run.events.map((evt) => (
                <tr key={evt.eventId} className="border-t border-border">
                  <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(evt.eventTs).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{evt.eventType}</td>
                  <td className={`px-4 py-2 text-xs font-medium ${severityColors[evt.severity] ?? ""}`}>
                    {evt.severity}
                  </td>
                  <td className="px-4 py-2 text-xs">{evt.message || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
