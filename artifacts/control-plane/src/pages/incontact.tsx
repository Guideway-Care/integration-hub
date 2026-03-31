import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import { Phone, CheckCircle, XCircle, Send, Loader2 } from "lucide-react";

export default function InContactPage() {
  const [endpoint, setEndpoint] = useState("/media-playback/v1/contacts");
  const [params, setParams] = useState("");
  const [fetchResult, setFetchResult] = useState<any>(null);

  const { data: endpointsData } = useQuery({
    queryKey: ["incontact-endpoints"],
    queryFn: () => api.get<string[]>("/incontact/endpoints"),
  });

  const testQuery = useQuery({
    queryKey: ["incontact-test"],
    queryFn: () => api.get<any>("/incontact/test"),
    retry: false,
  });

  const authTestMutation = useMutation({
    mutationFn: () => api.post<any>("/incontact/auth-test"),
  });

  const fetchMutation = useMutation({
    mutationFn: () => {
      let parsedParams: Record<string, string> = {};
      if (params.trim()) {
        try {
          parsedParams = JSON.parse(params);
        } catch {
          const entries = params.split("&").map((p) => p.split("="));
          parsedParams = Object.fromEntries(entries);
        }
      }
      return api.post<any>("/incontact/fetch", { endpoint, params: parsedParams });
    },
    onSuccess: (data) => setFetchResult(data),
  });

  const allowedEndpoints = endpointsData ?? [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">InContact API</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Test and interact with the NICE InContact API
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 mb-6">
        <div className="border border-border rounded-lg p-4 bg-card">
          <h3 className="text-sm font-semibold mb-3">Secret Manager</h3>
          {testQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking...
            </div>
          ) : testQuery.data?.status === "connected" ? (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle className="w-4 h-4" /> Connected to Secret Manager
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <XCircle className="w-4 h-4" /> Not connected
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Project: {testQuery.data?.project || "guidewaycare-476802"}
          </p>
        </div>

        <div className="border border-border rounded-lg p-4 bg-card">
          <h3 className="text-sm font-semibold mb-3">OAuth Token</h3>
          <button
            onClick={() => authTestMutation.mutate()}
            disabled={authTestMutation.isPending}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:opacity-90 disabled:opacity-50"
          >
            {authTestMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Phone className="w-3 h-3" />
            )}
            Test Authentication
          </button>
          {authTestMutation.data && (
            <div className="mt-2 text-xs text-green-600">
              Authenticated. Token length: {authTestMutation.data.tokenLength}
            </div>
          )}
          {authTestMutation.error && (
            <div className="mt-2 text-xs text-destructive">
              {(authTestMutation.error as Error).message}
            </div>
          )}
        </div>
      </div>

      <div className="border border-border rounded-lg p-6 bg-card mb-6">
        <h3 className="text-sm font-semibold mb-4">API Explorer</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Endpoint</label>
            <select
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background"
            >
              {allowedEndpoints.map((ep) => (
                <option key={ep} value={ep}>{ep}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              Parameters (JSON or key=value&key=value)
            </label>
            <input
              value={params}
              onChange={(e) => setParams(e.target.value)}
              placeholder='e.g. {"acd-call-id": "12345"}'
              className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background"
            />
          </div>
          <button
            onClick={() => fetchMutation.mutate()}
            disabled={fetchMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {fetchMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Send Request
          </button>
        </div>
      </div>

      {fetchResult && (
        <div className="border border-border rounded-lg p-4 bg-card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Response</h3>
            <span className={`text-xs font-medium ${fetchResult.statusCode < 400 ? "text-green-600" : "text-destructive"}`}>
              {fetchResult.statusCode} {fetchResult.statusText}
            </span>
          </div>
          <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-96 whitespace-pre-wrap">
            {JSON.stringify(fetchResult.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
