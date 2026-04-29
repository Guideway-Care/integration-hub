import { useAllNiceData, useNiceQuery } from "@/hooks/use-nice-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { format } from "date-fns";
import { AnimatedValue } from "@/components/AnimatedValue";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { agents, skills, teams, contacts } = useAllNiceData();

  const isError = agents.isError || skills.isError || teams.isError || contacts.isError;
  const isFetching = agents.isFetching || skills.isFetching || teams.isFetching || contacts.isFetching;

  // Safely extract counts
  const agentsList = Array.isArray(agents.data?.data) ? agents.data.data : [];
  const onlineAgents = agentsList.filter(a => a.agentStateName !== "Logged Out").length;
  const workingAgents = agentsList.filter(a => a.agentStateName === "Working").length;
  
  const contactsList = Array.isArray(contacts.data?.data) ? contacts.data.data : [];
  const activeContacts = contactsList.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">System Overview</h2>
          <p className="text-sm text-muted-foreground">Real-time aggregate telemetry across CXone</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isFetching && <RefreshCw className="w-3 h-3 animate-spin text-primary" />}
          <span>
            Last sync: {agents.data?.timestamp ? format(new Date(agents.data.timestamp), "HH:mm:ss") : "---"}
          </span>
        </div>
      </div>

      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>API Error</AlertTitle>
          <AlertDescription>
            {agents.error?.message || skills.error?.message || teams.error?.message || contacts.error?.message || "Failed to fetch data"}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard 
          title="Online Agents" 
          value={agents.isLoading ? null : onlineAgents} 
          trend="Total logged in"
        />
        <KpiCard 
          title="Working Agents" 
          value={agents.isLoading ? null : workingAgents} 
          trend="Currently on calls"
          highlight={workingAgents > 0}
        />
        <KpiCard 
          title="Active Contacts" 
          value={contacts.isLoading ? null : activeContacts} 
          trend="Calls in progress"
          highlight={activeContacts > 0}
        />
        <KpiCard 
          title="Skills Active" 
          value={skills.isLoading ? null : (Array.isArray(skills.data?.data) ? skills.data.data.length : 0)} 
          trend="Configured queues"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card">
          <CardHeader className="pb-2 border-b border-border/50">
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Agent States Distribution</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {agents.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
            ) : (
              <AgentStatesChart agents={agentsList} />
            )}
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader className="pb-2 border-b border-border/50">
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Raw Telemetry Snippet</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 p-0">
            <div className="bg-black/50 p-4 rounded-md overflow-auto text-xs font-mono text-emerald-400 h-64">
              {agents.data ? JSON.stringify(agents.data.data.slice(0, 3), null, 2) : "Waiting for telemetry..."}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({ title, value, trend, highlight = false }: { title: string; value: number | null; trend: string; highlight?: boolean }) {
  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardContent className="p-6">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <div className={`mt-2 flex items-baseline gap-2 ${highlight ? "text-primary" : ""}`}>
          {value === null ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <span className="text-4xl font-bold tracking-tight font-mono">
              <AnimatedValue value={value} />
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{trend}</p>
      </CardContent>
    </Card>
  );
}

function AgentStatesChart({ agents }: { agents: any[] }) {
  const states: Record<string, number> = agents.reduce((acc: Record<string, number>, agent) => {
    const state = agent.agentStateName || "Unknown";
    acc[state] = (acc[state] || 0) + 1;
    return acc;
  }, {});

  const entries: [string, number][] = Object.entries(states);

  return (
    <div className="space-y-4">
      {entries.sort((a, b) => b[1] - a[1]).map(([state, count]) => (
        <div key={state} className="flex items-center justify-between">
          <span className="text-sm">{state}</span>
          <div className="flex items-center gap-3 w-1/2">
            <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary transition-all duration-500"
                style={{ width: `${(count / agents.length) * 100}%` }}
              />
            </div>
            <span className="text-sm font-mono w-8 text-right"><AnimatedValue value={count} /></span>
          </div>
        </div>
      ))}
      {Object.keys(states).length === 0 && <div className="text-sm text-muted-foreground py-4 text-center">No agents online</div>}
    </div>
  );
}
