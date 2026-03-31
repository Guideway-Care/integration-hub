import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import { useLocation, Link } from "wouter";
import { ArrowLeft, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function RunNewPage() {
  const [, navigate] = useLocation();

  const { data: systemsData } = useQuery({
    queryKey: ["source-systems"],
    queryFn: () => api.get<{ data: { sourceSystemId: string; sourceSystemName: string }[] }>("/source-systems"),
  });

  const [sourceSystemId, setSourceSystemId] = useState("");

  const { data: endpointsData } = useQuery({
    queryKey: ["endpoints", sourceSystemId],
    queryFn: () => api.get<{ data: { endpointId: string; endpointName: string }[] }>(
      `/endpoints?source_system_id=${sourceSystemId}`
    ),
    enabled: !!sourceSystemId,
  });

  const [form, setForm] = useState({
    endpointId: "",
    requestedBy: "",
    windowStartTs: "",
    windowEndTs: "",
  });

  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () =>
      api.post("/runs", {
        sourceSystemId,
        endpointId: form.endpointId,
        runType: "MANUAL",
        requestedBy: form.requestedBy || null,
        windowStartTs: form.windowStartTs || null,
        windowEndTs: form.windowEndTs || null,
      }),
    onSuccess: (data: any) => {
      toast({ title: "Run triggered", description: "Extraction run has been created successfully." });
      navigate(`/runs/${data.data.runId}`);
    },
    onError: (err) => {
      toast({ title: "Failed to trigger run", description: (err as Error).message, variant: "destructive" });
    },
  });

  return (
    <div className="max-w-2xl">
      <Link href="/runs">
        <button className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Runs
        </button>
      </Link>

      <h1 className="text-2xl font-bold mb-6">Trigger New Run</h1>

      <div className="border border-border rounded-lg p-6 bg-card space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Source System</label>
          <select
            value={sourceSystemId}
            onChange={(e) => {
              setSourceSystemId(e.target.value);
              setForm({ ...form, endpointId: "" });
            }}
            className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background"
          >
            <option value="">Select source system...</option>
            {(systemsData?.data ?? []).map((s) => (
              <option key={s.sourceSystemId} value={s.sourceSystemId}>{s.sourceSystemName}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Endpoint</label>
          <select
            value={form.endpointId}
            onChange={(e) => setForm({ ...form, endpointId: e.target.value })}
            disabled={!sourceSystemId}
            className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background disabled:opacity-50"
          >
            <option value="">Select endpoint...</option>
            {(endpointsData?.data ?? []).map((ep) => (
              <option key={ep.endpointId} value={ep.endpointId}>{ep.endpointName}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Requested By (optional)</label>
          <input
            value={form.requestedBy}
            onChange={(e) => setForm({ ...form, requestedBy: e.target.value })}
            placeholder="Your name"
            className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Window Start (optional)</label>
            <input
              type="datetime-local"
              value={form.windowStartTs}
              onChange={(e) => setForm({ ...form, windowStartTs: e.target.value })}
              className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Window End (optional)</label>
            <input
              type="datetime-local"
              value={form.windowEndTs}
              onChange={(e) => setForm({ ...form, windowEndTs: e.target.value })}
              className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={() => mutation.mutate()}
            disabled={!form.endpointId || mutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            {mutation.isPending ? "Triggering..." : "Trigger Run"}
          </button>
          {mutation.isError && (
            <span className="text-sm text-destructive self-center">{(mutation.error as Error).message}</span>
          )}
        </div>
      </div>
    </div>
  );
}
