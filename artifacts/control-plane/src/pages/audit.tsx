import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import { ClipboardList, RefreshCw, Filter } from "lucide-react";

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: string | null;
  details: any;
  createdTs: string;
}

const entityTypes = [
  { value: "", label: "All Types" },
  { value: "source_system", label: "Source Systems" },
  { value: "endpoint", label: "Endpoints" },
  { value: "extraction_run", label: "Extraction Runs" },
  { value: "incontact", label: "InContact" },
];

function actionColor(action: string): string {
  if (action.includes("CREATE")) return "text-green-600 bg-green-50";
  if (action.includes("UPDATE")) return "text-blue-600 bg-blue-50";
  if (action.includes("DELETE") || action.includes("DEACTIVATE")) return "text-red-600 bg-red-50";
  if (action.includes("TRIGGER") || action.includes("RUN")) return "text-indigo-600 bg-indigo-50";
  if (action.includes("CANCEL")) return "text-yellow-600 bg-yellow-50";
  if (action.includes("REPLAY")) return "text-purple-600 bg-purple-50";
  return "text-gray-600 bg-gray-50";
}

export default function AuditPage() {
  const [entityType, setEntityType] = useState("");
  const [page, setPage] = useState(0);
  const limit = 30;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["audit", entityType, page],
    queryFn: () =>
      api.get<{ data: AuditEntry[]; meta: { total: number; limit: number; offset: number } }>(
        `/audit?limit=${limit}&offset=${page * limit}${entityType ? `&entityType=${entityType}` : ""}`
      ),
  });

  const entries = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ClipboardList className="w-6 h-6" />
            Audit Log
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track all changes across the platform
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="text-xs text-muted-foreground border border-border rounded px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-1.5"
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <select
          value={entityType}
          onChange={(e) => { setEntityType(e.target.value); setPage(0); }}
          className="text-sm border border-border rounded px-2 py-1.5 bg-background text-foreground"
        >
          {entityTypes.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">{total} entries</span>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
          Loading audit log...
        </div>
      ) : error ? (
        <div className="border border-destructive/30 rounded-lg p-4 bg-destructive/5">
          <p className="text-sm text-destructive">Failed to load audit log</p>
          <p className="text-xs text-muted-foreground mt-1">{(error as Error).message}</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-lg">
          <ClipboardList className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No audit entries yet</p>
          <p className="text-xs text-muted-foreground mt-1">Actions will appear here as changes are made</p>
        </div>
      ) : (
        <>
          <div className="border border-border rounded-lg overflow-hidden bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Timestamp</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Action</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Entity Type</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Entity ID</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(entry.createdTs).toLocaleString()}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${actionColor(entry.action)}`}>
                          {entry.action}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs font-mono">{entry.entityType}</td>
                      <td className="px-4 py-2 text-xs font-mono text-foreground max-w-[200px] truncate">
                        {entry.entityId || "—"}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground max-w-[250px] truncate">
                        {entry.details ? JSON.stringify(entry.details) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <button
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
                className="text-xs border border-border rounded px-3 py-1.5 disabled:opacity-50 hover:bg-muted transition-colors"
              >
                Previous
              </button>
              <span className="text-xs text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage(page + 1)}
                className="text-xs border border-border rounded px-3 py-1.5 disabled:opacity-50 hover:bg-muted transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
