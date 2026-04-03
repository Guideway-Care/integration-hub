import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState, useEffect } from "react";
import {
  Phone,
  CheckCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Play,
  RotateCcw,
  Database,
  FileAudio,
  ChevronLeft,
  ChevronRight,
  Search,
  Download,
  ArrowRight,
  Clock,
  AlertTriangle,
  RefreshCw,
  Plus,
  Send,
  ChevronDown,
  ChevronUp,
  Filter,
  Calendar,
  X,
  BookOpen,
  Copy,
  Check,
  Users,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MetricsSkeleton, TableSkeleton } from "@/components/table-skeleton";

type Tab = "pipeline" | "agents" | "monitor" | "staging" | "recordings" | "api-explorer" | "docs";

interface StagingSummary {
  pending: number;
  processing: number;
  downloaded: number;
  failed: number;
  total: number;
}

interface QueueItem {
  id: string;
  call_id: string;
  status: string;
  error_message: string | null;
  batch_id: string | null;
  created_at: string;
  processed_at: string | null;
}

interface Recording {
  id: string;
  contact_id: string;
  acd_contact_id: string;
  agent_id: string | null;
  agent_name: string | null;
  start_date: string;
  end_date: string | null;
  duration_seconds: number | null;
  media_type: string | null;
  direction: string | null;
  file_name: string | null;
  gcs_uri: string | null;
  file_size_bytes: number | null;
  call_tags: string | null;
  ingestion_timestamp: string;
}

interface DailyCount {
  contact_date: { value: string } | string;
  dow: number;
  contact_count: number;
}

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

interface LastAgentsRun {
  runId: string;
  status: string;
  runType: string;
  windowStartTs: string | null;
  windowEndTs: string | null;
  pageCount: number;
  apiCallCount: number;
  errorCount: number;
  startedTs: string | null;
  endedTs: string | null;
  cloudRunExecutionId: string | null;
  errorSummary: string | null;
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

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  processing: "bg-blue-100 text-blue-700",
  downloaded: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

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

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ContactCalendar({ rows }: { rows: DailyCount[] }) {
  const dataByDate = new Map<string, number>();
  for (const row of rows) {
    const date = typeof row.contact_date === "string" ? row.contact_date : row.contact_date?.value ?? "";
    dataByDate.set(date, row.contact_count);
  }

  const dowTotals = [0, 0, 0, 0, 0, 0, 0];
  const dowCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const row of rows) {
    const bqDow = row.dow ?? new Date(typeof row.contact_date === "string" ? row.contact_date : row.contact_date?.value ?? "").getDay() + 1;
    const jsDay = bqDow === 1 ? 0 : bqDow - 1;
    dowTotals[jsDay] += row.contact_count;
    dowCounts[jsDay] += 1;
  }
  const dowAvg = dowTotals.map((t, i) => (dowCounts[i] > 0 ? Math.round(t / dowCounts[i]) : 0));

  const months = new Map<string, { year: number; month: number }>();
  for (const row of rows) {
    const date = typeof row.contact_date === "string" ? row.contact_date : row.contact_date?.value ?? "";
    const key = date.slice(0, 7);
    if (!months.has(key)) {
      const [y, m] = key.split("-").map(Number);
      months.set(key, { year: y, month: m });
    }
  }
  const sortedMonths = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  function getCellColor(count: number, dow: number): string {
    const avg = dowAvg[dow];
    if (avg === 0) return "bg-gray-100";
    const pctOff = Math.abs(count - avg) / avg;
    if (pctOff <= 0.1) return "bg-green-100";
    if (pctOff <= 0.2) return "bg-yellow-100";
    return "bg-red-100";
  }

  function getVariance(count: number, dow: number): { text: string; color: string } {
    const avg = dowAvg[dow];
    if (avg === 0) return { text: "", color: "" };
    const pct = ((count - avg) / avg) * 100;
    const arrow = pct >= 0 ? "▲" : "▼";
    const color = Math.abs(pct) <= 10 ? "text-green-600" : Math.abs(pct) <= 20 ? "text-yellow-600" : "text-red-600";
    return { text: `${arrow} ${Math.abs(pct).toFixed(1)}%`, color };
  }

  function buildMonthGrid(year: number, month: number) {
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const weeks: (number | null)[][] = [];
    let week: (number | null)[] = Array(firstDay).fill(null);

    for (let day = 1; day <= daysInMonth; day++) {
      week.push(day);
      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
    }
    if (week.length > 0) {
      while (week.length < 7) week.push(null);
      weeks.push(week);
    }
    return weeks;
  }

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-lg p-4 bg-card">
        <h3 className="text-sm font-semibold mb-3">Day of Week Averages</h3>
        <div className="grid grid-cols-7 gap-2">
          {DOW_LABELS.map((label, i) => (
            <div key={label} className="text-center">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-lg font-bold">{dowAvg[i].toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="text-muted-foreground">Legend:</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-100 border border-green-200" /> Within 10% of avg</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-yellow-100 border border-yellow-200" /> 10%–20% off avg</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-100 border border-red-200" /> Over 20% off avg</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gray-100 border border-gray-200" /> No data</span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {sortedMonths.map(([key, { year, month }]) => {
          const weeks = buildMonthGrid(year, month);
          return (
            <div key={key} className="border border-border rounded-lg p-3 bg-card">
              <h4 className="text-sm font-semibold mb-2">{MONTH_NAMES[month - 1]} {year}</h4>
              <div className="grid grid-cols-7 gap-px text-center">
                {DOW_LABELS.map((d) => (
                  <div key={d} className="text-[10px] text-muted-foreground font-medium py-1">{d}</div>
                ))}
                {weeks.flat().map((day, idx) => {
                  if (day === null) return <div key={`e-${idx}`} className="p-1" />;
                  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const count = dataByDate.get(dateStr);
                  const dow = idx % 7;
                  if (count === undefined) {
                    return (
                      <div key={dateStr} className="bg-gray-50 rounded-sm p-0.5 min-h-[40px]">
                        <div className="text-[10px] text-muted-foreground">{day}</div>
                        <div className="text-[9px] text-muted-foreground">—</div>
                      </div>
                    );
                  }
                  const variance = getVariance(count, dow);
                  return (
                    <div
                      key={dateStr}
                      className={`${getCellColor(count, dow)} rounded-sm p-0.5 min-h-[40px] border border-transparent hover:border-primary/30 transition-colors`}
                      title={`${dateStr}: ${count.toLocaleString()} contacts`}
                    >
                      <div className="text-[10px] font-medium text-foreground/70">{day}</div>
                      <div className="text-[10px] font-bold leading-tight">{count.toLocaleString()}</div>
                      {variance.text && (
                        <div className={`text-[8px] leading-tight ${variance.color}`}>{variance.text}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function InContactPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("pipeline");
  const [callIds, setCallIds] = useState("");
  const [batchId, setBatchId] = useState("");
  const [stagingPage, setStagingPage] = useState(0);
  const [recPage, setRecPage] = useState(0);
  const [recSearch, setRecSearch] = useState("");
  const [recSearchDebounced, setRecSearchDebounced] = useState("");
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [playbackLoading, setPlaybackLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [apiEndpoint, setApiEndpoint] = useState("");
  const [apiParamValues, setApiParamValues] = useState<Record<string, string>>({});
  const [fetchResult, setFetchResult] = useState<any>(null);
  const [contactDateRange, setContactDateRange] = useState(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return {
      startDate: yesterday.toISOString().split("T")[0],
      endDate: yesterday.toISOString().split("T")[0],
    };
  });

  type FilterPreset = "all" | "today" | "yesterday" | "7d" | "30d" | "custom";
  const [filterPreset, setFilterPreset] = useState<FilterPreset>("all");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  const [agentsSeeded, setAgentsSeeded] = useState(false);
  const [agentDateRange, setAgentDateRange] = useState(() => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return {
      startDate: yesterday.toISOString().split("T")[0],
      endDate: yesterday.toISOString().split("T")[0],
    };
  });
  const [agentData, setAgentData] = useState<AgentPerformance[] | null>(null);
  const [agentSearchTerm, setAgentSearchTerm] = useState("");
  const [agentSortField, setAgentSortField] = useState<"totalHandled" | "occupancy" | "loginTime" | "totalTalkTime" | "agentId">("totalHandled");
  const [agentSortDir, setAgentSortDir] = useState<"asc" | "desc">("desc");
  const [agentPage, setAgentPage] = useState(0);
  const [showInactiveAgents, setShowInactiveAgents] = useState(false);
  const [agentSubTab, setAgentSubTab] = useState<"extract" | "results">("extract");
  const agentPageSize = 50;

  function getFilterDates(): { startDate?: string; endDate?: string } {
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().split("T")[0];
    switch (filterPreset) {
      case "today":
        return { startDate: fmt(today), endDate: fmt(today) };
      case "yesterday": {
        const y = new Date(today);
        y.setDate(y.getDate() - 1);
        return { startDate: fmt(y), endDate: fmt(y) };
      }
      case "7d": {
        const d = new Date(today);
        d.setDate(d.getDate() - 6);
        return { startDate: fmt(d), endDate: fmt(today) };
      }
      case "30d": {
        const d = new Date(today);
        d.setDate(d.getDate() - 29);
        return { startDate: fmt(d), endDate: fmt(today) };
      }
      case "custom":
        return {
          startDate: filterStartDate || undefined,
          endDate: filterEndDate || undefined,
        };
      default:
        return {};
    }
  }

  const filterDates = getFilterDates();
  const filterQs = new URLSearchParams();
  if (filterDates.startDate) filterQs.set("startDate", filterDates.startDate);
  if (filterDates.endDate) filterQs.set("endDate", filterDates.endDate);
  const filterSuffix = filterQs.toString() ? `?${filterQs.toString()}` : "";

  const pageSize = 50;

  const testQuery = useQuery({
    queryKey: ["incontact-test"],
    queryFn: () => api.get<any>("/incontact/test"),
    retry: false,
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["staging-summary", filterDates.startDate, filterDates.endDate],
    queryFn: () => api.get<StagingSummary>(`/bq/staging-summary${filterSuffix}`),
    retry: false,
    refetchInterval: (query) => {
      const d = query.state.data;
      const hasActive = (d?.pending ?? 0) > 0 || (d?.processing ?? 0) > 0;
      return hasActive ? 10000 : false;
    },
  });

  const { data: queue, isLoading: queueLoading } = useQuery({
    queryKey: ["staging-queue"],
    queryFn: () => api.get<QueueItem[]>("/bq/staging-queue"),
    retry: false,
    enabled: tab === "staging",
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setRecSearchDebounced(recSearch);
      setRecPage(0);
    }, 400);
    return () => clearTimeout(timer);
  }, [recSearch]);

  const recPageSize = 50;
  const recQueryParams = new URLSearchParams();
  if (recSearchDebounced) recQueryParams.set("search", recSearchDebounced);
  recQueryParams.set("limit", String(recPageSize));
  recQueryParams.set("offset", String(recPage * recPageSize));

  const { data: recData, isLoading: recLoading } = useQuery({
    queryKey: ["recordings", recSearchDebounced, recPage],
    queryFn: () => api.get<{ rows: Recording[]; total: number }>(`/bq/recordings?${recQueryParams.toString()}`),
    retry: false,
    enabled: tab === "recordings",
  });

  const recRows = recData?.rows ?? [];
  const recTotal = recData?.total ?? 0;
  const recTotalPages = Math.max(1, Math.ceil(recTotal / recPageSize));

  function handlePlayRecording(rec: Recording) {
    const contactId = rec.acd_contact_id || rec.contact_id;
    setSelectedRecording(rec);
    setPlaybackUrl(`/api/bq/recording-stream/${contactId}`);
    setPlaybackError(null);
    setPlaybackLoading(false);
  }

  const { data: callListStatus } = useQuery({
    queryKey: ["call-list-status"],
    queryFn: () => api.get<{ exists: boolean; lineCount: number }>("/bq/call-list-status"),
    retry: false,
  });

  const monitorQs = new URLSearchParams();
  if (filterDates.startDate) monitorQs.set("startDate", filterDates.startDate);
  if (filterDates.endDate) monitorQs.set("endDate", filterDates.endDate);
  const monitorSuffix = monitorQs.toString() ? `?${monitorQs.toString()}` : "?startDate=2026-01-01";

  const { data: monitorData, isLoading: monitorLoading } = useQuery({
    queryKey: ["monitor-daily", filterDates.startDate, filterDates.endDate],
    queryFn: () => api.get<{ data: DailyCount[] }>(`/monitor/contact-daily-counts${monitorSuffix}`),
    retry: false,
  });

  interface EndpointParam {
    name: string;
    label: string;
    type: "string" | "date" | "number" | "boolean";
    required?: boolean;
    placeholder?: string;
    defaultValue?: string;
    description?: string;
  }
  interface EndpointDef {
    path: string;
    name: string;
    description: string;
    method: "GET" | "POST";
    category: string;
    params: EndpointParam[];
  }

  const { data: endpointDefs } = useQuery({
    queryKey: ["incontact-endpoints"],
    queryFn: () => api.get<EndpointDef[]>("/incontact/endpoints"),
    enabled: tab === "api-explorer",
  });

  const selectedEndpointDef = (endpointDefs ?? []).find((e) => e.path === apiEndpoint) ?? null;

  interface LastExtraction {
    runId: string;
    status: string;
    runType: string;
    windowStartTs: string | null;
    windowEndTs: string | null;
    pageCount: number;
    apiCallCount: number;
    errorCount: number;
    startedTs: string | null;
    endedTs: string | null;
    cloudRunExecutionId: string | null;
    errorSummary: string | null;
    executionStatus: string | null;
    executionDuration: string | null;
  }

  const { data: lastExtractionData } = useQuery({
    queryKey: ["last-extraction"],
    queryFn: () => api.get<{ data: LastExtraction | null }>("/runs/last-extraction"),
  });
  const lastExtraction = lastExtractionData?.data ?? null;

  const authTestMutation = useMutation({
    mutationFn: () => api.post<any>("/incontact/auth-test"),
    onSuccess: (data: any) => {
      toast({ title: "Authentication successful", description: `Token length: ${data.tokenLength}` });
    },
    onError: (err) => {
      toast({ title: "Authentication failed", description: (err as Error).message, variant: "destructive" });
    },
  });

  const fetchContactsMutation = useMutation({
    mutationFn: () => {
      return api.post<any>("/runs", {
        sourceSystemId: "nice-cxone",
        endpointId: "nice-cxone-contacts",
        runType: "MANUAL",
        requestedBy: "control-plane",
        windowStartTs: new Date(contactDateRange.startDate + "T00:00:00Z").toISOString(),
        windowEndTs: new Date(contactDateRange.endDate + "T23:59:59Z").toISOString(),
      });
    },
    onSuccess: (data: any) => {
      const runId = data?.data?.runId ?? "unknown";
      const execId = data?.data?.cloudRunExecutionId;
      toast({
        title: "Extraction run created",
        description: `Run ${runId.slice(0, 8)}... ${execId ? "triggered successfully" : "created (job trigger pending)"}`,
      });
      queryClient.invalidateQueries({ queryKey: ["runs"] });
    },
    onError: (err) => {
      toast({ title: "Failed to create extraction run", description: (err as Error).message, variant: "destructive" });
    },
  });

  const { data: transformStatus } = useQuery({
    queryKey: ["transform-status"],
    queryFn: () => api.get<{ callsTableCount: number; rawPagesCount: number; lastIngested: string | null; latestContact: string | null }>("/bq/transform-status"),
  });

  type TransformJobStatus = {
    status: "idle" | "running" | "completed" | "failed";
    step: string;
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
    durationFormatted?: string;
    rowsProcessed?: string | null;
    error?: string;
  };

  const { data: transformJobStatus } = useQuery<TransformJobStatus>({
    queryKey: ["transform-job-status"],
    queryFn: () => api.get<TransformJobStatus>("/bq/transform-job-status"),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === "running" ? 3000 : false;
    },
  });

  const transformMutation = useMutation({
    mutationFn: () => api.post<{ message: string }>("/bq/transform-contacts"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transform-job-status"] });
      toast({ title: "Transform started", description: "Processing contacts in the background. This may take several minutes." });
    },
    onError: (err) => {
      toast({ title: "Transform failed to start", description: (err as Error).message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (transformJobStatus?.status === "completed") {
      queryClient.invalidateQueries({ queryKey: ["transform-status"] });
      queryClient.invalidateQueries({ queryKey: ["contact-daily-counts"] });
    }
  }, [transformJobStatus?.status, queryClient]);

  const runLoaderMutation = useMutation({
    mutationFn: () => api.post<{ queued: number; message?: string }>("/bq/queue-recordings"),
    onSuccess: (data) => {
      toast({ title: "Queue recordings complete", description: data.message || `${data.queued} contact IDs written to call list` });
      queryClient.invalidateQueries({ queryKey: ["call-list-status"] });
    },
    onError: (err) => {
      toast({ title: "Queue recordings failed", description: (err as Error).message, variant: "destructive" });
    },
  });

  const { data: downloadJobStatus } = useQuery({
    queryKey: ["download-job-status"],
    queryFn: () => api.get<{ status: string; step: string; error?: string; loaderExecution?: string; processorExecution?: string }>("/bq/download-job-status"),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" ? 3000 : false;
    },
  });

  const runProcessorMutation = useMutation({
    mutationFn: () => api.post("/bq/run-job"),
    onSuccess: () => {
      toast({ title: "Download pipeline started", description: "Loader will run first, then processor starts automatically." });
      queryClient.invalidateQueries({ queryKey: ["download-job-status"] });
    },
    onError: (err) => {
      const msg = (err as Error).message;
      if (msg.includes("already running")) {
        toast({ title: "Pipeline already running", description: "Wait for the current run to complete.", variant: "destructive" });
      } else {
        toast({ title: "Download pipeline failed", description: msg, variant: "destructive" });
      }
    },
  });

  const addCallIdsMutation = useMutation({
    mutationFn: () => {
      const ids = callIds.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean);
      return api.post<{ added: number; batchId: string }>("/bq/staging-add", {
        callIds: ids,
        batchId: batchId || undefined,
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["staging-summary"] });
      queryClient.invalidateQueries({ queryKey: ["staging-queue"] });
      setCallIds("");
      setBatchId("");
      toast({ title: "Call IDs added", description: `${data.added} call ID(s) added.` });
    },
    onError: (err) => {
      toast({ title: "Failed to add call IDs", description: (err as Error).message, variant: "destructive" });
    },
  });

  const resetFailedMutation = useMutation({
    mutationFn: () => api.post("/bq/staging-reset-failed"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staging-summary"] });
      queryClient.invalidateQueries({ queryKey: ["staging-queue"] });
      toast({ title: "Reset complete", description: "Failed rows reset to pending." });
    },
    onError: (err) => {
      toast({ title: "Reset failed", description: (err as Error).message, variant: "destructive" });
    },
  });

  const fetchApiMutation = useMutation({
    mutationFn: () => {
      const params: Record<string, string> = {};
      const paramDefs = selectedEndpointDef?.params || [];
      Object.entries(apiParamValues).forEach(([k, v]) => {
        if (!v.trim()) return;
        const def = paramDefs.find((p) => p.name === k);
        if (def?.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) {
          if (k.toLowerCase().includes("end")) {
            const d = new Date(v.trim() + "T00:00:00Z");
            d.setUTCDate(d.getUTCDate() + 1);
            params[k] = d.toISOString().replace(".000Z", "Z");
          } else {
            params[k] = `${v.trim()}T00:00:00Z`;
          }
        } else {
          params[k] = v.trim();
        }
      });
      return api.post<any>("/incontact/fetch", { endpoint: apiEndpoint, params });
    },
    onSuccess: (data) => {
      setFetchResult(data);
      toast({ title: "Request completed", description: `Status: ${(data as any).statusCode} ${(data as any).statusText}` });
    },
    onError: (err) => {
      toast({ title: "Request failed", description: (err as Error).message, variant: "destructive" });
    },
  });

  const syncDispositionsMutation = useMutation({
    mutationFn: () => api.post<any>("/incontact/sync-dispositions", {}),
    onSuccess: (data) => {
      toast({ title: "Dispositions synced", description: `${(data as any).synced} dispositions written to BigQuery` });
    },
    onError: (err) => {
      toast({ title: "Sync failed", description: (err as Error).message, variant: "destructive" });
    },
  });

  const monitorRows = monitorData?.data ?? [];
  const totalContacts = monitorRows.reduce((a, b) => a + b.contact_count, 0);

  const allQueueItems = queue ?? [];
  const stagingTotalPages = Math.max(1, Math.ceil(allQueueItems.length / pageSize));
  const stagingItems = allQueueItems.slice(stagingPage * pageSize, (stagingPage + 1) * pageSize);

  const seedAgentsMutation = useMutation({
    mutationFn: () => api.post<any>("/incontact/seed-agents-endpoint"),
    onSuccess: () => {
      setAgentsSeeded(true);
      queryClient.invalidateQueries({ queryKey: ["agents-last-run"] });
    },
    onError: () => {},
  });

  useEffect(() => {
    if (!agentsSeeded) seedAgentsMutation.mutate();
  }, []);

  const { data: agentsLastRunData } = useQuery({
    queryKey: ["agents-last-run"],
    queryFn: () => api.get<{ data: LastAgentsRun | null }>("/incontact/agents-last-run"),
    refetchInterval: (query) => {
      const run = query.state.data?.data;
      if (run && (run.status === "PENDING" || run.status === "RUNNING")) return 5000;
      return false;
    },
  });
  const agentsLastRun = agentsLastRunData?.data ?? null;
  const isAgentsRunActive = agentsLastRun?.status === "PENDING" || agentsLastRun?.status === "RUNNING";

  const fetchAgentsRunMutation = useMutation({
    mutationFn: () => {
      const startDate = `${agentDateRange.startDate}T00:00:00Z`;
      const endD = new Date(agentDateRange.endDate + "T00:00:00Z");
      endD.setUTCDate(endD.getUTCDate() + 1);
      const endDate = endD.toISOString().replace(".000Z", "Z");
      return api.post<any>("/runs", {
        sourceSystemId: "nice-cxone",
        endpointId: "nice-cxone-agents-performance",
        runType: "MANUAL",
        requestedBy: "control-plane",
        windowStartTs: startDate,
        windowEndTs: endDate,
      });
    },
    onSuccess: (data: any) => {
      const runId = data?.data?.runId ?? "unknown";
      const execId = data?.data?.cloudRunExecutionId;
      toast({
        title: "Extraction run created",
        description: `Run ${runId.slice(0, 8)}... ${execId ? "triggered successfully" : "created (job trigger pending)"}`,
      });
      queryClient.invalidateQueries({ queryKey: ["agents-last-run"] });
      queryClient.invalidateQueries({ queryKey: ["runs"] });
    },
    onError: (err) => {
      toast({ title: "Failed to create extraction run", description: (err as Error).message, variant: "destructive" });
    },
  });

  const agentsTransformMutation = useMutation({
    mutationFn: () => api.post<any>("/bq/transform-agents"),
    onSuccess: () => {
      toast({ title: "Agents transform started", description: "Extracting agent performance from raw data into agent_activity table" });
      queryClient.invalidateQueries({ queryKey: ["agents-transform-job-status"] });
      queryClient.invalidateQueries({ queryKey: ["agents-transform-status"] });
    },
    onError: (err) => {
      toast({ title: "Transform failed to start", description: (err as Error).message, variant: "destructive" });
    },
  });

  const { data: agentsTransformJobStatus } = useQuery({
    queryKey: ["agents-transform-job-status"],
    queryFn: () => api.get<any>("/bq/transform-agents-job-status"),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" ? 2000 : false;
    },
  });

  const { data: agentsTransformStatus } = useQuery({
    queryKey: ["agents-transform-status"],
    queryFn: () => api.get<any>("/bq/transform-agents-status"),
  });

  const isAgentsTransformRunning = agentsTransformJobStatus?.status === "running";

  const previewAgentsMutation = useMutation({
    mutationFn: () => {
      const startDate = `${agentDateRange.startDate}T00:00:00Z`;
      const endD = new Date(agentDateRange.endDate + "T00:00:00Z");
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
      setAgentPage(0);
      const active = perf.filter((a: AgentPerformance) => a.totalHandled !== "0" || a.loginTime !== "PT0S");
      toast({ title: "Preview loaded", description: `${perf.length} agents found, ${active.length} with activity` });
      setAgentSubTab("results");
    },
    onError: (err) => {
      toast({ title: "Preview failed", description: (err as Error).message, variant: "destructive" });
    },
  });

  const filteredAgents = (agentData ?? [])
    .filter((a) => {
      if (!showInactiveAgents && a.totalHandled === "0" && a.loginTime === "PT0S") return false;
      if (agentSearchTerm) return a.agentId.includes(agentSearchTerm) || a.teamId.includes(agentSearchTerm);
      return true;
    })
    .sort((a, b) => {
      let aVal: number, bVal: number;
      if (agentSortField === "agentId") { aVal = parseInt(a.agentId); bVal = parseInt(b.agentId); }
      else if (agentSortField === "totalHandled") { aVal = parseInt(a.totalHandled); bVal = parseInt(b.totalHandled); }
      else if (agentSortField === "occupancy") { aVal = parseFloat(a.occupancy); bVal = parseFloat(b.occupancy); }
      else if (agentSortField === "loginTime") { aVal = parseDuration(a.loginTime); bVal = parseDuration(b.loginTime); }
      else { aVal = parseDuration(a.totalTalkTime); bVal = parseDuration(b.totalTalkTime); }
      return agentSortDir === "desc" ? bVal - aVal : aVal - bVal;
    });

  const agentTotalPages = Math.max(1, Math.ceil(filteredAgents.length / agentPageSize));
  const pagedAgents = filteredAgents.slice(agentPage * agentPageSize, (agentPage + 1) * agentPageSize);

  const agentSummary = agentData ? {
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

  function handleAgentSort(field: typeof agentSortField) {
    if (agentSortField === field) setAgentSortDir(agentSortDir === "desc" ? "asc" : "desc");
    else { setAgentSortField(field); setAgentSortDir("desc"); }
    setAgentPage(0);
  }
  const agentSortArrow = (field: typeof agentSortField) =>
    agentSortField === field ? (agentSortDir === "desc" ? " ▼" : " ▲") : "";

  const tabs: { id: Tab; label: string }[] = [
    { id: "pipeline", label: "Contacts" },
    { id: "agents", label: "Agents" },
    { id: "monitor", label: "Monitor" },
    { id: "staging", label: "Staging Queue" },
    { id: "recordings", label: "Recordings" },
    { id: "api-explorer", label: "API Explorer" },
    { id: "docs", label: "Documentation" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Phone className="w-6 h-6" />
            InContact
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            End-to-end call recording ingestion from NICE CXone
          </p>
        </div>
        <div className="flex items-center gap-3">
          {testQuery.data?.status === "connected" ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
              <CheckCircle className="w-3 h-3" /> Connected
            </span>
          ) : testQuery.isLoading ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" /> Checking...
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
              <XCircle className="w-3 h-3" /> Disconnected
            </span>
          )}
          <button
            onClick={() => authTestMutation.mutate()}
            disabled={authTestMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-md text-xs hover:bg-muted disabled:opacity-50"
          >
            {authTestMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Phone className="w-3 h-3" />}
            Test Auth
          </button>
          <button
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["staging-summary"] });
              queryClient.invalidateQueries({ queryKey: ["staging-queue"] });
              queryClient.invalidateQueries({ queryKey: ["recordings"] });
              queryClient.invalidateQueries({ queryKey: ["monitor-daily"] });
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
              {t.id === "staging" && summary ? (
                <span className="ml-1.5 text-xs bg-muted rounded-full px-1.5 py-0.5">
                  {summary.total.toLocaleString()}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {tab === "pipeline" && (
        <div className="space-y-4">

          <PipelineStep
            number={1}
            title="Retrieve Contacts"
            description="Fetch completed contacts from NICE CXone API for a date range"
            status={fetchContactsMutation.isPending ? "running" : fetchContactsMutation.isSuccess ? "success" : fetchContactsMutation.isError ? "error" : "idle"}
            onRun={() => fetchContactsMutation.mutate()}
            isRunning={fetchContactsMutation.isPending}
          >
            <div className="flex items-center gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Start Date</label>
                <input
                  type="date"
                  value={contactDateRange.startDate}
                  onChange={(e) => setContactDateRange({ ...contactDateRange, startDate: e.target.value })}
                  className="px-3 py-1.5 border border-input rounded-md text-sm bg-background"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">End Date</label>
                <input
                  type="date"
                  value={contactDateRange.endDate}
                  onChange={(e) => setContactDateRange({ ...contactDateRange, endDate: e.target.value })}
                  className="px-3 py-1.5 border border-input rounded-md text-sm bg-background"
                />
              </div>
            </div>
            {lastExtraction && (
              <div className="mt-3 p-3 bg-muted/50 border border-border rounded-md text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Last Extraction</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    lastExtraction.status === "COMPLETED" ? "bg-green-100 text-green-700" :
                    lastExtraction.status === "FAILED" ? "bg-red-100 text-red-700" :
                    lastExtraction.status === "RUNNING" ? "bg-blue-100 text-blue-700" :
                    "bg-yellow-100 text-yellow-700"
                  }`}>
                    {lastExtraction.status === "COMPLETED" ? <CheckCircle2 className="w-3 h-3" /> :
                     lastExtraction.status === "FAILED" ? <XCircle className="w-3 h-3" /> :
                     lastExtraction.status === "RUNNING" ? <Loader2 className="w-3 h-3 animate-spin" /> :
                     <Clock className="w-3 h-3" />}
                    {lastExtraction.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-muted-foreground">
                  <div>
                    <span className="font-medium text-foreground">Run ID: </span>
                    {lastExtraction.runId?.slice(0, 8)}...
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Window: </span>
                    {lastExtraction.windowStartTs
                      ? new Date(lastExtraction.windowStartTs).toLocaleDateString(undefined, { timeZone: "UTC" }) + " " + new Date(lastExtraction.windowStartTs).toLocaleTimeString(undefined, { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })
                      : "—"}
                    {" → "}
                    {lastExtraction.windowEndTs
                      ? new Date(lastExtraction.windowEndTs).toLocaleDateString(undefined, { timeZone: "UTC" }) + " " + new Date(lastExtraction.windowEndTs).toLocaleTimeString(undefined, { timeZone: "UTC", hour: "2-digit", minute: "2-digit" })
                      : "—"}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Pages / Errors: </span>
                    {lastExtraction.pageCount} / {lastExtraction.errorCount}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Completed: </span>
                    {lastExtraction.endedTs ? new Date(lastExtraction.endedTs).toLocaleString() : "—"}
                  </div>
                </div>
                {lastExtraction.executionDuration && (
                  <div className="text-muted-foreground">
                    <span className="font-medium text-foreground">Cloud Run Duration: </span>
                    {lastExtraction.executionDuration}
                  </div>
                )}
                {lastExtraction.errorSummary && (
                  <div className="text-red-600 mt-1">Error: {lastExtraction.errorSummary}</div>
                )}
              </div>
            )}
            {fetchContactsMutation.isSuccess && (
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-md text-xs text-green-700">
                Extraction run created. Run ID: {fetchContactsMutation.data?.data?.runId?.slice(0, 8)}...
                {fetchContactsMutation.data?.data?.cloudRunExecutionId && (
                  <span> — Cloud Run Job triggered</span>
                )}
              </div>
            )}
            {fetchContactsMutation.isError && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
                {(fetchContactsMutation.error as Error).message}
              </div>
            )}
          </PipelineStep>

          <div className="flex justify-center">
            <ArrowRight className="w-5 h-5 text-muted-foreground rotate-90" />
          </div>

          <PipelineStep
            number={2}
            title="Transform Contacts"
            description="Parse raw API payloads into the structured incontact.calls table"
            status={transformJobStatus?.status === "running" ? "running" : transformJobStatus?.status === "completed" ? "success" : transformJobStatus?.status === "failed" ? "error" : "idle"}
            onRun={() => transformMutation.mutate()}
            isRunning={transformJobStatus?.status === "running" || transformMutation.isPending}
          >
            <div className="flex items-center gap-4 text-sm">
              <div className="text-center">
                <div className="text-lg font-bold text-blue-600">{transformStatus?.rawPagesCount?.toLocaleString() ?? "—"}</div>
                <div className="text-xs text-muted-foreground">Raw Pages</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-green-600">{transformStatus?.callsTableCount?.toLocaleString() ?? "—"}</div>
                <div className="text-xs text-muted-foreground">Calls Table</div>
              </div>
              {transformStatus?.latestContact && (
                <div className="text-center">
                  <div className="text-sm font-medium">{new Date(transformStatus.latestContact).toLocaleDateString()}</div>
                  <div className="text-xs text-muted-foreground">Latest Contact</div>
                </div>
              )}
              <div className="flex-1" />
            </div>
            {transformJobStatus?.status === "running" && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-700 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                {transformJobStatus.step}
              </div>
            )}
            {transformJobStatus?.status === "completed" && (
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-md text-xs text-green-700">
                {transformJobStatus.rowsProcessed
                  ? `${Number(transformJobStatus.rowsProcessed).toLocaleString()} rows processed`
                  : "Transform completed"} in {transformJobStatus.durationFormatted}
              </div>
            )}
            {transformJobStatus?.status === "failed" && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
                {transformJobStatus.error}
              </div>
            )}
          </PipelineStep>

          <div className="flex justify-center">
            <ArrowRight className="w-5 h-5 text-muted-foreground rotate-90" />
          </div>

          <PipelineStep
            number={3}
            title="Queue Recordings"
            description="Find United Regional Health calls with 'Reached Patient' disposition missing from call_recordings and write to call_list.txt"
            status={runLoaderMutation.isPending ? "running" : runLoaderMutation.isSuccess ? "success" : runLoaderMutation.isError ? "error" : "idle"}
            onRun={() => runLoaderMutation.mutate()}
            isRunning={runLoaderMutation.isPending}
          >
            <div className="flex items-center gap-4 text-sm">
              <div className="text-center">
                <div className="text-lg font-bold text-blue-600">{callListStatus?.lineCount?.toLocaleString() ?? 0}</div>
                <div className="text-xs text-muted-foreground">Contact IDs in Call List</div>
              </div>
              <div className="text-center">
                <div className={`text-lg font-bold ${callListStatus?.exists ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {callListStatus?.exists ? '✓' : '—'}
                </div>
                <div className="text-xs text-muted-foreground">call_list.txt</div>
              </div>
            </div>
          </PipelineStep>

          <div className="flex justify-center">
            <ArrowRight className="w-5 h-5 text-muted-foreground rotate-90" />
          </div>

          <PipelineStep
            number={4}
            title="Download Recordings"
            description="Load call list into staging queue, then download audio files to GCS and metadata to BigQuery"
            status={
              (summary?.processing ?? 0) > 0 || downloadJobStatus?.status === "running" ? "running"
              : (summary?.failed ?? 0) > 0 ? "error"
              : downloadJobStatus?.status === "failed" ? "error"
              : (summary?.downloaded ?? 0) > 0 && (summary?.pending ?? 0) === 0 ? "success"
              : "idle"
            }
            onRun={() => runProcessorMutation.mutate()}
            isRunning={runProcessorMutation.isPending || downloadJobStatus?.status === "running" || (summary?.processing ?? 0) > 0}
          >
            <div className="space-y-3">
              {((summary?.processing ?? 0) > 0 || (summary?.pending ?? 0) > 0) && (
                <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 px-3 py-2 rounded">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    Processor running — {summary?.pending?.toLocaleString() ?? 0} pending, {summary?.processing ?? 0} in progress
                  </span>
                </div>
              )}
              {downloadJobStatus?.status === "running" && (summary?.processing ?? 0) === 0 && (
                <div className="flex items-center gap-2 text-sm text-blue-600 bg-blue-50 px-3 py-2 rounded">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    {downloadJobStatus.step === "loader-running" && "Running loader — moving call list to staging queue..."}
                    {downloadJobStatus.step === "processor-running" && "Starting processor..."}
                    {downloadJobStatus.step === "starting-loader" && "Starting loader..."}
                  </span>
                </div>
              )}
              {downloadJobStatus?.status === "failed" && downloadJobStatus.error && (
                <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">
                  Pipeline error: {downloadJobStatus.error}
                </div>
              )}
              <div className="flex items-center gap-4 text-sm">
                <div className="text-center">
                  <div className="text-lg font-bold text-green-600">{summary?.downloaded?.toLocaleString() ?? 0}</div>
                  <div className="text-xs text-muted-foreground">Downloaded</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-yellow-600">{summary?.pending?.toLocaleString() ?? 0}</div>
                  <div className="text-xs text-muted-foreground">Pending</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-blue-600">{summary?.processing ?? 0}</div>
                  <div className="text-xs text-muted-foreground">Processing</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-red-600">{summary?.failed ?? 0}</div>
                  <div className="text-xs text-muted-foreground">Failed</div>
                </div>
                {(summary?.failed ?? 0) > 0 && (
                  <button
                    onClick={() => resetFailedMutation.mutate()}
                    disabled={resetFailedMutation.isPending}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-border rounded text-xs hover:bg-muted disabled:opacity-50"
                  >
                    {resetFailedMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                    Retry Failed
                  </button>
                )}
              </div>
            </div>
          </PipelineStep>
        </div>
      )}

      {tab === "agents" && (
        <div className="space-y-4">
          <div className="flex gap-2 border-b border-border mb-4">
            {[{ id: "extract" as const, label: "Extract" }, { id: "results" as const, label: "Results" }].map((st) => (
              <button
                key={st.id}
                onClick={() => setAgentSubTab(st.id)}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  agentSubTab === st.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {st.label}
                {st.id === "results" && agentData ? (
                  <span className="ml-1.5 text-xs bg-muted rounded-full px-1.5 py-0.5">{agentData.length}</span>
                ) : null}
              </button>
            ))}
          </div>

          {agentSubTab === "extract" && (
            <div className="space-y-4">
              <PipelineStep
                number={1}
                title="Retrieve Agent Performance"
                description="Fetch performance metrics from NICE CXone API and store raw payload in BigQuery api_payload table"
                status={
                  fetchAgentsRunMutation.isPending || isAgentsRunActive ? "running" :
                  agentsLastRun?.status === "COMPLETED" ? "success" :
                  agentsLastRun?.status === "FAILED" ? "error" :
                  "idle"
                }
                onRun={() => fetchAgentsRunMutation.mutate()}
                isRunning={fetchAgentsRunMutation.isPending || isAgentsRunActive}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">Start Date</label>
                    <input type="date" value={agentDateRange.startDate}
                      onChange={(e) => setAgentDateRange({ ...agentDateRange, startDate: e.target.value })}
                      className="px-3 py-1.5 border border-input rounded-md text-sm bg-background" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">End Date</label>
                    <input type="date" value={agentDateRange.endDate}
                      onChange={(e) => setAgentDateRange({ ...agentDateRange, endDate: e.target.value })}
                      className="px-3 py-1.5 border border-input rounded-md text-sm bg-background" />
                  </div>
                </div>

                {agentsLastRun && (
                  <div className="p-3 bg-muted/50 border border-border rounded-md text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Last Extraction</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        agentsLastRun.status === "COMPLETED" ? "bg-green-100 text-green-700" :
                        agentsLastRun.status === "FAILED" ? "bg-red-100 text-red-700" :
                        agentsLastRun.status === "RUNNING" ? "bg-blue-100 text-blue-700" :
                        agentsLastRun.status === "PENDING" ? "bg-yellow-100 text-yellow-700" :
                        "bg-gray-100 text-gray-700"
                      }`}>
                        {agentsLastRun.status === "COMPLETED" ? <CheckCircle2 className="w-3 h-3" /> :
                         agentsLastRun.status === "FAILED" ? <XCircle className="w-3 h-3" /> :
                         (agentsLastRun.status === "RUNNING" || agentsLastRun.status === "PENDING") ? <Loader2 className="w-3 h-3 animate-spin" /> :
                         <Clock className="w-3 h-3" />}
                        {agentsLastRun.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-muted-foreground">
                      <div><span className="font-medium text-foreground">Run ID: </span>{agentsLastRun.runId?.slice(0, 8)}...</div>
                      <div>
                        <span className="font-medium text-foreground">Window: </span>
                        {agentsLastRun.windowStartTs ? new Date(agentsLastRun.windowStartTs).toLocaleDateString(undefined, { timeZone: "UTC" }) : "—"}
                        {" → "}
                        {agentsLastRun.windowEndTs ? new Date(agentsLastRun.windowEndTs).toLocaleDateString(undefined, { timeZone: "UTC" }) : "—"}
                      </div>
                      <div><span className="font-medium text-foreground">Pages / Errors: </span>{agentsLastRun.pageCount} / {agentsLastRun.errorCount}</div>
                      <div><span className="font-medium text-foreground">Completed: </span>{agentsLastRun.endedTs ? new Date(agentsLastRun.endedTs).toLocaleString() : "—"}</div>
                    </div>
                    {agentsLastRun.errorSummary && (
                      <div className="text-red-600 mt-1">Error: {agentsLastRun.errorSummary}</div>
                    )}
                  </div>
                )}
              </PipelineStep>

              <div className="flex justify-center">
                <ArrowRight className="w-5 h-5 text-muted-foreground rotate-90" />
              </div>

              <PipelineStep
                number={2}
                title="Transform to Agent Activity"
                description="Extract agent performance from raw api_payload into incontact.agent_activity table. Processes all successful payloads, deduplicates by agent ID + date window."
                status={
                  isAgentsTransformRunning ? "running" :
                  agentsTransformJobStatus?.status === "completed" ? "success" :
                  agentsTransformJobStatus?.status === "failed" ? "error" :
                  "idle"
                }
                onRun={() => agentsTransformMutation.mutate()}
                isRunning={isAgentsTransformRunning || agentsTransformMutation.isPending}
              >
                {agentsTransformStatus && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold text-foreground">{agentsTransformStatus.rawPagesCount}</div>
                      <div className="text-xs text-muted-foreground">Raw Pages</div>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold text-blue-600">{agentsTransformStatus.agentActivityCount}</div>
                      <div className="text-xs text-muted-foreground">Agent Activity Rows</div>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <div className="text-xs font-bold text-muted-foreground">{agentsTransformStatus.lastIngested ? new Date(agentsTransformStatus.lastIngested).toLocaleString() : "—"}</div>
                      <div className="text-xs text-muted-foreground">Last Ingested</div>
                    </div>
                  </div>
                )}
                {isAgentsTransformRunning && agentsTransformJobStatus?.step && (
                  <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {agentsTransformJobStatus.step}
                  </div>
                )}
                {agentsTransformJobStatus?.status === "completed" && (
                  <div className="p-2 bg-green-50 border border-green-200 rounded text-sm text-green-700">
                    Completed in {agentsTransformJobStatus.durationFormatted}
                    {agentsTransformJobStatus.rowsProcessed && ` — ${agentsTransformJobStatus.rowsProcessed} rows`}
                  </div>
                )}
                {agentsTransformJobStatus?.status === "failed" && (
                  <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                    Failed: {agentsTransformJobStatus.error}
                  </div>
                )}
              </PipelineStep>
            </div>
          )}

          {agentSubTab === "results" && (
            <div className="space-y-4">
              {!agentData ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No data loaded yet. Switch to the Extract sub-tab and run a preview.</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                      { label: "Total Agents", value: agentSummary?.total, color: "text-foreground" },
                      { label: "Active Agents", value: agentSummary?.active, color: "text-green-600" },
                      { label: "Total Calls", value: agentSummary?.totalCalls.toLocaleString(), color: "text-blue-600" },
                      { label: "Total Talk Time", value: agentSummary ? `${Math.floor(agentSummary.totalTalkSeconds / 3600)}h ${Math.floor((agentSummary.totalTalkSeconds % 3600) / 60)}m` : "—", color: "text-purple-600" },
                      { label: "Avg Occupancy", value: `${agentSummary?.avgOccupancy.toFixed(1)}%`, color: "text-orange-600" },
                    ].map((stat) => (
                      <div key={stat.label} className="text-center p-3 border border-border rounded-lg bg-card">
                        <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
                        <div className="text-xs text-muted-foreground">{stat.label}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="relative flex-1 min-w-[200px] max-w-sm">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input value={agentSearchTerm}
                        onChange={(e) => { setAgentSearchTerm(e.target.value); setAgentPage(0); }}
                        placeholder="Search by Agent ID or Team ID..."
                        className="pl-9 pr-3 py-1.5 w-full border border-input rounded-md text-sm bg-background" />
                    </div>
                    <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={showInactiveAgents}
                        onChange={(e) => { setShowInactiveAgents(e.target.checked); setAgentPage(0); }}
                        className="rounded border-input" />
                      Show inactive agents
                    </label>
                    <div className="text-xs text-muted-foreground">
                      Showing {filteredAgents.length} of {agentData.length} agents
                    </div>
                    <div className="flex-1" />
                    <CopyJsonButton json={agentData} />
                  </div>

                  <div className="border border-border rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/50 border-b border-border">
                            <th className="px-3 py-2 text-left font-medium text-xs cursor-pointer hover:bg-muted" onClick={() => handleAgentSort("agentId")}>Agent ID{agentSortArrow("agentId")}</th>
                            <th className="px-3 py-2 text-left font-medium text-xs">Team ID</th>
                            <th className="px-3 py-2 text-right font-medium text-xs">Offered</th>
                            <th className="px-3 py-2 text-right font-medium text-xs">Inbound</th>
                            <th className="px-3 py-2 text-right font-medium text-xs">Outbound</th>
                            <th className="px-3 py-2 text-right font-medium text-xs cursor-pointer hover:bg-muted" onClick={() => handleAgentSort("totalHandled")}>Total Handled{agentSortArrow("totalHandled")}</th>
                            <th className="px-3 py-2 text-right font-medium text-xs cursor-pointer hover:bg-muted" onClick={() => handleAgentSort("totalTalkTime")}>Talk Time{agentSortArrow("totalTalkTime")}</th>
                            <th className="px-3 py-2 text-right font-medium text-xs">Avg Handle</th>
                            <th className="px-3 py-2 text-right font-medium text-xs cursor-pointer hover:bg-muted" onClick={() => handleAgentSort("loginTime")}>Login Time{agentSortArrow("loginTime")}</th>
                            <th className="px-3 py-2 text-right font-medium text-xs">Available</th>
                            <th className="px-3 py-2 text-right font-medium text-xs">ACW</th>
                            <th className="px-3 py-2 text-right font-medium text-xs cursor-pointer hover:bg-muted" onClick={() => handleAgentSort("occupancy")}>Occupancy{agentSortArrow("occupancy")}</th>
                            <th className="px-3 py-2 text-right font-medium text-xs">Working Rate</th>
                            <th className="px-3 py-2 text-right font-medium text-xs">Refused</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pagedAgents.map((a) => (
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
                              <td className="px-3 py-2 text-right">{parseFloat(a.workingRate) > 0 ? `${a.workingRate}%` : "—"}</td>
                              <td className="px-3 py-2 text-right">
                                {parseInt(a.refused) > 0 ? <span className="text-red-600 font-medium">{a.refused}</span> : "0"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {agentTotalPages > 1 && (
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">Page {agentPage + 1} of {agentTotalPages} ({filteredAgents.length} agents)</p>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setAgentPage(Math.max(0, agentPage - 1))} disabled={agentPage === 0}
                          className="p-1.5 border border-border rounded hover:bg-muted disabled:opacity-30">
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button onClick={() => setAgentPage(Math.min(agentTotalPages - 1, agentPage + 1))} disabled={agentPage >= agentTotalPages - 1}
                          className="p-1.5 border border-border rounded hover:bg-muted disabled:opacity-30">
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
      )}

      {tab === "monitor" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 border border-border rounded-lg p-3 bg-card">
            <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium text-muted-foreground shrink-0">Filter:</span>
            {(["all", "today", "yesterday", "7d", "30d", "custom"] as const).map((preset) => {
              const labels: Record<string, string> = { all: "All Time", today: "Today", yesterday: "Yesterday", "7d": "Last 7 Days", "30d": "Last 30 Days", custom: "Custom Range" };
              return (
                <button
                  key={preset}
                  onClick={() => setFilterPreset(preset)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    filterPreset === preset
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {labels[preset]}
                </button>
              );
            })}
            {filterPreset === "custom" && (
              <>
                <div className="flex items-center gap-1.5 ml-2">
                  <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    type="date"
                    value={filterStartDate}
                    onChange={(e) => setFilterStartDate(e.target.value)}
                    className="border border-input rounded-md px-2 py-1 text-xs bg-background"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <input
                    type="date"
                    value={filterEndDate}
                    onChange={(e) => setFilterEndDate(e.target.value)}
                    className="border border-input rounded-md px-2 py-1 text-xs bg-background"
                  />
                </div>
              </>
            )}
            {filterPreset !== "all" && (
              <button
                onClick={() => { setFilterPreset("all"); setFilterStartDate(""); setFilterEndDate(""); }}
                className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>

          {summaryLoading ? (
            <MetricsSkeleton />
          ) : (
            <div className="grid gap-3 grid-cols-2 md:grid-cols-5 mb-2">
              <div className="border border-border rounded-lg p-3 bg-card text-center">
                <div className="text-2xl font-bold text-green-600">{summary?.downloaded?.toLocaleString() ?? "—"}</div>
                <div className="text-xs text-muted-foreground">Downloaded</div>
              </div>
              <div className="border border-border rounded-lg p-3 bg-card text-center">
                <div className="text-2xl font-bold text-yellow-600">{summary?.pending?.toLocaleString() ?? "—"}</div>
                <div className="text-xs text-muted-foreground">Pending</div>
              </div>
              <div className="border border-border rounded-lg p-3 bg-card text-center">
                <div className="text-2xl font-bold text-blue-600">{summary?.processing?.toLocaleString() ?? "—"}</div>
                <div className="text-xs text-muted-foreground">Processing</div>
              </div>
              <div className="border border-border rounded-lg p-3 bg-card text-center">
                <div className="text-2xl font-bold text-red-600">{summary?.failed?.toLocaleString() ?? "—"}</div>
                <div className="text-xs text-muted-foreground">Failed</div>
              </div>
              <div className="border border-border rounded-lg p-3 bg-card text-center">
                <div className="text-2xl font-bold">{totalContacts.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">Total Contacts</div>
              </div>
            </div>
          )}

          {monitorLoading ? (
            <MetricsSkeleton />
          ) : monitorRows.length > 0 ? (
            <ContactCalendar rows={monitorRows} />
          ) : (
            <div className="text-center py-8 text-sm text-muted-foreground">No contact data available for the selected period.</div>
          )}
        </div>
      )}

      {tab === "staging" && (
        <div className="space-y-4">
          {summaryLoading ? (
            <MetricsSkeleton />
          ) : (
            <div className="grid gap-3 grid-cols-5">
              {(["pending", "processing", "downloaded", "failed", "total"] as const).map((key) => (
                <div key={key} className="border border-border rounded-lg p-3 bg-card text-center">
                  <div className="text-2xl font-bold">{summary?.[key]?.toLocaleString() ?? "—"}</div>
                  <div className="text-xs text-muted-foreground capitalize">{key}</div>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="border border-border rounded-lg p-4 bg-card">
              <h3 className="text-sm font-semibold mb-3">Add Call IDs</h3>
              <textarea
                value={callIds}
                onChange={(e) => setCallIds(e.target.value)}
                placeholder="Enter call IDs (one per line or comma-separated)"
                rows={4}
                className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background resize-none mb-2"
              />
              <input
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                placeholder="Batch ID (optional)"
                className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background mb-3"
              />
              <button
                onClick={() => addCallIdsMutation.mutate()}
                disabled={!callIds.trim() || addCallIdsMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {addCallIdsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Add to Queue
              </button>
            </div>

            <div className="border border-border rounded-lg p-4 bg-card">
              <h3 className="text-sm font-semibold mb-3">Actions</h3>
              <div className="space-y-2">
                <button
                  onClick={() => resetFailedMutation.mutate()}
                  disabled={resetFailedMutation.isPending}
                  className="w-full inline-flex items-center gap-2 px-3 py-2 border border-border rounded-md text-sm hover:bg-muted disabled:opacity-50"
                >
                  {resetFailedMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  Reset Failed to Pending
                </button>
                <button
                  onClick={() => runProcessorMutation.mutate()}
                  disabled={runProcessorMutation.isPending || downloadJobStatus?.status === "running"}
                  className="w-full inline-flex items-center gap-2 px-3 py-2 border border-border rounded-md text-sm hover:bg-muted disabled:opacity-50"
                >
                  {(runProcessorMutation.isPending || downloadJobStatus?.status === "running") ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Run Download Pipeline (Loader → Processor)
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Queue Items</h3>
            <div className="flex gap-2">
              <a
                href="/api/export/staging-queue?format=csv"
                download
                className="text-xs border border-border rounded px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-1.5"
              >
                <Download className="w-3 h-3" /> CSV
              </a>
            </div>
          </div>

          {queueLoading ? (
            <TableSkeleton rows={8} cols={6} />
          ) : (
            <>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Call ID</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Batch</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Created</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Processed</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stagingItems.map((item) => (
                      <tr key={item.id} className="border-t border-border hover:bg-muted/30">
                        <td className="px-4 py-3 font-mono text-xs">{item.call_id}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColors[item.status] ?? ""}`}>
                            {item.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{item.batch_id || "—"}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{item.created_at ? new Date(item.created_at).toLocaleString() : "—"}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{item.processed_at ? new Date(item.processed_at).toLocaleString() : "—"}</td>
                        <td className="px-4 py-3 text-xs text-destructive max-w-[200px] truncate">{item.error_message || ""}</td>
                      </tr>
                    ))}
                    {stagingItems.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No items in queue</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {stagingTotalPages > 1 && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Showing {stagingPage * pageSize + 1}–{Math.min((stagingPage + 1) * pageSize, allQueueItems.length)} of {allQueueItems.length}
                  </span>
                  <div className="flex gap-1">
                    <button disabled={stagingPage === 0} onClick={() => setStagingPage(stagingPage - 1)} className="p-1.5 border border-border rounded hover:bg-muted disabled:opacity-30">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button disabled={stagingPage >= stagingTotalPages - 1} onClick={() => setStagingPage(stagingPage + 1)} className="p-1.5 border border-border rounded hover:bg-muted disabled:opacity-30">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === "recordings" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {recTotal.toLocaleString()} recordings in BigQuery
            </p>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={recSearch}
              onChange={(e) => setRecSearch(e.target.value)}
              placeholder="Search by contact ID, agent name, or file name..."
              className="w-full pl-9 pr-3 py-2 border border-input rounded-md text-sm bg-background"
            />
          </div>

          {selectedRecording && (
            <div className="border border-primary/30 bg-primary/5 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileAudio className="w-5 h-5 text-primary" />
                  <div>
                    <div className="text-sm font-medium">
                      Contact {selectedRecording.acd_contact_id || selectedRecording.contact_id}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {selectedRecording.agent_name || "Unknown Agent"} &middot; {selectedRecording.start_date ? new Date(selectedRecording.start_date).toLocaleString() : ""} &middot; {formatDuration(selectedRecording.duration_seconds)}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => { setSelectedRecording(null); setPlaybackUrl(null); setPlaybackError(null); }}
                  className="p-1 hover:bg-muted rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {playbackLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading recording...
                </div>
              )}
              {playbackError && (
                <div className="flex items-center gap-2 text-sm text-red-600 py-2">
                  <XCircle className="w-4 h-4" /> {playbackError}
                </div>
              )}
              {playbackUrl && (
                <div>
                  <audio controls className="w-full" src={playbackUrl} autoPlay>
                    Your browser does not support the audio element.
                  </audio>
                  <div className="flex justify-end mt-2">
                    <a
                      href={playbackUrl}
                      download={`${selectedRecording.acd_contact_id || selectedRecording.contact_id}.mp4`}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" /> Download MP4
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}

          {recLoading ? (
            <TableSkeleton rows={10} cols={7} />
          ) : recRows.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-border rounded-lg">
              <FileAudio className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">{recSearch ? "No matching recordings" : "No recordings found"}</p>
            </div>
          ) : (
            <>
              <div className="border border-border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="w-10 px-3 py-3"></th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Contact ID</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Agent</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Duration</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Direction</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recRows.map((r) => {
                      const cid = r.acd_contact_id || r.contact_id;
                      const isSelected = selectedRecording?.id === r.id;
                      return (
                        <tr
                          key={r.id}
                          onClick={() => handlePlayRecording(r)}
                          className={`border-t border-border cursor-pointer transition-colors ${
                            isSelected ? "bg-primary/10" : "hover:bg-muted/30"
                          }`}
                        >
                          <td className="px-3 py-3 text-center">
                            <Play className={`w-4 h-4 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{cid}</td>
                          <td className="px-4 py-3 text-xs">{r.agent_name || r.agent_id || "—"}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{r.start_date ? new Date(r.start_date).toLocaleString() : "—"}</td>
                          <td className="px-4 py-3 text-xs">{formatDuration(r.duration_seconds)}</td>
                          <td className="px-4 py-3 text-xs">{r.direction || "—"}</td>
                          <td className="px-4 py-3 text-xs">{formatBytes(r.file_size_bytes)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Showing {recPage * recPageSize + 1}–{Math.min((recPage + 1) * recPageSize, recTotal)} of {recTotal.toLocaleString()}
                </span>
                <div className="flex gap-1">
                  <button disabled={recPage === 0} onClick={() => setRecPage(recPage - 1)} className="p-1.5 border border-border rounded hover:bg-muted disabled:opacity-30">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button disabled={recPage >= recTotalPages - 1} onClick={() => setRecPage(recPage + 1)} className="p-1.5 border border-border rounded hover:bg-muted disabled:opacity-30">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "api-explorer" && (
        <div className="flex gap-4">
          <div className="w-72 shrink-0 space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">Endpoints</h3>
            {(() => {
              const defs = endpointDefs ?? [];
              const categories = [...new Set(defs.map((e) => e.category))];
              return categories.map((cat) => (
                <div key={cat}>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 py-1.5">{cat}</div>
                  {defs.filter((e) => e.category === cat).map((ep) => (
                    <button
                      key={ep.path}
                      onClick={() => { setApiEndpoint(ep.path); setApiParamValues({}); setFetchResult(null); }}
                      className={`w-full text-left px-3 py-2.5 rounded-md text-sm transition-colors ${
                        apiEndpoint === ep.path
                          ? "bg-primary/10 text-primary border border-primary/20"
                          : "hover:bg-muted text-foreground"
                      }`}
                    >
                      <div className="font-medium text-xs">{ep.name}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{ep.method} {ep.path.split("/").slice(-2).join("/")}</div>
                    </button>
                  ))}
                </div>
              ));
            })()}
          </div>

          <div className="flex-1 min-w-0 space-y-4">
            {!selectedEndpointDef ? (
              <div className="text-center py-16 border border-dashed border-border rounded-lg">
                <Database className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground text-sm">Select an endpoint from the list to get started</p>
              </div>
            ) : (
              <>
                <div className="border border-border rounded-lg p-4 bg-card">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h3 className="text-base font-semibold">{selectedEndpointDef.name}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">{selectedEndpointDef.description}</p>
                    </div>
                    <span className="text-[10px] font-mono bg-muted px-2 py-1 rounded">{selectedEndpointDef.method}</span>
                  </div>
                  <div className="mt-1 text-xs font-mono text-muted-foreground bg-muted/50 px-3 py-1.5 rounded truncate">
                    {selectedEndpointDef.path}
                  </div>
                </div>

                <div className="border border-border rounded-lg p-4 bg-card">
                  <h4 className="text-sm font-semibold mb-3">Parameters</h4>
                  {selectedEndpointDef.params.length === 0 ? (
                    <p className="text-xs text-muted-foreground">This endpoint has no parameters.</p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {selectedEndpointDef.params.map((p) => (
                        <div key={p.name}>
                          <label className="flex items-center gap-1 text-xs font-medium mb-1">
                            {p.label}
                            {p.required && <span className="text-red-500">*</span>}
                          </label>
                          <input
                            type={p.type === "date" ? "date" : p.type === "number" ? "number" : "text"}
                            value={apiParamValues[p.name] ?? ""}
                            onChange={(e) => setApiParamValues((prev) => ({ ...prev, [p.name]: e.target.value }))}
                            placeholder={p.placeholder}
                            className="w-full px-3 py-1.5 border border-input rounded-md text-sm bg-background"
                          />
                          {p.description && <p className="text-[10px] text-muted-foreground mt-0.5">{p.description}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-4">
                    <button
                      onClick={() => fetchApiMutation.mutate()}
                      disabled={fetchApiMutation.isPending || !apiEndpoint}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
                    >
                      {fetchApiMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      Send Request
                    </button>
                    <button
                      onClick={() => { setApiParamValues({}); setFetchResult(null); }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 border border-border rounded-md text-xs hover:bg-muted"
                    >
                      <RotateCcw className="w-3 h-3" /> Clear
                    </button>
                    {selectedEndpointDef?.name === "Dispositions" && (
                      <button
                        onClick={() => syncDispositionsMutation.mutate()}
                        disabled={syncDispositionsMutation.isPending}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50 ml-auto"
                      >
                        {syncDispositionsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        {syncDispositionsMutation.isPending ? "Syncing..." : "Sync to BigQuery"}
                      </button>
                    )}
                  </div>
                </div>

                {fetchResult && (
                  <div className="border border-border rounded-lg bg-card">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                      <h4 className="text-sm font-semibold">Response</h4>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{fetchResult.timestamp ? new Date(fetchResult.timestamp).toLocaleTimeString() : ""}</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          fetchResult.statusCode < 400 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                        }`}>
                          {fetchResult.statusCode < 400 ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                          {fetchResult.statusCode} {fetchResult.statusText}
                        </span>
                        <CopyJsonButton json={fetchResult.data} />
                      </div>
                    </div>
                    <pre className="text-xs p-4 overflow-auto max-h-[500px] whitespace-pre-wrap font-mono">
                      {JSON.stringify(fetchResult.data, null, 2)}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {tab === "docs" && (
        <div className="flex gap-6">
          <DocsSidebar />
        </div>
      )}
    </div>
  );
}

type DocSection = "pipeline" | "monitor" | "staging" | "recordings" | "api-explorer" | "architecture";

function DocsSidebar() {
  const [section, setSection] = useState<DocSection>("pipeline");

  const sections: { id: DocSection; label: string; icon: React.ReactNode }[] = [
    { id: "pipeline", label: "Pipeline", icon: <ArrowRight className="w-4 h-4" /> },
    { id: "monitor", label: "Monitor", icon: <Database className="w-4 h-4" /> },
    { id: "staging", label: "Staging Queue", icon: <Clock className="w-4 h-4" /> },
    { id: "recordings", label: "Recordings", icon: <FileAudio className="w-4 h-4" /> },
    { id: "api-explorer", label: "API Explorer", icon: <Send className="w-4 h-4" /> },
    { id: "architecture", label: "Architecture", icon: <Database className="w-4 h-4" /> },
  ];

  return (
    <>
      <div className="w-56 shrink-0 space-y-1">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 mb-2">Sections</h3>
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-md text-sm transition-colors ${
              section === s.id
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {s.icon}
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-w-0">
        <DocsContent section={section} />
      </div>
    </>
  );
}

function DocsContent({ section }: { section: DocSection }) {
  const content: Record<DocSection, React.ReactNode> = {
    pipeline: (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold mb-2">Pipeline</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The Pipeline tab provides a sequential, 4-step workflow for ingesting call recordings from NICE CXone into BigQuery and Google Cloud Storage. Each step depends on the previous one completing successfully.
          </p>
        </div>
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">1</span>
              Retrieve Contacts
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Fetches completed contact records from the NICE CXone API for a specified date range. The data is stored as raw JSON pages in the <code className="bg-muted px-1 rounded">raw.api_responses</code> BigQuery table. Each page contains up to 1,000 contacts. The extraction is managed as a Cloud Run job that handles pagination and rate limiting automatically.
            </p>
            <div className="mt-2 text-xs text-muted-foreground">
              <span className="font-medium">Inputs:</span> Start Date, End Date<br />
              <span className="font-medium">Output:</span> Raw API pages in <code className="bg-muted px-1 rounded">raw.api_responses</code>
            </div>
          </div>
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">2</span>
              Transform Contacts
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Parses the raw JSON pages from Step 1 and transforms them into the structured <code className="bg-muted px-1 rounded">incontact.calls</code> table. Handles both old and new API payload formats. Deduplicates by contact ID, extracting fields like agent name, disposition, duration, skill, and team.
            </p>
            <div className="mt-2 text-xs text-muted-foreground">
              <span className="font-medium">Input:</span> <code className="bg-muted px-1 rounded">raw.api_responses</code><br />
              <span className="font-medium">Output:</span> <code className="bg-muted px-1 rounded">incontact.calls</code>
            </div>
          </div>
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">3</span>
              Queue Recordings
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Queries <code className="bg-muted px-1 rounded">incontact.calls</code> for United Regional Health contacts with a "Reached Patient" disposition that don't already have a downloaded recording. Writes the missing contact IDs to <code className="bg-muted px-1 rounded">gs://incontact-audio/call_list/call_list.txt</code>.
            </p>
            <div className="mt-2 text-xs text-muted-foreground">
              <span className="font-medium">Input:</span> <code className="bg-muted px-1 rounded">incontact.calls</code> + <code className="bg-muted px-1 rounded">incontact.call_recordings</code><br />
              <span className="font-medium">Output:</span> <code className="bg-muted px-1 rounded">call_list.txt</code> in GCS
            </div>
          </div>
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">4</span>
              Download Recordings
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Two-phase Cloud Run job execution. First, the <strong>loader</strong> reads <code className="bg-muted px-1 rounded">call_list.txt</code> and inserts contact IDs into the <code className="bg-muted px-1 rounded">staging_call_queue</code> table. Then the <strong>processor</strong> downloads each MP4 recording from the NICE CXone Media Playback API and uploads it to <code className="bg-muted px-1 rounded">gs://incontact-audio/</code>, recording metadata into <code className="bg-muted px-1 rounded">incontact.call_recordings</code>.
            </p>
            <div className="mt-2 text-xs text-muted-foreground">
              <span className="font-medium">Input:</span> <code className="bg-muted px-1 rounded">call_list.txt</code><br />
              <span className="font-medium">Output:</span> MP4 files in GCS + metadata in <code className="bg-muted px-1 rounded">call_recordings</code><br />
              <span className="font-medium">Concurrency:</span> Only one processor runs at a time (BQ-level guard)
            </div>
          </div>
        </div>
      </div>
    ),
    monitor: (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold mb-2">Monitor</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The Monitor tab provides a dashboard view of the entire InContact pipeline's output. It shows aggregate statistics and a calendar heatmap of daily contact volumes.
          </p>
        </div>
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-2">Filter Bar</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Time-range filter at the top with presets (All Time, Today, Yesterday, Last 7 Days, Last 30 Days) or a custom date range. All summary cards and the calendar below respond to this filter.
            </p>
          </div>
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-2">Summary Cards</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Five metric cards showing the current state of the download pipeline:
            </p>
            <ul className="text-xs text-muted-foreground mt-2 space-y-1 list-disc pl-4">
              <li><span className="text-green-600 font-medium">Downloaded</span> — Recordings successfully downloaded to GCS</li>
              <li><span className="text-yellow-600 font-medium">Pending</span> — Contact IDs in the staging queue awaiting download</li>
              <li><span className="text-blue-600 font-medium">Processing</span> — Currently being downloaded by the processor</li>
              <li><span className="text-red-600 font-medium">Failed</span> — Download attempts that encountered errors</li>
              <li><strong>Total Contacts</strong> — Sum of all contacts across the filtered period</li>
            </ul>
          </div>
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-2">Calendar Heatmap</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Monthly calendar grids showing daily contact counts. Each day is color-coded relative to the day-of-week average:
            </p>
            <ul className="text-xs text-muted-foreground mt-2 space-y-1 list-disc pl-4">
              <li><span className="text-green-600 font-medium">Green</span> — Within 10% of average</li>
              <li><span className="text-yellow-600 font-medium">Yellow</span> — 10-20% off average</li>
              <li><span className="text-red-600 font-medium">Red</span> — Over 20% off average</li>
            </ul>
            <p className="text-xs text-muted-foreground mt-2">Day-of-week averages are displayed above the calendars so you can quickly spot anomalies.</p>
          </div>
        </div>
      </div>
    ),
    staging: (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold mb-2">Staging Queue</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The Staging Queue tab shows the individual rows in the <code className="bg-muted px-1 rounded">incontact.staging_call_queue</code> BigQuery table. This is the intermediate table that manages the download lifecycle for each call recording.
          </p>
        </div>
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-2">Queue Table</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Each row represents a single contact ID moving through the download process. Columns include:
            </p>
            <ul className="text-xs text-muted-foreground mt-2 space-y-1 list-disc pl-4">
              <li><strong>Call ID</strong> — The NICE CXone contact ID</li>
              <li><strong>Status</strong> — Current state: <code className="bg-muted px-1 rounded">pending</code>, <code className="bg-muted px-1 rounded">processing</code>, <code className="bg-muted px-1 rounded">downloaded</code>, or <code className="bg-muted px-1 rounded">failed</code></li>
              <li><strong>Error Message</strong> — Details if the download failed</li>
              <li><strong>Batch ID</strong> — Groups contacts loaded in the same batch</li>
              <li><strong>Created At</strong> — When the contact was added to the queue</li>
              <li><strong>Processed At</strong> — When processing completed (or failed)</li>
            </ul>
          </div>
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-2">Use Cases</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Use this tab to troubleshoot download failures. If the Failed counter on the Monitor tab increases, switch to the Staging Queue to see the specific error messages for individual contacts. You can also manually add contact IDs to the queue for re-processing.
            </p>
          </div>
        </div>
      </div>
    ),
    recordings: (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold mb-2">Recordings</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The Recordings tab is a searchable spreadsheet view of the <code className="bg-muted px-1 rounded">incontact.call_recordings</code> BigQuery table. It shows all successfully downloaded call recordings with inline playback.
          </p>
        </div>
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-2">Search</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Server-side search with debounced input. Search by contact ID, agent name, or file name. Results are paginated at 50 records per page with server-side offset/limit for efficient handling of large datasets.
            </p>
          </div>
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-2">Click-to-Play</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Click any row in the table to play the recording. The audio is streamed directly from <code className="bg-muted px-1 rounded">gs://incontact-audio/</code> through the API server (no signed URLs required). The player supports seeking via HTTP range requests. You can also download the MP4 file directly from the player panel.
            </p>
          </div>
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-2">Table Columns</h3>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
              <li><strong>Contact ID</strong> — The ACD contact ID (or fallback contact ID)</li>
              <li><strong>Agent</strong> — Agent name who handled the call</li>
              <li><strong>Date</strong> — When the call started</li>
              <li><strong>Duration</strong> — Call length in minutes and seconds</li>
              <li><strong>Direction</strong> — Inbound or outbound</li>
              <li><strong>Size</strong> — File size of the MP4 recording</li>
            </ul>
          </div>
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-2">Storage</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Recordings are stored as MP4 files at <code className="bg-muted px-1 rounded">gs://incontact-audio/&lt;contactId&gt;.mp4</code>. Metadata (agent, duration, timestamps, file size) is stored in the <code className="bg-muted px-1 rounded">incontact.call_recordings</code> BigQuery table. The join key between calls and recordings is <code className="bg-muted px-1 rounded">acd_contact_id</code>.
            </p>
          </div>
        </div>
      </div>
    ),
    "api-explorer": (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold mb-2">API Explorer</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The API Explorer provides a structured interface for making authenticated requests to the NICE CXone API. It uses the same OAuth credentials stored in GCP Secret Manager that the pipeline uses.
          </p>
        </div>
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-2">Endpoint Selection</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The left sidebar lists available endpoints organized by category (Contacts, Media, Workforce). Click an endpoint to see its description, full API path, and available parameters. Only allowlisted endpoints can be called for security.
            </p>
          </div>
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-2">Available Endpoints</h3>
            <ul className="text-xs text-muted-foreground space-y-2 list-disc pl-4">
              <li><strong>Completed Contacts</strong> — Retrieve call records for a date range with filtering and pagination</li>
              <li><strong>Active Contacts</strong> — See currently active calls across all skills</li>
              <li><strong>Media Playback</strong> — Get playback URLs for specific contact recordings</li>
              <li><strong>Dispositions</strong> — List all disposition codes used to categorize call outcomes</li>
              <li><strong>Agents</strong> — List agent profiles and status information</li>
              <li><strong>Skills Summary</strong> — Queue counts and service level data by skill</li>
            </ul>
          </div>
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-2">Authentication</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The API server authenticates using an access key stored in GCP Secret Manager (<code className="bg-muted px-1 rounded">inContact-Client-Id</code> and <code className="bg-muted px-1 rounded">inContact-Client-Secret</code>). A Bearer token is obtained from <code className="bg-muted px-1 rounded">na1.nice-incontact.com</code> for each request. The connection status is shown in the page header.
            </p>
          </div>
        </div>
      </div>
    ),
    architecture: (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold mb-2">Architecture</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The InContact pipeline runs on Google Cloud Platform within the <code className="bg-muted px-1 rounded">guidewaycare-476802</code> project.
          </p>
        </div>
        <div className="space-y-4">
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-2">GCP Services</h3>
            <ul className="text-xs text-muted-foreground space-y-2 list-disc pl-4">
              <li><strong>Cloud Run (Services)</strong> — Hosts the API Server and Control Plane web app</li>
              <li><strong>Cloud Run (Jobs)</strong> — <code className="bg-muted px-1 rounded">incontact-call-loader</code> and <code className="bg-muted px-1 rounded">incontact-call-processor</code> handle batch ingestion</li>
              <li><strong>BigQuery</strong> — <code className="bg-muted px-1 rounded">raw</code> dataset (us-central1) for API responses; <code className="bg-muted px-1 rounded">incontact</code> dataset (US multi-region) for calls, staging queue, and recordings</li>
              <li><strong>Cloud Storage</strong> — <code className="bg-muted px-1 rounded">gs://incontact-audio/</code> bucket stores MP4 recordings and the call_list.txt manifest</li>
              <li><strong>Secret Manager</strong> — Stores NICE CXone API credentials</li>
              <li><strong>Artifact Registry</strong> — Docker images for Cloud Run services and jobs</li>
            </ul>
          </div>
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-2">BigQuery Tables</h3>
            <ul className="text-xs text-muted-foreground space-y-2 list-disc pl-4">
              <li><code className="bg-muted px-1 rounded">raw.api_responses</code> — Raw JSON pages from the NICE API (us-central1)</li>
              <li><code className="bg-muted px-1 rounded">incontact.calls</code> — Structured call records with all metadata (US multi-region)</li>
              <li><code className="bg-muted px-1 rounded">incontact.staging_call_queue</code> — Download queue tracking each contact through the pipeline</li>
              <li><code className="bg-muted px-1 rounded">incontact.call_recordings</code> — Metadata for downloaded recordings (join via <code className="bg-muted px-1 rounded">acd_contact_id</code>)</li>
            </ul>
          </div>
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-2">Deployment</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              CI/CD is handled via GitHub Actions. On push to <code className="bg-muted px-1 rounded">main</code>, the CD workflow builds Docker images, pushes to Artifact Registry, and deploys to Cloud Run. The API Server and Control Plane are deployed as Cloud Run services. The processor Docker image is shared between the loader and processor Cloud Run jobs (differentiated by command override).
            </p>
          </div>
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-2">Service Account</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              <code className="bg-muted px-1 rounded">api-controller-hub-dev@guidewaycare-476802.iam.gserviceaccount.com</code> — Used by all Cloud Run services and jobs. Has permissions for BigQuery, Cloud Storage, Secret Manager, and Cloud Run job execution. In production, authentication uses the GCP metadata server (no key files).
            </p>
          </div>
        </div>
      </div>
    ),
  };

  return (
    <div className="prose-sm max-w-none">
      {content[section]}
    </div>
  );
}
