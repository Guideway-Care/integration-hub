import { ExternalLink, Activity, Users, Phone, Layers, Network, Headphones, BarChart3, Radio, Clock } from "lucide-react";

type Endpoint = {
  method: "GET" | "POST";
  path: string;
  summary: string;
  notes?: string;
};

type Group = {
  title: string;
  icon: typeof Activity;
  description: string;
  endpoints: Endpoint[];
};

const BASE = "https://api-na1.niceincontact.com/incontactapi/services/v30.0";

const groups: Group[] = [
  {
    title: "Agent availability & state",
    icon: Users,
    description:
      "Who is logged in, what state they're in (Available / Unavailable / Working), and how long they've been there. Core signal for staffing visibility.",
    endpoints: [
      {
        method: "GET",
        path: "/agents/states",
        summary: "Current state for every agent (Available, Unavailable, Working, LoggedOut + reason code).",
        notes: "Polled frequently in the live monitor. Single most useful endpoint for staffing.",
      },
      {
        method: "GET",
        path: "/agents/{agentId}/state-history",
        summary: "Timeline of state changes for one agent. Useful for shift audits and AHT analysis.",
      },
      {
        method: "GET",
        path: "/agents/unavailable-codes",
        summary: "List of configured unavailable reason codes (Lunch, Training, Coaching, …) so you can label state codes.",
      },
      {
        method: "GET",
        path: "/agents/performance-summary",
        summary: "Per-agent today-so-far metrics: contacts handled, ACW time, occupancy, avg handle time.",
      },
      {
        method: "POST",
        path: "/agents/{agentId}/logout",
        summary: "Force-logout an agent. Supervisor action; rarely used from a monitor.",
      },
    ],
  },
  {
    title: "Active contacts & who-answered",
    icon: Phone,
    description:
      "Live calls/chats in progress, queue position, which agent picked up, and how long they've been on the contact.",
    endpoints: [
      {
        method: "GET",
        path: "/contacts/active",
        summary: "All in-flight contacts (calls, chats, emails, voicemails) with state, skill, agent, ANI, start time.",
        notes: "Drives the Active Contacts table. `agentId` populated once the contact is connected — that's your 'who answered' field.",
      },
      {
        method: "GET",
        path: "/contacts/{contactId}",
        summary: "Full detail for one contact incl. routing history, hold events, transfers, disposition.",
      },
      {
        method: "GET",
        path: "/contacts/completed",
        summary: "Contacts that ended in the last N minutes. Use to detect drops and short calls in near-real-time.",
      },
      {
        method: "GET",
        path: "/contacts/{contactId}/recordings",
        summary: "Recording metadata (URL, duration) for a finished call.",
      },
    ],
  },
  {
    title: "Skills & queues",
    icon: Layers,
    description:
      "Queue depth, longest wait, service level — the supervisor's 'are we keeping up?' view.",
    endpoints: [
      {
        method: "GET",
        path: "/skills/activity",
        summary: "Per-skill live counters: queued, active, longest wait, agents staffed, agents available.",
        notes: "Best single endpoint for an SLA / queue-health dashboard.",
      },
      {
        method: "GET",
        path: "/skills",
        summary: "Skill catalog (id → name, media type, routing config). Cache; rarely changes.",
      },
      {
        method: "GET",
        path: "/skills/{skillId}/agents",
        summary: "Agents staffed to a skill plus their current state. Drill-down from a hot queue.",
      },
      {
        method: "GET",
        path: "/skills/{skillId}/contacts",
        summary: "Contacts currently in or routed to this skill.",
      },
    ],
  },
  {
    title: "Teams",
    icon: Network,
    description: "Organizational grouping of agents. Use to scope monitors to a supervisor's span of control.",
    endpoints: [
      {
        method: "GET",
        path: "/teams",
        summary: "Team catalog (id → name).",
      },
      {
        method: "GET",
        path: "/teams/{teamId}/agents",
        summary: "Agents on a team with current state — same shape as agent states, filtered.",
      },
      {
        method: "GET",
        path: "/teams/{teamId}/performance",
        summary: "Team-level rollup of today's performance metrics.",
      },
    ],
  },
  {
    title: "Campaigns & dialer",
    icon: Radio,
    description: "Outbound campaign progress, pacing, and connect rates.",
    endpoints: [
      {
        method: "GET",
        path: "/campaigns",
        summary: "Campaign catalog incl. dialing mode (Preview / Progressive / Predictive).",
      },
      {
        method: "GET",
        path: "/campaigns/{campaignId}/performance",
        summary: "Live campaign stats: records dialed, contacts connected, abandon rate, agents staffed.",
      },
      {
        method: "GET",
        path: "/campaigns/{campaignId}/contacts",
        summary: "Contacts currently being dialed/handled under this campaign.",
      },
    ],
  },
  {
    title: "Real-time data feeds (push)",
    icon: Activity,
    description:
      "Subscribe once and receive deltas instead of polling. Lower latency, fewer API calls. Recommended for any production live dashboard.",
    endpoints: [
      {
        method: "POST",
        path: "/data-extraction/subscriptions",
        summary: "Create a subscription for events (agent-state, contact-state, skill-activity).",
        notes: "Returns a feed URL you long-poll or stream from.",
      },
      {
        method: "GET",
        path: "/data-extraction/subscriptions/{id}/events",
        summary: "Drain the next batch of events for an active subscription.",
      },
      {
        method: "POST",
        path: "/data-extraction/subscriptions/{id}/refresh",
        summary: "Keep a subscription alive past its idle timeout.",
      },
    ],
  },
  {
    title: "Supervisor actions",
    icon: Headphones,
    description: "Live-call interventions from a monitor UI — listen-in, whisper, barge, coach.",
    endpoints: [
      {
        method: "POST",
        path: "/agents/{agentId}/monitor",
        summary: "Silent listen-in on an agent's active call.",
      },
      {
        method: "POST",
        path: "/agents/{agentId}/coach",
        summary: "Whisper mode — supervisor heard only by the agent.",
      },
      {
        method: "POST",
        path: "/agents/{agentId}/barge-in",
        summary: "Three-way conference into the agent's live call.",
      },
    ],
  },
  {
    title: "Historical & reporting (context only)",
    icon: BarChart3,
    description:
      "Not strictly real-time, but useful alongside a live dashboard to answer 'is this normal?' Pull on a slower cadence.",
    endpoints: [
      {
        method: "GET",
        path: "/contacts/historical",
        summary: "Completed contacts with full disposition. Paginated; use date ranges.",
      },
      {
        method: "GET",
        path: "/reports/agent-performance",
        summary: "Aggregated agent performance over a period.",
      },
      {
        method: "GET",
        path: "/reports/skill-performance",
        summary: "Aggregated skill / queue performance over a period.",
      },
    ],
  },
];

function MethodBadge({ method }: { method: Endpoint["method"] }) {
  const cls =
    method === "GET"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
      : "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${cls}`}>
      {method}
    </span>
  );
}

export function IncontactApi() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">InContact API Reference</h1>
        <p className="text-sm text-muted-foreground mt-1">
          NICE CXone REST endpoints relevant to real-time monitoring — agent availability, who
          answered a call, queue health, and supervisor intervention. Base URL:{" "}
          <code className="text-xs px-1.5 py-0.5 rounded bg-muted">{BASE}</code>
        </p>
        <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            v30.0
          </span>
          <a
            href="https://developer.niceincontact.com/API"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            Official docs <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {groups.map((g) => {
          const Icon = g.icon;
          return (
            <section
              key={g.title}
              className="rounded-lg border border-border bg-card overflow-hidden"
            >
              <header className="px-5 py-3 border-b border-border bg-muted/40 flex items-start gap-3">
                <div className="w-8 h-8 rounded bg-primary/15 text-primary flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">{g.title}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">{g.description}</p>
                </div>
              </header>
              <ul className="divide-y divide-border/50">
                {g.endpoints.map((ep) => (
                  <li key={ep.method + ep.path} className="px-5 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <MethodBadge method={ep.method} />
                      <code className="text-xs font-mono text-foreground break-all">{ep.path}</code>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">{ep.summary}</p>
                    {ep.notes && (
                      <p className="text-xs mt-1 text-amber-700 dark:text-amber-400">
                        <span className="font-semibold">Note: </span>
                        {ep.notes}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
