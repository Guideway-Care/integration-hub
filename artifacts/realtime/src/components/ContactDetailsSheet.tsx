import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Phone,
  MessageSquare,
  Mail,
  FileText,
  Clock,
  User,
  Hash,
  ArrowDownLeft,
  ArrowUpRight,
  CircleCheck,
  CircleAlert,
  CircleDot,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface ContactDetailsSheetProps {
  contact: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function mediaLabel(c: any): string {
  if (c?.mediaTypeName) return String(c.mediaTypeName);
  if (c?.mediaName) return String(c.mediaName);
  const id = c?.mediaType ?? c?.mediaTypeId;
  if (typeof id === "number") return `Type ${id}`;
  if (typeof id === "string" && id) return id;
  return "Unknown";
}

function mediaIcon(c: any) {
  const label = mediaLabel(c).toLowerCase();
  if (label.includes("chat")) return MessageSquare;
  if (label.includes("email") || label.includes("mail")) return Mail;
  if (label.includes("voice") || label.includes("call") || label.includes("phone")) return Phone;
  return FileText;
}

function fmtAbs(v?: string): string {
  if (!v) return "—";
  try {
    return format(new Date(v), "MMM d, yyyy HH:mm:ss");
  } catch {
    return String(v);
  }
}

function fmtRel(v?: string): string {
  if (!v) return "";
  try {
    return formatDistanceToNow(new Date(v), { addSuffix: true });
  } catch {
    return "";
  }
}

function fmtDuration(start?: string): string {
  if (!start) return "—";
  try {
    const ms = Date.now() - new Date(start).getTime();
    if (ms < 0 || !isFinite(ms)) return "—";
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  } catch {
    return "—";
  }
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-2 border-b border-border/30 last:border-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm ${mono ? "font-mono text-xs" : ""} break-words`}>
        {value || <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

export function ContactDetailsSheet({ contact, open, onOpenChange }: ContactDetailsSheetProps) {
  if (!contact) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-xl flex flex-col p-0" />
      </Sheet>
    );
  }

  const Icon = mediaIcon(contact);
  const contactId = String(contact.contactId ?? contact.ContactId ?? "");
  const isOutbound = contact.isOutbound === true;
  const isInbound = contact.isOutbound === false;
  const masterId = String(
    contact.masterContactId ?? contact.MasterContactId ?? contact.masterId ?? contact.MasterId ?? ""
  );
  const startDate =
    contact.contactStartDate ||
    contact.ContactStartDate ||
    contact.startDate ||
    contact.StartDate ||
    contact.contactStart ||
    contact.contactStartTime ||
    contact.stateStartDate ||
    contact.lastUpdateTime ||
    contact.LastUpdateTime;
  const agentStart = contact.agentStartDate || contact.AgentStartDate;
  const handleStart =
    contact.contactStartHandleTime || contact.startHandleTime;
  const acwStart = contact.acwStartDate;
  const lastUpdate = contact.lastUpdateTime || contact.LastUpdateTime;

  const agentName =
    contact.agentName ||
    contact.AgentName ||
    (contact.firstName && contact.lastName ? `${contact.firstName} ${contact.lastName}` : "");
  const agentId = contact.agentId ?? contact.AgentId;
  const teamName = contact.teamName ?? contact.TeamName;
  const stationId = contact.stationId ?? contact.workstationName;
  const agentState = contact.agentStateName ?? contact.agentState;

  const skillName = contact.skillName ?? contact.SkillName;
  const skillId = contact.skillId ?? contact.SkillId;
  const campaignName = contact.campaignName ?? contact.CampaignName;
  const campaignId = contact.campaignId ?? contact.CampaignId;
  const pointOfContact =
    contact.pointOfContactName ?? contact.PointOfContactName ?? contact.pointOfContact ?? contact.PointOfContact;
  const dispositionId = contact.dispositionId ?? contact.DispositionId;

  const stateName = contact.stateName ?? contact.StateName;
  const stateCategory = contact.contactStateCategory ?? contact.ContactStateCategory;

  const fromAddr = contact.fromAddress || contact.FromAddress || contact.ani || contact.ANI;
  const toAddr = contact.toAddress || contact.ToAddress || contact.dnis || contact.DNIS;

  const isActive = contact.isActive !== false;
  const isACW = contact.isACW === true;
  const isHold = contact.isHold === true || contact.isOnHold === true || (contact.holdCount ?? 0) > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col p-0">
        <SheetHeader className="p-6 pb-4 border-b border-border/50">
          <SheetTitle className="flex items-center gap-2">
            <Icon className="w-5 h-5 text-primary" />
            {mediaLabel(contact)}
            {isOutbound && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/15 text-blue-700 border border-blue-500/30">
                <ArrowUpRight className="w-3 h-3" /> Outbound
              </span>
            )}
            {isInbound && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/15 text-emerald-700 border border-emerald-500/30">
                <ArrowDownLeft className="w-3 h-3" /> Inbound
              </span>
            )}
          </SheetTitle>
          <SheetDescription className="text-xs font-mono break-all">
            Contact ID: {contactId || "(none)"}
          </SheetDescription>

          <div className="flex flex-wrap gap-1.5 pt-2">
            {stateName && (
              <Badge variant="outline" className="text-[10px] gap-1 bg-blue-500/10 text-blue-700 border-blue-500/30">
                <CircleDot className="w-3 h-3" /> {String(stateName)}
              </Badge>
            )}
            {stateCategory && (
              <Badge variant="outline" className="text-[10px] gap-1 bg-muted text-muted-foreground">
                {String(stateCategory)}
              </Badge>
            )}
            {isActive ? (
              <Badge variant="outline" className="text-[10px] gap-1 bg-emerald-500/10 text-emerald-700 border-emerald-500/30">
                <CircleCheck className="w-3 h-3" /> Active
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] gap-1 bg-muted text-muted-foreground">
                <CircleAlert className="w-3 h-3" /> Inactive
              </Badge>
            )}
            {isACW && (
              <Badge variant="outline" className="text-[10px] gap-1 bg-amber-500/10 text-amber-700 border-amber-500/30">
                <CircleDot className="w-3 h-3" /> ACW
              </Badge>
            )}
            {isHold && (
              <Badge variant="outline" className="text-[10px] gap-1 bg-orange-500/10 text-orange-700 border-orange-500/30">
                <CircleDot className="w-3 h-3" /> On hold
              </Badge>
            )}
            {agentState && (
              <Badge variant="secondary" className="text-[10px]">
                {String(agentState)}
              </Badge>
            )}
          </div>
        </SheetHeader>

        <Tabs defaultValue="overview" className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 pt-3 border-b border-border/50">
            <TabsList className="h-9">
              <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
              <TabsTrigger value="raw" className="text-xs">Raw JSON</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview" className="flex-1 overflow-y-auto p-6 space-y-5 m-0">
            <section>
              <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Timing
              </h3>
              <Row
                label="Started"
                value={
                  startDate ? (
                    <div>
                      <div>{fmtAbs(startDate)}</div>
                      <div className="text-xs text-muted-foreground">{fmtRel(startDate)}</div>
                    </div>
                  ) : null
                }
              />
              <Row label="Duration" value={fmtDuration(startDate)} />
              {agentStart && (
                <Row
                  label="Agent picked up"
                  value={
                    <div>
                      <div>{fmtAbs(agentStart)}</div>
                      <div className="text-xs text-muted-foreground">{fmtRel(agentStart)}</div>
                    </div>
                  }
                />
              )}
              {handleStart && (
                <Row
                  label="Handled at"
                  value={
                    <div>
                      <div>{fmtAbs(handleStart)}</div>
                      <div className="text-xs text-muted-foreground">{fmtRel(handleStart)}</div>
                    </div>
                  }
                />
              )}
              {lastUpdate && (
                <Row
                  label="Last update"
                  value={
                    <div>
                      <div>{fmtAbs(lastUpdate)}</div>
                      <div className="text-xs text-muted-foreground">{fmtRel(lastUpdate)}</div>
                    </div>
                  }
                />
              )}
              {acwStart && (
                <Row
                  label="ACW started"
                  value={
                    <div>
                      <div>{fmtAbs(acwStart)}</div>
                      <div className="text-xs text-muted-foreground">{fmtRel(acwStart)}</div>
                    </div>
                  }
                />
              )}
            </section>

            <Separator />

            <section>
              <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" /> Agent
              </h3>
              <Row label="Name" value={agentName} />
              <Row label="Agent ID" value={agentId ? String(agentId) : ""} mono />
              <Row label="Team" value={teamName ? String(teamName) : ""} />
              <Row label="Station" value={stationId ? String(stationId) : ""} />
            </section>

            <Separator />

            <section>
              <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5" /> Routing
              </h3>
              <Row label="Skill" value={skillName ? String(skillName) : ""} />
              <Row label="Skill ID" value={skillId ? String(skillId) : ""} mono />
              <Row label="Campaign" value={campaignName ? String(campaignName) : ""} />
              <Row label="Campaign ID" value={campaignId ? String(campaignId) : ""} mono />
              <Row label="Point of contact" value={pointOfContact ? String(pointOfContact) : ""} />
              <Row label="Disposition" value={dispositionId ? String(dispositionId) : ""} mono />
            </section>

            <Separator />

            <section>
              <h3 className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" /> Endpoints
              </h3>
              <Row label="From" value={fromAddr ? String(fromAddr) : ""} mono />
              <Row label="To" value={toAddr ? String(toAddr) : ""} mono />
              <Row label="Master ID" value={masterId} mono />
            </section>
          </TabsContent>

          <TabsContent value="raw" className="flex-1 overflow-y-auto p-0 m-0">
            <pre className="text-[11px] font-mono p-4 bg-muted/30 whitespace-pre-wrap break-words">
              {JSON.stringify(contact, null, 2)}
            </pre>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
