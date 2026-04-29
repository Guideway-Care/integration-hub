import { useState, useEffect, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Activity, Users, PhoneCall, Loader2, RefreshCw, Clock } from "lucide-react";

type Preset = {
  key: string;
  label: string;
  description: string;
  endpoint: string;
  icon: any;
};

const PRESETS: Preset[] = [
  {
    key: "agent-states",
    label: "Agent States",
    description: "All currently logged-in agents with state and active contact ID",
    endpoint: "/incontactapi/services/v30.0/agents/states",
    icon: Users,
  },
  {
    key: "skills-activity",
    label: "Skills Activity",
    description: "Calls in queue, agents available, longest queued by skill",
    endpoint: "/incontactapi/services/v30.0/skills/activity",
    icon: Activity,
  },
  {
    key: "team-summary",
    label: "Teams Summary",
    description: "Per-team rollup of agents logged in, on call, available",
    endpoint: "/incontactapi/services/v30.0/teams/performance-summary",
    icon: Users,
  },
  {
    key: "active-contacts",
    label: "Active Contacts",
    description: "All currently active contacts across all skills/agents",
    endpoint: "/incontactapi/services/v30.0/contacts/active",
    icon: PhoneCall,
  },
];

interface FetchResponse {
  statusCode: number;
  statusText: string;
  endpoint: string;
  timestamp: string;
  data: any;
}

function summarizeAgentStates(data: any) {
  const states: any[] =
    data?.agentStates ||
    data?.agentState ||
    (Array.isArray(data) ? data : []);
  if (!Array.isArray(states) || states.length === 0) return null;

  const onCall = states.filter((s) => s.contactId && s.contactId !== "0").length;
  const available = states.filter(
    (s) => s.outStateName?.toLowerCase() === "available" || s.agentStateName?.toLowerCase() === "available",
  ).length;
  const total = states.length;

  return { total, onCall, available };
}

function AgentStatesTable({ data }: { data: any }) {
  const states: any[] =
    data?.agentStates ||
    data?.agentState ||
    (Array.isArray(data) ? data : []);

  if (!Array.isArray(states) || states.length === 0) return null;

  return (
    <div className="overflow-x-auto border rounded-md">
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Agent</th>
            <th className="px-3 py-2 text-left font-medium">State</th>
            <th className="px-3 py-2 text-left font-medium">Contact ID</th>
            <th className="px-3 py-2 text-left font-medium">Skill</th>
            <th className="px-3 py-2 text-left font-medium">Team</th>
            <th className="px-3 py-2 text-left font-medium">Time in State</th>
          </tr>
        </thead>
        <tbody>
          {states.map((s, i) => {
            const onCall = s.contactId && s.contactId !== "0";
            return (
              <tr key={s.agentId || i} className="border-t">
                <td className="px-3 py-2">
                  {s.firstName || s.lastName
                    ? `${s.firstName ?? ""} ${s.lastName ?? ""}`.trim()
                    : s.agentName || s.userName || s.agentId}
                </td>
                <td className="px-3 py-2">
                  <Badge
                    variant="outline"
                    className={
                      onCall
                        ? "border-green-500 text-green-700"
                        : (s.outStateName || s.agentStateName)?.toLowerCase() === "available"
                        ? "border-blue-500 text-blue-700"
                        : ""
                    }
                  >
                    {s.outStateName || s.agentStateName || "—"}
                  </Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {onCall ? s.contactId : "—"}
                </td>
                <td className="px-3 py-2">{s.skillName || "—"}</td>
                <td className="px-3 py-2">{s.teamName || "—"}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {s.startDate
                    ? new Date(s.startDate).toLocaleTimeString()
                    : s.lastUpdateTime
                    ? new Date(s.lastUpdateTime).toLocaleTimeString()
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function RealtimePage() {
  const [activePreset, setActivePreset] = useState<Preset>(PRESETS[0]);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [response, setResponse] = useState<FetchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchMutation = useMutation({
    mutationFn: (preset: Preset) =>
      api.post<FetchResponse>("/incontact/fetch", {
        endpoint: preset.endpoint,
      }),
    onSuccess: (data) => {
      setResponse(data);
      setLastFetched(new Date());
      setError(null);
    },
    onError: (err: any) => {
      setError(err?.message || "Request failed");
      setResponse(null);
    },
  });

  function handleFetch(preset: Preset) {
    setActivePreset(preset);
    fetchMutation.mutate(preset);
  }

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      fetchMutation.mutate(activePreset);
    }, 10000);
    return () => clearInterval(id);
  }, [autoRefresh, activePreset]);

  const summary = useMemo(() => {
    if (activePreset.key !== "agent-states" || !response?.data) return null;
    return summarizeAgentStates(response.data);
  }, [activePreset.key, response]);

  return (
    <div className="space-y-6 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Activity className="w-6 h-6 text-green-600" />
              InContact Real-Time Explorer
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Hit NICE CXone Real-Time APIs to see what's happening right now.
              Pick a preset to fetch, or toggle auto-refresh for a live view.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="auto-refresh"
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
              />
              <Label htmlFor="auto-refresh" className="text-sm cursor-pointer">
                Auto-refresh (10s)
              </Label>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleFetch(activePreset)}
              disabled={fetchMutation.isPending}
            >
              {fetchMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {PRESETS.map((preset) => {
            const Icon = preset.icon;
            const isActive = activePreset.key === preset.key;
            return (
              <Card
                key={preset.key}
                className={`cursor-pointer transition hover:shadow-md ${
                  isActive ? "border-primary border-2" : ""
                }`}
                onClick={() => handleFetch(preset)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium text-sm">{preset.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {preset.description}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {summary && (
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Logged In</div>
                <div className="text-2xl font-semibold">{summary.total}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Available</div>
                <div className="text-2xl font-semibold text-blue-700">{summary.available}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">On Call</div>
                <div className="text-2xl font-semibold text-green-700">{summary.onCall}</div>
              </CardContent>
            </Card>
          </div>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">{activePreset.label}</CardTitle>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <code className="bg-muted px-2 py-1 rounded">{activePreset.endpoint}</code>
              {lastFetched && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {lastFetched.toLocaleTimeString()}
                </span>
              )}
              {response && (
                <Badge variant={response.statusCode === 200 ? "default" : "destructive"}>
                  {response.statusCode}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {fetchMutation.isPending && !response && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
                Fetching from NICE...
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded p-3">
                {error}
              </div>
            )}

            {response && (
              <div className="space-y-4">
                {activePreset.key === "agent-states" && (
                  <AgentStatesTable data={response.data} />
                )}

                <details className="group" open={activePreset.key !== "agent-states"}>
                  <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground select-none">
                    Raw JSON Response
                  </summary>
                  <pre className="mt-2 bg-muted p-3 rounded text-xs overflow-auto max-h-[500px]">
                    {JSON.stringify(response.data, null, 2)}
                  </pre>
                </details>
              </div>
            )}

            {!response && !fetchMutation.isPending && !error && (
              <div className="text-sm text-muted-foreground py-8 text-center">
                Click a preset above to fetch real-time data.
              </div>
            )}
          </CardContent>
        </Card>
    </div>
  );
}
