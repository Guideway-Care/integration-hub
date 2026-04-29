import { useNiceQuery } from "@/hooks/use-nice-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Search, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { AnimatedValue } from "@/components/AnimatedValue";
import { formatDistanceToNow } from "date-fns";

export default function Agents() {
  const { data: response, isLoading, isError, error, isFetching } = useNiceQuery("agents");
  const [search, setSearch] = useState("");

  const agents = Array.isArray(response?.data) ? response.data : [];
  
  const filteredAgents = agents.filter(a => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      (a.agentName || "").toLowerCase().includes(term) ||
      (a.skillName || "").toLowerCase().includes(term) ||
      (a.agentStateName || "").toLowerCase().includes(term)
    );
  });

  const getStateColor = (state: string) => {
    switch (state) {
      case "Working": return "bg-primary text-primary-foreground";
      case "Available": return "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";
      case "Unavailable": return "bg-amber-500/20 text-amber-400 border border-amber-500/30";
      case "Logged Out": return "bg-muted text-muted-foreground";
      default: return "bg-secondary text-secondary-foreground";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Agent Telemetry</h2>
          <p className="text-sm text-muted-foreground">Live state for all configured agents</p>
        </div>
        {isFetching && <RefreshCw className="w-4 h-4 animate-spin text-primary" />}
      </div>

      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>API Error</AlertTitle>
          <AlertDescription>{error?.message}</AlertDescription>
        </Alert>
      )}

      <Card className="bg-card border-border/50">
        <CardHeader className="pb-3 border-b border-border/50 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg font-medium">Active Roster</CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search agents, skills, states..."
              className="pl-9 bg-muted border-border/50 h-9 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-muted-foreground uppercase bg-muted border-b border-border/50">
                <tr>
                  <th className="px-6 py-3 font-medium">Agent</th>
                  <th className="px-6 py-3 font-medium">State</th>
                  <th className="px-6 py-3 font-medium">Skill</th>
                  <th className="px-6 py-3 font-medium">Team</th>
                  <th className="px-6 py-3 font-medium">Time in State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {isLoading && agents.length === 0 ? (
                  <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">Loading roster...</td></tr>
                ) : filteredAgents.length === 0 ? (
                  <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">No agents found</td></tr>
                ) : (
                  filteredAgents.map((agent: any) => {
                    const timeInState = agent.startDate 
                      ? formatDistanceToNow(new Date(agent.startDate), { addSuffix: false })
                      : "---";
                      
                    return (
                      <tr key={agent.agentId || Math.random()} className="hover:bg-white/5 transition-colors">
                        <td className="px-6 py-3 font-medium text-foreground">
                          {agent.agentName || `${agent.firstName} ${agent.lastName}` || "Unknown"}
                          <div className="text-xs text-muted-foreground font-mono mt-0.5">ID: {agent.agentId}</div>
                        </td>
                        <td className="px-6 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getStateColor(agent.agentStateName)}`}>
                            {agent.agentStateName || "Unknown"}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-muted-foreground">
                          {agent.skillName || "---"}
                        </td>
                        <td className="px-6 py-3 text-muted-foreground">
                          {agent.teamName || "---"}
                        </td>
                        <td className="px-6 py-3 font-mono text-muted-foreground">
                          <AnimatedValue value={timeInState} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
