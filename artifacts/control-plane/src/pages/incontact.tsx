import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MetricsSkeleton, TableSkeleton } from "@/components/table-skeleton";

type Tab = "pipeline" | "staging" | "recordings" | "api-explorer";

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
  const [apiEndpoint, setApiEndpoint] = useState("/media-playback/v1/contacts");
  const [apiParams, setApiParams] = useState("");
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
  });

  const { data: queue, isLoading: queueLoading } = useQuery({
    queryKey: ["staging-queue"],
    queryFn: () => api.get<QueueItem[]>("/bq/staging-queue"),
    retry: false,
    enabled: tab === "staging",
  });

  const { data: recordings, isLoading: recLoading } = useQuery({
    queryKey: ["recordings"],
    queryFn: () => api.get<Recording[]>("/bq/recordings"),
    retry: false,
    enabled: tab === "recordings",
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

  const { data: endpointsData } = useQuery({
    queryKey: ["incontact-endpoints"],
    queryFn: () => api.get<string[]>("/incontact/endpoints"),
    enabled: tab === "api-explorer",
  });

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

  const runLoaderMutation = useMutation({
    mutationFn: () => api.post("/bq/run-loader"),
    onSuccess: () => {
      toast({ title: "Loader job started", description: "Call IDs are being loaded into the staging queue." });
    },
    onError: (err) => {
      toast({ title: "Loader job failed", description: (err as Error).message, variant: "destructive" });
    },
  });

  const runProcessorMutation = useMutation({
    mutationFn: () => api.post("/bq/run-job"),
    onSuccess: () => {
      toast({ title: "Processor job started", description: "Call recordings are being downloaded." });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["staging-summary"] });
      }, 5000);
    },
    onError: (err) => {
      toast({ title: "Processor job failed", description: (err as Error).message, variant: "destructive" });
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
      let parsedParams: Record<string, string> = {};
      if (apiParams.trim()) {
        try {
          parsedParams = JSON.parse(apiParams);
        } catch {
          const entries = apiParams.split("&").map((p) => p.split("="));
          parsedParams = Object.fromEntries(entries);
        }
      }
      return api.post<any>("/incontact/fetch", { endpoint: apiEndpoint, params: parsedParams });
    },
    onSuccess: (data) => {
      setFetchResult(data);
      toast({ title: "Request completed", description: `Status: ${(data as any).statusCode} ${(data as any).statusText}` });
    },
    onError: (err) => {
      toast({ title: "Request failed", description: (err as Error).message, variant: "destructive" });
    },
  });

  const monitorRows = monitorData?.data ?? [];
  const totalContacts = monitorRows.reduce((a, b) => a + b.contact_count, 0);

  const allQueueItems = queue ?? [];
  const stagingTotalPages = Math.max(1, Math.ceil(allQueueItems.length / pageSize));
  const stagingItems = allQueueItems.slice(stagingPage * pageSize, (stagingPage + 1) * pageSize);

  const allRecordings = recordings ?? [];
  const filteredRec = recSearch
    ? allRecordings.filter(
        (r) =>
          r.acd_contact_id?.includes(recSearch) ||
          r.contact_id?.includes(recSearch) ||
          r.agent_name?.toLowerCase().includes(recSearch.toLowerCase()) ||
          r.file_name?.includes(recSearch)
      )
    : allRecordings;
  const recTotalPages = Math.max(1, Math.ceil(filteredRec.length / pageSize));
  const pagedRec = filteredRec.slice(recPage * pageSize, (recPage + 1) * pageSize);

  const tabs: { id: Tab; label: string }[] = [
    { id: "pipeline", label: "Pipeline" },
    { id: "staging", label: "Staging Queue" },
    { id: "recordings", label: "Recordings" },
    { id: "api-explorer", label: "API Explorer" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Phone className="w-6 h-6" />
            InContact Pipeline
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

          {!monitorLoading && monitorRows.length > 0 && (
            <ContactCalendar rows={monitorRows} />
          )}

          <div className="flex items-center gap-2 py-2">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground font-medium">Pipeline Steps</span>
            <div className="flex-1 h-px bg-border" />
          </div>

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
                    {lastExtraction.windowStartTs ? new Date(lastExtraction.windowStartTs).toLocaleDateString() : "—"}
                    {" → "}
                    {lastExtraction.windowEndTs ? new Date(lastExtraction.windowEndTs).toLocaleDateString() : "—"}
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
            title="Queue Recordings"
            description="Load contact IDs into the staging queue for download processing"
            status={runLoaderMutation.isPending ? "running" : runLoaderMutation.isSuccess ? "success" : runLoaderMutation.isError ? "error" : "idle"}
            onRun={() => runLoaderMutation.mutate()}
            isRunning={runLoaderMutation.isPending}
          >
            <div className="flex items-center gap-4 text-sm">
              <div className="text-center">
                <div className="text-lg font-bold text-yellow-600">{summary?.pending ?? 0}</div>
                <div className="text-xs text-muted-foreground">Pending</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold">{summary?.total?.toLocaleString() ?? 0}</div>
                <div className="text-xs text-muted-foreground">Total Queued</div>
              </div>
              <div className="flex-1" />
              <div className="text-xs text-muted-foreground">
                Scheduled: Runs after Step 1 completes
              </div>
            </div>
          </PipelineStep>

          <div className="flex justify-center">
            <ArrowRight className="w-5 h-5 text-muted-foreground rotate-90" />
          </div>

          <PipelineStep
            number={3}
            title="Download Recordings"
            description="Process the staging queue — download audio files to GCS and metadata to BigQuery"
            status={runProcessorMutation.isPending ? "running" : runProcessorMutation.isSuccess ? "success" : runProcessorMutation.isError ? "error" : "idle"}
            onRun={() => runProcessorMutation.mutate()}
            isRunning={runProcessorMutation.isPending}
          >
            <div className="flex items-center gap-4 text-sm">
              <div className="text-center">
                <div className="text-lg font-bold text-green-600">{summary?.downloaded?.toLocaleString() ?? 0}</div>
                <div className="text-xs text-muted-foreground">Downloaded</div>
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
              <div className="flex-1" />
              <div className="text-xs text-muted-foreground">
                Scheduled: Runs after Step 2 completes
              </div>
            </div>
          </PipelineStep>
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
                  disabled={runProcessorMutation.isPending}
                  className="w-full inline-flex items-center gap-2 px-3 py-2 border border-border rounded-md text-sm hover:bg-muted disabled:opacity-50"
                >
                  {runProcessorMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Run Call Processor Job
                </button>
                <button
                  onClick={() => runLoaderMutation.mutate()}
                  disabled={runLoaderMutation.isPending}
                  className="w-full inline-flex items-center gap-2 px-3 py-2 border border-border rounded-md text-sm hover:bg-muted disabled:opacity-50"
                >
                  {runLoaderMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                  Run Call Loader Job
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
              {allRecordings.length.toLocaleString()} recordings stored in BigQuery
            </p>
            <div className="flex gap-2">
              <a
                href="/api/export/recordings?format=csv"
                download
                className="text-xs border border-border rounded px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-1.5"
              >
                <Download className="w-3 h-3" /> CSV
              </a>
            </div>
          </div>

          {!recLoading && allRecordings.length > 0 && (
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={recSearch}
                onChange={(e) => { setRecSearch(e.target.value); setRecPage(0); }}
                placeholder="Search by contact ID, agent name, or file name..."
                className="w-full pl-9 pr-3 py-2 border border-input rounded-md text-sm bg-background"
              />
            </div>
          )}

          {recLoading ? (
            <TableSkeleton rows={10} cols={8} />
          ) : filteredRec.length === 0 ? (
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
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Contact ID</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Agent</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Start</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Duration</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Direction</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Size</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">GCS</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Ingested</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRec.map((r) => (
                      <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                        <td className="px-4 py-3 font-mono text-xs">{r.acd_contact_id || r.contact_id}</td>
                        <td className="px-4 py-3 text-xs">{r.agent_name || r.agent_id || "—"}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{r.start_date ? new Date(r.start_date).toLocaleString() : "—"}</td>
                        <td className="px-4 py-3 text-xs">{formatDuration(r.duration_seconds)}</td>
                        <td className="px-4 py-3 text-xs">{r.direction || "—"}</td>
                        <td className="px-4 py-3 text-xs">{formatBytes(r.file_size_bytes)}</td>
                        <td className="px-4 py-3 text-xs font-mono text-muted-foreground truncate max-w-[200px]">{r.gcs_uri || "—"}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{r.ingestion_timestamp ? new Date(r.ingestion_timestamp).toLocaleString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {recTotalPages > 1 && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    Showing {recPage * pageSize + 1}–{Math.min((recPage + 1) * pageSize, filteredRec.length)} of {filteredRec.length}
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
              )}
            </>
          )}
        </div>
      )}

      {tab === "api-explorer" && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
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
                {authTestMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Phone className="w-3 h-3" />}
                Test Authentication
              </button>
            </div>
          </div>

          <div className="border border-border rounded-lg p-6 bg-card">
            <h3 className="text-sm font-semibold mb-4">API Explorer</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Endpoint</label>
                <select
                  value={apiEndpoint}
                  onChange={(e) => setApiEndpoint(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background"
                >
                  {(endpointsData ?? []).map((ep) => (
                    <option key={ep} value={ep}>{ep}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Parameters (JSON or key=value&key=value)</label>
                <input
                  value={apiParams}
                  onChange={(e) => setApiParams(e.target.value)}
                  placeholder='e.g. {"startDate": "2026-03-30", "endDate": "2026-03-30"}'
                  className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background"
                />
              </div>
              <button
                onClick={() => fetchApiMutation.mutate()}
                disabled={fetchApiMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {fetchApiMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
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
      )}
    </div>
  );
}
