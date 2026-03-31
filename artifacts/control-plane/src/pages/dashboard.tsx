import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Link } from "wouter";
import {
  LayoutDashboard,
  Server,
  Plug,
  Play,
  Phone,
  Database,
  FileAudio,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRight,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface DashboardData {
  sourceSystems: { total: number; active: number };
  endpoints: { total: number; active: number };
  runs: {
    total: number;
    completed: number;
    failed: number;
    running: number;
    pending: number;
    thisWeek: number;
    recent: {
      runId: string;
      endpointId: string;
      status: string;
      apiCallCount: number | null;
      errorCount: number | null;
      createdTs: string;
    }[];
  };
  incontact: {
    staging: { pending: number; processing: number; downloaded: number; failed: number; total: number };
    recordingsCount: number;
  };
  gcpProject: string;
}

function StatCard({
  label,
  value,
  icon: Icon,
  href,
  color = "text-primary",
  sub,
}: {
  label: string;
  value: string | number;
  icon: any;
  href?: string;
  color?: string;
  sub?: string;
}) {
  const content = (
    <div className="border border-border rounded-lg p-4 bg-card hover:border-primary/30 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <Icon className={`w-5 h-5 ${color}`} />
        {href && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />}
      </div>
      <div className="text-2xl font-bold text-foreground">{typeof value === "number" ? value.toLocaleString() : value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
  if (href) return <Link href={href}>{content}</Link>;
  return content;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    COMPLETED: { bg: "bg-green-100", text: "text-green-700" },
    FAILED: { bg: "bg-red-100", text: "text-red-700" },
    RUNNING: { bg: "bg-blue-100", text: "text-blue-700" },
    PENDING: { bg: "bg-yellow-100", text: "text-yellow-700" },
    CANCELLED: { bg: "bg-gray-100", text: "text-gray-600" },
    REPLAYED: { bg: "bg-purple-100", text: "text-purple-700" },
  };
  const style = map[status] || { bg: "bg-gray-100", text: "text-gray-600" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${style.bg} ${style.text}`}>
      {status}
    </span>
  );
}

export default function DashboardPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => api.get<DashboardData>("/dashboard/summary"),
  });

  if (isLoading) {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border border-border rounded-lg p-4 bg-card">
              <Skeleton className="h-5 w-5 mb-2" />
              <Skeleton className="h-7 w-16 mb-1" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
        <div className="grid gap-6 md:grid-cols-2 mb-8">
          <div className="border border-border rounded-lg p-5 bg-card">
            <Skeleton className="h-5 w-40 mb-4" />
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          </div>
          <div className="border border-border rounded-lg p-5 bg-card">
            <Skeleton className="h-5 w-40 mb-4" />
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-destructive/30 rounded-lg p-6 bg-destructive/5 max-w-lg mx-auto mt-12">
        <AlertTriangle className="w-6 h-6 text-destructive mx-auto mb-2" />
        <p className="text-sm text-destructive text-center">Failed to load dashboard</p>
        <p className="text-xs text-muted-foreground text-center mt-1">{(error as Error).message}</p>
      </div>
    );
  }

  const d = data!;
  if (!d.incontact || !d.sourceSystems || !d.endpoints || !d.runs) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground mr-2" />
        <span className="text-muted-foreground">Loading dashboard...</span>
      </div>
    );
  }
  const stagingHealth = d.incontact.staging.failed > 0 ? "warning" : "healthy";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <LayoutDashboard className="w-6 h-6" />
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Overview of {d.gcpProject}
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Source Systems"
          value={d.sourceSystems.total}
          icon={Server}
          href="/source-systems"
          sub={`${d.sourceSystems.active} active`}
        />
        <StatCard
          label="Endpoints"
          value={d.endpoints.total}
          icon={Plug}
          href="/endpoints"
          sub={`${d.endpoints.active} active`}
        />
        <StatCard
          label="Total Runs"
          value={d.runs.total}
          icon={Play}
          href="/runs"
          sub={`${d.runs.thisWeek} this week`}
        />
        <StatCard
          label="Call Recordings"
          value={d.incontact.recordingsCount}
          icon={FileAudio}
          href="/recordings"
          color="text-indigo-500"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="border border-border rounded-lg p-4 bg-card">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Extraction Pipeline
          </h3>
          <div className="grid grid-cols-4 gap-3 text-center">
            <div>
              <div className="text-lg font-bold text-green-600">{d.runs.completed}</div>
              <div className="text-[10px] text-muted-foreground">Completed</div>
            </div>
            <div>
              <div className="text-lg font-bold text-blue-600">{d.runs.running}</div>
              <div className="text-[10px] text-muted-foreground">Running</div>
            </div>
            <div>
              <div className="text-lg font-bold text-yellow-600">{d.runs.pending}</div>
              <div className="text-[10px] text-muted-foreground">Pending</div>
            </div>
            <div>
              <div className="text-lg font-bold text-red-600">{d.runs.failed}</div>
              <div className="text-[10px] text-muted-foreground">Failed</div>
            </div>
          </div>
        </div>

        <div className="border border-border rounded-lg p-4 bg-card">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Phone className="w-4 h-4 text-indigo-500" />
            InContact Staging Queue
            {stagingHealth === "warning" && (
              <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
            )}
          </h3>
          <div className="grid grid-cols-4 gap-3 text-center">
            <div>
              <div className="text-lg font-bold text-green-600">{d.incontact.staging.downloaded.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">Downloaded</div>
            </div>
            <div>
              <div className="text-lg font-bold text-yellow-600">{d.incontact.staging.pending}</div>
              <div className="text-[10px] text-muted-foreground">Pending</div>
            </div>
            <div>
              <div className="text-lg font-bold text-blue-600">{d.incontact.staging.processing}</div>
              <div className="text-[10px] text-muted-foreground">Processing</div>
            </div>
            <div>
              <div className="text-lg font-bold text-red-600">{d.incontact.staging.failed}</div>
              <div className="text-[10px] text-muted-foreground">Failed</div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground text-right">
            {d.incontact.staging.total.toLocaleString()} total queued
          </div>
        </div>
      </div>

      {d.runs.recent.length > 0 && (
        <div className="border border-border rounded-lg bg-card">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              Recent Extraction Runs
            </h3>
            <Link href="/runs">
              <span className="text-xs text-primary hover:underline cursor-pointer">View all</span>
            </Link>
          </div>
          <div className="divide-y divide-border">
            {d.runs.recent.map((run) => (
              <Link key={run.runId} href={`/runs/${run.runId}`}>
                <div className="px-4 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={run.status} />
                    <span className="text-sm font-mono text-foreground">{run.endpointId}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    {run.apiCallCount != null && <span>{run.apiCallCount} calls</span>}
                    {(run.errorCount ?? 0) > 0 && (
                      <span className="text-red-500">{run.errorCount} errors</span>
                    )}
                    <span>{new Date(run.createdTs).toLocaleDateString()}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
