import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import { Plus, Plug, Edit, Trash2, ChevronDown, ChevronRight } from "lucide-react";

interface EndpointDef {
  endpointId: string;
  sourceSystemId: string;
  endpointName: string;
  httpMethod: string;
  relativePath: string;
  paginationStrategy: string;
  incrementalStrategy: string;
  scheduleCron: string | null;
  isActive: boolean;
  createdTs: string;
}

export default function EndpointsPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["endpoints"],
    queryFn: () => api.get<{ data: EndpointDef[] }>("/endpoints"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/endpoints/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["endpoints"] }),
  });

  const endpoints = data?.data ?? [];

  const methodColors: Record<string, string> = {
    GET: "bg-green-100 text-green-700",
    POST: "bg-blue-100 text-blue-700",
    PUT: "bg-orange-100 text-orange-700",
    PATCH: "bg-yellow-100 text-yellow-700",
    DELETE: "bg-red-100 text-red-700",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Endpoints</h1>
          <p className="text-sm text-muted-foreground mt-1">API endpoint definitions for extraction</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> Add Endpoint
        </button>
      </div>

      {showForm && (
        <EndpointForm onClose={() => setShowForm(false)} />
      )}

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : endpoints.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-lg">
          <Plug className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No endpoints defined</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground"></th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Method</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Endpoint</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Path</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Source</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Schedule</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((ep) => (
                <tr key={ep.endpointId} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <button onClick={() => setExpandedId(expandedId === ep.endpointId ? null : ep.endpointId)}>
                      {expandedId === ep.endpointId ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${methodColors[ep.httpMethod] ?? "bg-gray-100 text-gray-700"}`}>
                      {ep.httpMethod}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{ep.endpointName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{ep.relativePath}</td>
                  <td className="px-4 py-3 text-muted-foreground">{ep.sourceSystemId}</td>
                  <td className="px-4 py-3 font-mono text-xs">{ep.scheduleCron || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${ep.isActive ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                      {ep.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => deleteMutation.mutate(ep.endpointId)}
                      className="text-xs text-destructive hover:underline"
                    >
                      Deactivate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EndpointForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: systemsData } = useQuery({
    queryKey: ["source-systems"],
    queryFn: () => api.get<{ data: { sourceSystemId: string; sourceSystemName: string }[] }>("/source-systems"),
  });

  const [form, setForm] = useState({
    endpointId: "",
    sourceSystemId: "",
    endpointName: "",
    httpMethod: "GET",
    relativePath: "",
    paginationStrategy: "NONE",
    incrementalStrategy: "FULL_REFRESH",
    scheduleCron: "",
    isActive: true,
  });

  const mutation = useMutation({
    mutationFn: () => api.post("/endpoints", form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["endpoints"] });
      onClose();
    },
  });

  return (
    <div className="border border-border rounded-lg p-6 bg-card mb-6">
      <h3 className="font-semibold mb-4">Add Endpoint</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <input
          placeholder="Endpoint ID"
          value={form.endpointId}
          onChange={(e) => setForm({ ...form, endpointId: e.target.value })}
          className="px-3 py-2 border border-input rounded-md text-sm bg-background"
        />
        <select
          value={form.sourceSystemId}
          onChange={(e) => setForm({ ...form, sourceSystemId: e.target.value })}
          className="px-3 py-2 border border-input rounded-md text-sm bg-background"
        >
          <option value="">Select Source System</option>
          {(systemsData?.data ?? []).map((s) => (
            <option key={s.sourceSystemId} value={s.sourceSystemId}>{s.sourceSystemName}</option>
          ))}
        </select>
        <input
          placeholder="Endpoint Name"
          value={form.endpointName}
          onChange={(e) => setForm({ ...form, endpointName: e.target.value })}
          className="px-3 py-2 border border-input rounded-md text-sm bg-background"
        />
        <select
          value={form.httpMethod}
          onChange={(e) => setForm({ ...form, httpMethod: e.target.value })}
          className="px-3 py-2 border border-input rounded-md text-sm bg-background"
        >
          {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <input
          placeholder="Relative Path (e.g. /v1/contacts)"
          value={form.relativePath}
          onChange={(e) => setForm({ ...form, relativePath: e.target.value })}
          className="px-3 py-2 border border-input rounded-md text-sm bg-background md:col-span-2"
        />
        <select
          value={form.paginationStrategy}
          onChange={(e) => setForm({ ...form, paginationStrategy: e.target.value })}
          className="px-3 py-2 border border-input rounded-md text-sm bg-background"
        >
          {["NONE", "PAGE_NUMBER", "OFFSET_LIMIT", "NEXT_TOKEN"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={form.incrementalStrategy}
          onChange={(e) => setForm({ ...form, incrementalStrategy: e.target.value })}
          className="px-3 py-2 border border-input rounded-md text-sm bg-background"
        >
          {["FULL_REFRESH", "DATE_WINDOW", "CURSOR", "UNKNOWN"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input
          placeholder="Cron Schedule (optional, e.g. 0 6 * * *)"
          value={form.scheduleCron}
          onChange={(e) => setForm({ ...form, scheduleCron: e.target.value })}
          className="px-3 py-2 border border-input rounded-md text-sm bg-background"
        />
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {mutation.isPending ? "Creating..." : "Create"}
        </button>
        <button onClick={onClose} className="px-4 py-2 border border-border rounded-md text-sm hover:bg-muted">Cancel</button>
        {mutation.isError && (
          <span className="text-sm text-destructive self-center">{(mutation.error as Error).message}</span>
        )}
      </div>
    </div>
  );
}
