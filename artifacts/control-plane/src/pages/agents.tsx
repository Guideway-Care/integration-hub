import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import {
  Users,
  CheckCircle,
  XCircle,
  Loader2,
  Play,
  Clock,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  Copy,
  Check,
  Download,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface AgentPerformance {
  agentId: string;
  teamId: string;
  agentOffered: string;
  inboundHandled: string;
  inboundTime: string;
  inboundTalkTime: string;
  inboundAvgTalkTime: string;
  outboundHandled: string;
  outboundTime: string;
  outboundTalkTime: string;
  outboundAvgTalkTime: string;
  totalHandled: string;
  totalTalkTime: string;
  totalAvgTalkTime: string;
  totalAvgHandleTime: string;
  consultTime: string;
  availableTime: string;
  unavailableTime: string;
  acwTime: string;
  refused: string;
  percentRefused: string;
  loginTime: string;
  workingRate: string;
  occupancy: string;
}

function parseDuration(iso: string): number {
  if (!iso || iso === "PT0S") return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] || "0") * 3600) + (parseInt(match[2] || "0") * 60) + parseFloat(match[3] || "0");
}

function formatDurationHM(iso: string): string {
  const totalSec = parseDuration(iso);
  if (totalSec === 0) return "—";
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function CopyJsonButton({ json }: { json: any }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(JSON.stringify(json, null, 2)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="inline-flex items-center gap-1 px-2 py-1 border border-border rounded-md text-xs hover:bg-muted transition-colors"
      title="Copy JSON to clipboard"
    >
      {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function PipelineStep({
  number,
  title,
  description,
  status,
  onRun,
  isRunning,
  children,
}: {
  number: number;
  title: string;
  description: string;
  status: "idle" | "running" | "success" | "error";
  onRun: () => void;
  isRunning: boolean;
  children?: React.ReactNode;
}) {
  const statusIcon = {
    idle: <Clock className="w-5 h-5 text-muted-foreground" />,
    running: <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />,
    success: <CheckCircle className="w-5 h-5 text-green-500" />,
    error: <AlertTriangle className="w-5 h-5 text-red-500" />,
  };

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
        <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">
          {number}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {statusIcon[status]}
        <button
          onClick={onRun}
          disabled={isRunning}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:opacity-90 disabled:opacity-50 shrink-0"
        >
          {isRunning ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Play className="w-3 h-3" />
          )}
          Run Now
        </button>
      </div>
      {children && <div className="p-4">{children}</div>}
    </div>
  );
}

type Tab = "retrieve" | "results";

export default function AgentsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("retrieve");

  const [dateRange, setDateRange] = useState(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return {
      startDate: yesterday.toISOString().split("T")[0],
      endDate: yesterday.toISOString().split("T")[0],
    };
  });

  const [agentData, setAgentData] = useState<AgentPerformance[] | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<"totalHandled" | "occupancy" | "loginTime" | "totalTalkTime" | "agentId">("totalHandled");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [showInactive, setShowInactive] = useState(false);
  const pageSize = 50;

  const fetchMutation = useMutation({
    mutationFn: () => {
      const startDate = `${dateRange.startDate}T00:00:00Z`;
      const endD = new Date(dateRange.endDate + "T00:00:00Z");
      endD.setUTCDate(endD.getUTCDate() + 1);
      const endDate = endD.toISOString().replace(".000Z", "Z");

      return api.post<any>("/incontact/fetch", {
        endpoint: "/incontactapi/services/v27.0/agents/performance",
        params: { startDate, endDate },
      });
    },
    onSuccess: (data: any) => {
      const perf = data?.data?.agentPerformance ?? [];
      setAgentData(perf);
      setPage(0);
      const active = perf.filter((a: AgentPerformance) => a.totalHandled !== "0" || a.loginTime !== "PT0S");
      toast({
        title: "Agent data retrieved",
        description: `${perf.length} agents found, ${active.length} with activity`,
      });
      setTab("results");
    },
    onError: (err) => {
      toast({ title: "Failed to retrieve agent data", description: (err as Error).message, variant: "destructive" });
    },
  });

  const filtered = (agentData ?? [])
    .filter((a) => {
      if (!showInactive && a.totalHandled === "0" && a.loginTime === "PT0S") return false;
      if (searchTerm) {
        return a.agentId.includes(searchTerm) || a.teamId.includes(searchTerm);
      }
      return true;
    })
    .sort((a, b) => {
      let aVal: number, bVal: number;
      if (sortField === "agentId") {
        aVal = parseInt(a.agentId);
        bVal = parseInt(b.agentId);
      } else if (sortField === "totalHandled") {
        aVal = parseInt(a.totalHandled);
        bVal = parseInt(b.totalHandled);
      } else if (sortField === "occupancy") {
        aVal = parseFloat(a.occupancy);
        bVal = parseFloat(b.occupancy);
      } else if (sortField === "loginTime") {
        aVal = parseDuration(a.loginTime);
        bVal = parseDuration(b.loginTime);
      } else {
        aVal = parseDuration(a.totalTalkTime);
        bVal = parseDuration(b.totalTalkTime);
      }
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);

  const summaryStats = agentData ? {
    total: agentData.length,
    active: agentData.filter((a) => a.totalHandled !== "0" || a.loginTime !== "PT0S").length,
    totalCalls: agentData.reduce((s, a) => s + parseInt(a.totalHandled), 0),
    totalTalkSeconds: agentData.reduce((s, a) => s + parseDuration(a.totalTalkTime), 0),
    avgOccupancy: (() => {
      const active = agentData.filter((a) => parseFloat(a.occupancy) > 0);
      if (active.length === 0) return 0;
      return active.reduce((s, a) => s + parseFloat(a.occupancy), 0) / active.length;
    })(),
  } : null;

  function handleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
    setPage(0);
  }

  const sortArrow = (field: typeof sortField) =>
    sortField === field ? (sortDir === "desc" ? " ▼" : " ▲") : "";

  const tabs: { id: Tab; label: string }[] = [
    { id: "retrieve", label: "Retrieve" },
    { id: "results", label: "Results" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-6 h-6" />
            Agent Performance
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Retrieve and analyze agent performance metrics from NICE CXone
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              queryClient.invalidateQueries();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-md text-xs hover:bg-muted"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
      </div>

      <div className="border-b border-border mb-6">
        <div className="flex gap-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              {t.label}
              {t.id === "results" && agentData ? (
                <span className="ml-1.5 text-xs bg-muted rounded-full px-1.5 py-0.5">
                  {agentData.length}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {tab === "retrieve" && (
        <div className="space-y-4">
          <PipelineStep
            number={1}
            title="Select Date Range"
            description="Choose the reporting period for agent performance data"
            status="idle"
            onRun={() => {}}
            isRunning={false}
          >
            <div className="flex items-center gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Start Date</label>
                <input
                  type="date"
                  value={dateRange.startDate}
                  onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
                  className="px-3 py-1.5 border border-input rounded-md text-sm bg-background"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">End Date</label>
                <input
                  type="date"
                  value={dateRange.endDate}
                  onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
                  className="px-3 py-1.5 border border-input rounded-md text-sm bg-background"
                />
              </div>
            </div>
          </PipelineStep>

          <div className="flex justify-center">
            <ArrowRight className="w-5 h-5 text-muted-foreground rotate-90" />
          </div>

          <PipelineStep
            number={2}
            title="Retrieve Agent Performance"
            description="Fetch performance metrics for all agents from the NICE CXone Reporting API"
            status={fetchMutation.isPending ? "running" : fetchMutation.isSuccess ? "success" : fetchMutation.isError ? "error" : "idle"}
            onRun={() => fetchMutation.mutate()}
            isRunning={fetchMutation.isPending}
          >
            {fetchMutation.isSuccess && summaryStats && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-foreground">{summaryStats.total}</div>
                  <div className="text-xs text-muted-foreground">Total Agents</div>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{summaryStats.active}</div>
                  <div className="text-xs text-muted-foreground">Active Agents</div>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">{summaryStats.totalCalls.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">Total Calls</div>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">
                    {Math.floor(summaryStats.totalTalkSeconds / 3600)}h {Math.floor((summaryStats.totalTalkSeconds % 3600) / 60)}m
                  </div>
                  <div className="text-xs text-muted-foreground">Total Talk Time</div>
                </div>
                <div className="text-center p-3 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-orange-600">{summaryStats.avgOccupancy.toFixed(1)}%</div>
                  <div className="text-xs text-muted-foreground">Avg Occupancy</div>
                </div>
              </div>
            )}
            {fetchMutation.isError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
                {(fetchMutation.error as Error).message}
              </div>
            )}
          </PipelineStep>

          <div className="flex justify-center">
            <ArrowRight className="w-5 h-5 text-muted-foreground rotate-90" />
          </div>

          <PipelineStep
            number={3}
            title="Review Results"
            description="View the agent performance data table, filter, sort, and export"
            status={agentData ? "success" : "idle"}
            onRun={() => setTab("results")}
            isRunning={false}
          >
            {agentData && (
              <p className="text-sm text-muted-foreground">
                {agentData.length} agents loaded. Click "Run Now" or switch to the Results tab to view the data.
              </p>
            )}
          </PipelineStep>
        </div>
      )}

      {tab === "results" && (
        <div className="space-y-4">
          {!agentData ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No data loaded yet. Go to the Retrieve tab and fetch agent performance data first.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="text-center p-3 border border-border rounded-lg bg-card">
                  <div className="text-2xl font-bold text-foreground">{summaryStats?.total}</div>
                  <div className="text-xs text-muted-foreground">Total Agents</div>
                </div>
                <div className="text-center p-3 border border-border rounded-lg bg-card">
                  <div className="text-2xl font-bold text-green-600">{summaryStats?.active}</div>
                  <div className="text-xs text-muted-foreground">Active Agents</div>
                </div>
                <div className="text-center p-3 border border-border rounded-lg bg-card">
                  <div className="text-2xl font-bold text-blue-600">{summaryStats?.totalCalls.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">Total Calls</div>
                </div>
                <div className="text-center p-3 border border-border rounded-lg bg-card">
                  <div className="text-2xl font-bold text-purple-600">
                    {summaryStats ? `${Math.floor(summaryStats.totalTalkSeconds / 3600)}h ${Math.floor((summaryStats.totalTalkSeconds % 3600) / 60)}m` : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">Total Talk Time</div>
                </div>
                <div className="text-center p-3 border border-border rounded-lg bg-card">
                  <div className="text-2xl font-bold text-orange-600">{summaryStats?.avgOccupancy.toFixed(1)}%</div>
                  <div className="text-xs text-muted-foreground">Avg Occupancy</div>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    value={searchTerm}
                    onChange={(e) => { setSearchTerm(e.target.value); setPage(0); }}
                    placeholder="Search by Agent ID or Team ID..."
                    className="pl-9 pr-3 py-1.5 w-full border border-input rounded-md text-sm bg-background"
                  />
                </div>
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showInactive}
                    onChange={(e) => { setShowInactive(e.target.checked); setPage(0); }}
                    className="rounded border-input"
                  />
                  Show inactive agents
                </label>
                <div className="text-xs text-muted-foreground">
                  Showing {filtered.length} of {agentData.length} agents
                </div>
                <div className="flex-1" />
                <CopyJsonButton json={agentData} />
              </div>

              <div className="border border-border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="px-3 py-2 text-left font-medium text-xs cursor-pointer hover:bg-muted" onClick={() => handleSort("agentId")}>
                          Agent ID{sortArrow("agentId")}
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-xs">Team ID</th>
                        <th className="px-3 py-2 text-right font-medium text-xs">Offered</th>
                        <th className="px-3 py-2 text-right font-medium text-xs">Inbound</th>
                        <th className="px-3 py-2 text-right font-medium text-xs">Outbound</th>
                        <th className="px-3 py-2 text-right font-medium text-xs cursor-pointer hover:bg-muted" onClick={() => handleSort("totalHandled")}>
                          Total Handled{sortArrow("totalHandled")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-xs cursor-pointer hover:bg-muted" onClick={() => handleSort("totalTalkTime")}>
                          Talk Time{sortArrow("totalTalkTime")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-xs">Avg Handle</th>
                        <th className="px-3 py-2 text-right font-medium text-xs cursor-pointer hover:bg-muted" onClick={() => handleSort("loginTime")}>
                          Login Time{sortArrow("loginTime")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-xs">Available</th>
                        <th className="px-3 py-2 text-right font-medium text-xs">ACW</th>
                        <th className="px-3 py-2 text-right font-medium text-xs cursor-pointer hover:bg-muted" onClick={() => handleSort("occupancy")}>
                          Occupancy{sortArrow("occupancy")}
                        </th>
                        <th className="px-3 py-2 text-right font-medium text-xs">Working Rate</th>
                        <th className="px-3 py-2 text-right font-medium text-xs">Refused</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paged.map((a) => (
                        <tr key={a.agentId} className="border-b border-border hover:bg-muted/30 transition-colors">
                          <td className="px-3 py-2 font-mono text-xs">{a.agentId}</td>
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{a.teamId}</td>
                          <td className="px-3 py-2 text-right">{a.agentOffered}</td>
                          <td className="px-3 py-2 text-right">{a.inboundHandled}</td>
                          <td className="px-3 py-2 text-right">{a.outboundHandled}</td>
                          <td className="px-3 py-2 text-right font-semibold">{a.totalHandled}</td>
                          <td className="px-3 py-2 text-right">{formatDurationHM(a.totalTalkTime)}</td>
                          <td className="px-3 py-2 text-right">{formatDurationHM(a.totalAvgHandleTime)}</td>
                          <td className="px-3 py-2 text-right">{formatDurationHM(a.loginTime)}</td>
                          <td className="px-3 py-2 text-right">{formatDurationHM(a.availableTime)}</td>
                          <td className="px-3 py-2 text-right">{formatDurationHM(a.acwTime)}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={`inline-block min-w-[3rem] text-right ${
                              parseFloat(a.occupancy) >= 80 ? "text-green-600 font-semibold" :
                              parseFloat(a.occupancy) >= 50 ? "text-yellow-600" :
                              parseFloat(a.occupancy) > 0 ? "text-red-600" :
                              "text-muted-foreground"
                            }`}>
                              {parseFloat(a.occupancy) > 0 ? `${a.occupancy}%` : "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {parseFloat(a.workingRate) > 0 ? `${a.workingRate}%` : "—"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {parseInt(a.refused) > 0 ? (
                              <span className="text-red-600 font-medium">{a.refused}</span>
                            ) : "0"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Page {page + 1} of {totalPages} ({filtered.length} agents)
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(Math.max(0, page - 1))}
                      disabled={page === 0}
                      className="p-1.5 border border-border rounded hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                      disabled={page >= totalPages - 1}
                      className="p-1.5 border border-border rounded hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
