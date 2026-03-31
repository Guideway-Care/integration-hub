import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import { Plus, Edit, Trash2, Server, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

interface SourceSystem {
  sourceSystemId: string;
  sourceSystemName: string;
  baseUrl: string;
  authType: string;
  secretManagerSecretName: string | null;
  serviceAccountEmail: string | null;
  isActive: boolean;
  createdTs: string;
  updatedTs: string;
}

export default function SourceSystemsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["source-systems"],
    queryFn: () => api.get<{ data: SourceSystem[] }>("/source-systems"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/source-systems/${id}`),
    onSuccess: (_d, id) => {
      queryClient.invalidateQueries({ queryKey: ["source-systems"] });
      toast({ title: "System deactivated", description: `Source system "${id}" has been deactivated.` });
    },
    onError: (err) => {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    },
  });

  const systems = data?.data ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Source Systems</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage external API source systems for data extraction
          </p>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditingId(null); }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> Add System
        </button>
      </div>

      {showForm && (
        <SourceSystemForm
          editId={editingId}
          systems={systems}
          onClose={() => { setShowForm(false); setEditingId(null); }}
        />
      )}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="border border-border rounded-lg p-4 bg-card">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <Skeleton className="h-5 w-32 mb-1" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
              <div className="space-y-2 mt-3">
                <Skeleton className="h-3 w-48" />
                <Skeleton className="h-3 w-20" />
              </div>
              <div className="flex gap-2 mt-4">
                <Skeleton className="h-8 w-16 rounded-md" />
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      ) : systems.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-lg">
          <Server className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No source systems configured</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-3 text-sm text-primary hover:underline"
          >
            Add your first source system
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {systems.map((s) => (
            <div
              key={s.sourceSystemId}
              className="border border-border rounded-lg p-4 bg-card"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-semibold text-foreground">{s.sourceSystemName}</h3>
                  <code className="text-xs text-muted-foreground">{s.sourceSystemId}</code>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    s.isActive
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {s.isActive ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground mt-3">
                <div className="flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" />
                  <span className="truncate">{s.baseUrl}</span>
                </div>
                <div>Auth: {s.authType}</div>
                {s.secretManagerSecretName && (
                  <div>Secret: {s.secretManagerSecretName}</div>
                )}
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => { setEditingId(s.sourceSystemId); setShowForm(true); }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-border rounded-md hover:bg-muted"
                >
                  <Edit className="w-3 h-3" /> Edit
                </button>
                <button
                  onClick={() => deleteMutation.mutate(s.sourceSystemId)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs border border-destructive/30 text-destructive rounded-md hover:bg-destructive/10"
                >
                  <Trash2 className="w-3 h-3" /> Deactivate
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SourceSystemForm({
  editId,
  systems,
  onClose,
}: {
  editId: string | null;
  systems: SourceSystem[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const existing = editId ? systems.find((s) => s.sourceSystemId === editId) : null;
  const [form, setForm] = useState({
    sourceSystemId: existing?.sourceSystemId ?? "",
    sourceSystemName: existing?.sourceSystemName ?? "",
    baseUrl: existing?.baseUrl ?? "",
    authType: existing?.authType ?? "API_KEY",
    secretManagerSecretName: existing?.secretManagerSecretName ?? "",
    serviceAccountEmail: existing?.serviceAccountEmail ?? "",
    isActive: existing?.isActive ?? true,
  });

  const mutation = useMutation({
    mutationFn: () =>
      editId
        ? api.put(`/source-systems/${editId}`, form)
        : api.post("/source-systems", form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["source-systems"] });
      toast({
        title: editId ? "System updated" : "System created",
        description: `Source system "${form.sourceSystemName || form.sourceSystemId}" has been ${editId ? "updated" : "created"}.`,
      });
      onClose();
    },
    onError: (err) => {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    },
  });

  return (
    <div className="border border-border rounded-lg p-6 bg-card mb-6">
      <h3 className="font-semibold mb-4">{editId ? "Edit" : "Add"} Source System</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <input
          placeholder="System ID"
          value={form.sourceSystemId}
          onChange={(e) => setForm({ ...form, sourceSystemId: e.target.value })}
          disabled={!!editId}
          className="px-3 py-2 border border-input rounded-md text-sm bg-background disabled:opacity-50"
        />
        <input
          placeholder="System Name"
          value={form.sourceSystemName}
          onChange={(e) => setForm({ ...form, sourceSystemName: e.target.value })}
          className="px-3 py-2 border border-input rounded-md text-sm bg-background"
        />
        <input
          placeholder="Base URL"
          value={form.baseUrl}
          onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          className="px-3 py-2 border border-input rounded-md text-sm bg-background md:col-span-2"
        />
        <select
          value={form.authType}
          onChange={(e) => setForm({ ...form, authType: e.target.value })}
          className="px-3 py-2 border border-input rounded-md text-sm bg-background"
        >
          <option value="API_KEY">API Key</option>
          <option value="OAUTH2_CLIENT_CREDENTIALS">OAuth2 Client Credentials</option>
          <option value="BASIC">Basic Auth</option>
          <option value="BEARER_TOKEN">Bearer Token</option>
        </select>
        <input
          placeholder="Secret Manager Secret Name (optional)"
          value={form.secretManagerSecretName}
          onChange={(e) => setForm({ ...form, secretManagerSecretName: e.target.value })}
          className="px-3 py-2 border border-input rounded-md text-sm bg-background"
        />
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {mutation.isPending ? "Saving..." : editId ? "Update" : "Create"}
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2 border border-border rounded-md text-sm hover:bg-muted"
        >
          Cancel
        </button>
        {mutation.isError && (
          <span className="text-sm text-destructive self-center">{(mutation.error as Error).message}</span>
        )}
      </div>
    </div>
  );
}
