import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { MessageSquare, Phone, Mail, FileText, Clock, Filter, X, ArrowDownLeft, ArrowUpRight, ArrowUp, ArrowDown, ChevronsUpDown, Check } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ChatTranscriptSheet } from "./ChatTranscriptSheet";
import { ContactDetailsSheet } from "./ContactDetailsSheet";
import { formatDistanceToNow } from "date-fns";

interface ContactsTableProps {
  contacts: any[];
}

function mediaLabel(c: any): string {
  if (c?.mediaTypeName) return String(c.mediaTypeName);
  if (c?.mediaName) return String(c.mediaName);
  const id = c?.mediaType ?? c?.mediaTypeId;
  if (typeof id === "number") return `Type ${id}`;
  if (typeof id === "string" && id) return id;
  return "Unknown";
}

function isChatContact(c: any): boolean {
  return mediaLabel(c).toLowerCase().includes("chat");
}

function mediaIcon(c: any) {
  const label = mediaLabel(c).toLowerCase();
  if (label.includes("chat")) return MessageSquare;
  if (label.includes("email") || label.includes("mail")) return Mail;
  if (label.includes("voice") || label.includes("call") || label.includes("phone")) return Phone;
  return FileText;
}

function skillLabel(c: any): string {
  return String(c?.skillName || c?.SkillName || c?.skillId || "—");
}

function campaignLabel(c: any): string {
  return String(c?.campaignName || c?.CampaignName || c?.campaignId || "—");
}

function agentLabel(c: any): string {
  if (c?.agentName) return String(c.agentName);
  if (c?.AgentName) return String(c.AgentName);
  if (c?.firstName && c?.lastName) return `${c.firstName} ${c.lastName}`;
  if (c?.agentId) return String(c.agentId);
  return "—";
}

type SortKey =
  | "type"
  | "direction"
  | "contactId"
  | "from"
  | "skill"
  | "agent"
  | "state"
  | "started";

type SortDir = "asc" | "desc";

function fromLabel(c: any): string {
  return String(c?.fromAddress || c?.FromAddress || c?.ani || c?.ANI || "");
}

function stateLabel(c: any): string {
  return String(c?.stateName || c?.contactStateCategory || "");
}

function startedTs(c: any): number {
  const v = pickStarted(c);
  if (!v) return 0;
  const t = new Date(v).getTime();
  return isFinite(t) ? t : 0;
}

function sortValue(c: any, key: SortKey): string | number {
  switch (key) {
    case "type": return mediaLabel(c).toLowerCase();
    case "direction": return direction(c);
    case "contactId": return Number(c?.contactId ?? c?.ContactId ?? 0) || 0;
    case "from": return fromLabel(c).toLowerCase();
    case "skill": return skillLabel(c).toLowerCase();
    case "agent": return agentLabel(c).toLowerCase();
    case "state": return stateLabel(c).toLowerCase();
    case "started": return startedTs(c);
  }
}

function compareSort(a: any, b: any, key: SortKey, dir: SortDir): number {
  const av = sortValue(a, key);
  const bv = sortValue(b, key);
  let cmp = 0;
  if (typeof av === "number" && typeof bv === "number") {
    cmp = av - bv;
  } else {
    cmp = String(av).localeCompare(String(bv));
  }
  return dir === "asc" ? cmp : -cmp;
}

type Direction = "Inbound" | "Outbound" | "Unknown";

function direction(c: any): Direction {
  if (c?.isOutbound === true) return "Outbound";
  if (c?.isOutbound === false) return "Inbound";
  if (typeof c?.direction === "string") {
    const d = c.direction.toLowerCase();
    if (d.includes("out")) return "Outbound";
    if (d.includes("in")) return "Inbound";
  }
  return "Unknown";
}

const ALL = "__all__";

const STARTED_FIELDS = [
  "contactStartDate",
  "ContactStartDate",
  "startDate",
  "StartDate",
  "contactStart",
  "contactStartTime",
  "contactStartHandleTime",
  "startHandleTime",
  "agentStartDate",
  "stateStartDate",
  "lastUpdateTime",
  "LastUpdateTime",
  "acwStartDate",
] as const;

function pickStarted(c: any): string | undefined {
  for (const k of STARTED_FIELDS) {
    const v = c?.[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

function fmtTime(v?: string): string {
  if (!v) return "—";
  try {
    return formatDistanceToNow(new Date(v), { addSuffix: true });
  } catch {
    return v;
  }
}

export function ContactsTable({ contacts }: ContactsTableProps) {
  const [openContactId, setOpenContactId] = useState<string | null>(null);
  const [openLabel, setOpenLabel] = useState<string>("");
  const [detailsContact, setDetailsContact] = useState<any | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [directionFilter, setDirectionFilter] = useState<string>(ALL);
  const [campaignFilter, setCampaignFilter] = useState<string>(ALL);
  const [skillFilter, setSkillFilter] = useState<string>(ALL);
  const [agentFilter, setAgentFilter] = useState<string>(ALL);
  const [activeOnly, setActiveOnly] = useState<boolean>(true);
  const [sortKey, setSortKey] = useState<SortKey>("started");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const validContacts = useMemo(
    () => contacts.filter((c) => c && typeof c === "object"),
    [contacts]
  );

  function isReallyActive(c: any): boolean {
    if (c?.isActive === false) return false;
    const cat = String(c?.contactStateCategory || "").toLowerCase();
    if (cat === "post agent" || cat === "terminated" || cat === "finished") return false;
    const state = String(c?.stateName || "").toLowerCase();
    if (state === "transfer" || state === "disconnected" || state === "terminated") return false;
    const label = mediaLabel(c).toLowerCase();
    if (label.includes("voice mail") || label.includes("voicemail")) return false;
    return true;
  }

  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    validContacts.forEach((c) => set.add(mediaLabel(c)));
    return Array.from(set).sort();
  }, [validContacts]);

  const campaignOptions = useMemo(() => {
    const set = new Set<string>();
    validContacts.forEach((c) => set.add(campaignLabel(c)));
    return Array.from(set).sort();
  }, [validContacts]);

  const skillOptions = useMemo(() => {
    const set = new Set<string>();
    validContacts.forEach((c) => set.add(skillLabel(c)));
    return Array.from(set).sort();
  }, [validContacts]);

  const agentOptions = useMemo(() => {
    const set = new Set<string>();
    validContacts.forEach((c) => set.add(agentLabel(c)));
    return Array.from(set).sort();
  }, [validContacts]);

  const filtered = useMemo(() => {
    const out = validContacts.filter((c) => {
      if (activeOnly && !isReallyActive(c)) return false;
      if (typeFilter !== ALL && mediaLabel(c) !== typeFilter) return false;
      if (directionFilter !== ALL && direction(c) !== directionFilter) return false;
      if (campaignFilter !== ALL && campaignLabel(c) !== campaignFilter) return false;
      if (skillFilter !== ALL && skillLabel(c) !== skillFilter) return false;
      if (agentFilter !== ALL && agentLabel(c) !== agentFilter) return false;
      return true;
    });
    return [...out].sort((a, b) => compareSort(a, b, sortKey, sortDir));
  }, [validContacts, activeOnly, typeFilter, directionFilter, campaignFilter, skillFilter, agentFilter, sortKey, sortDir]);

  const anyFilterActive =
    typeFilter !== ALL ||
    directionFilter !== ALL ||
    campaignFilter !== ALL ||
    skillFilter !== ALL ||
    agentFilter !== ALL;

  function clearFilters() {
    setTypeFilter(ALL);
    setDirectionFilter(ALL);
    setCampaignFilter(ALL);
    setSkillFilter(ALL);
    setAgentFilter(ALL);
  }

  if (!contacts.length) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        No active contacts right now.
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-border/50 bg-muted/30">
        <div className="flex items-center gap-2 pr-2 mr-1 border-r border-border/50">
          <Switch
            id="active-only"
            checked={activeOnly}
            onCheckedChange={setActiveOnly}
          />
          <Label htmlFor="active-only" className="text-xs cursor-pointer select-none">
            Active only
          </Label>
        </div>
        <Filter className="w-4 h-4 text-muted-foreground" />
        <FilterSelect
          label="Type"
          value={typeFilter}
          onChange={setTypeFilter}
          options={typeOptions}
        />
        <FilterSelect
          label="Direction"
          value={directionFilter}
          onChange={setDirectionFilter}
          options={["Inbound", "Outbound", "Unknown"]}
        />
        <FilterSelect
          label="Campaign"
          value={campaignFilter}
          onChange={setCampaignFilter}
          options={campaignOptions}
        />
        <FilterSelect
          label="Skill"
          value={skillFilter}
          onChange={setSkillFilter}
          options={skillOptions}
        />
        <FilterSelect
          label="Agent"
          value={agentFilter}
          onChange={setAgentFilter}
          options={agentOptions}
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Showing <span className="font-medium text-foreground">{filtered.length}</span> of{" "}
            {validContacts.length}
          </span>
          {anyFilterActive && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={clearFilters}
            >
              <X className="w-3 h-3" />
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-muted-foreground uppercase bg-muted border-b border-border/50">
            <tr>
              <SortHeader label="Type" sortKey="type" current={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHeader label="Direction" sortKey="direction" current={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHeader label="Contact ID" sortKey="contactId" current={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHeader label="From" sortKey="from" current={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHeader label="Skill" sortKey="skill" current={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHeader label="Agent" sortKey="agent" current={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHeader label="State" sortKey="state" current={sortKey} dir={sortDir} onClick={toggleSort} />
              <SortHeader label="Started" sortKey="started" current={sortKey} dir={sortDir} onClick={toggleSort} />
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No contacts match the current filters.
                </td>
              </tr>
            )}
            {filtered.map((c, i) => {
              if (!c || typeof c !== "object") return null;
              const Icon = mediaIcon(c);
              const isChat = isChatContact(c);
              const contactId = String(c.contactId ?? c.ContactId ?? "");
              const from =
                c.fromAddress ||
                c.FromAddress ||
                c.ani ||
                c.ANI ||
                "—";
              const skill = c.skillName || c.SkillName || c.skillId || "—";
              const agent =
                c.agentName ||
                c.AgentName ||
                (c.firstName && c.lastName ? `${c.firstName} ${c.lastName}` : null) ||
                c.agentId ||
                "—";
              const started = pickStarted(c);
              const label = `${mediaLabel(c)} · ${contactId || "(no id)"}`;

              return (
                <tr
                  key={contactId || i}
                  className="hover:bg-muted/40 transition-colors cursor-pointer"
                  onClick={() => setDetailsContact(c)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                      <span className="text-xs">{mediaLabel(c)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <DirectionBadge value={direction(c)} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{contactId || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{String(from)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{String(skill)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{String(agent)}</td>
                  <td className="px-4 py-3">
                    <StateBadge contact={c} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3" />
                      <span className="text-xs">{fmtTime(started)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    {isChat && contactId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setOpenContactId(contactId);
                          setOpenLabel(label);
                        }}
                      >
                        View transcript
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setDetailsContact(c)}
                      >
                        Details
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ChatTranscriptSheet
        contactId={openContactId}
        contactLabel={openLabel}
        open={!!openContactId}
        onOpenChange={(o) => {
          if (!o) {
            setOpenContactId(null);
            setOpenLabel("");
          }
        }}
      />

      <ContactDetailsSheet
        contact={detailsContact}
        open={!!detailsContact}
        onOpenChange={(o) => {
          if (!o) setDetailsContact(null);
        }}
      />
    </>
  );
}

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}

interface SortHeaderProps {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
}

function SortHeader({ label, sortKey, current, dir, onClick }: SortHeaderProps) {
  const isActive = current === sortKey;
  const Icon = isActive ? (dir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <th
      className="px-4 py-3 font-medium cursor-pointer select-none hover:text-foreground transition-colors"
      onClick={() => onClick(sortKey)}
    >
      <div className="flex items-center gap-1">
        {label}
        <Icon
          className={`w-3 h-3 ${isActive ? "text-foreground" : "text-muted-foreground/40"}`}
        />
      </div>
    </th>
  );
}

function StateBadge({ contact }: { contact: any }) {
  const state = String(contact?.stateName || "").trim();
  const cat = String(contact?.contactStateCategory || "").trim();
  const display = state || cat || "—";
  if (!state && !cat) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const lc = (state || cat).toLowerCase();
  let cls = "bg-muted text-muted-foreground";
  if (lc.includes("active") || lc.includes("connected") || lc.includes("talking")) {
    cls = "bg-emerald-500/15 text-emerald-700 border-emerald-500/30";
  } else if (lc.includes("hold")) {
    cls = "bg-orange-500/15 text-orange-700 border-orange-500/30";
  } else if (lc.includes("transfer") || lc.includes("post agent")) {
    cls = "bg-amber-500/15 text-amber-700 border-amber-500/30";
  } else if (lc.includes("pre agent") || lc.includes("queue") || lc.includes("ringing")) {
    cls = "bg-blue-500/15 text-blue-700 border-blue-500/30";
  } else if (lc.includes("acw") || lc.includes("wrap")) {
    cls = "bg-purple-500/15 text-purple-700 border-purple-500/30";
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${cls}`}>
      {display}
    </span>
  );
}

function DirectionBadge({ value }: { value: Direction }) {
  if (value === "Inbound") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/15 text-emerald-700 border border-emerald-500/30">
        <ArrowDownLeft className="w-3 h-3" />
        Inbound
      </span>
    );
  }
  if (value === "Outbound") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/15 text-blue-700 border border-blue-500/30">
        <ArrowUpRight className="w-3 h-3" />
        Outbound
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-muted text-muted-foreground">
      —
    </span>
  );
}

function FilterSelect({ label, value, onChange, options }: FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const allLabel = `All ${label.toLowerCase()}s`;
  const display = value === ALL ? allLabel : value;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}:</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            className="h-7 text-xs w-[160px] bg-background border border-input rounded-md px-2.5 inline-flex items-center justify-between gap-1 hover:bg-accent/40 transition-colors"
          >
            <span className="truncate text-left">{display}</span>
            <ChevronsUpDown className="w-3 h-3 opacity-50 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[220px] p-0" align="start">
          <Command>
            <CommandInput placeholder={`Search ${label.toLowerCase()}…`} className="h-8 text-xs" />
            <CommandList className="max-h-[260px]">
              <CommandEmpty>No matches.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value={allLabel}
                  onSelect={() => {
                    onChange(ALL);
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  <Check className={`w-3 h-3 mr-2 ${value === ALL ? "opacity-100" : "opacity-0"}`} />
                  {allLabel}
                </CommandItem>
                {options.map((opt) => (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                    className="text-xs"
                  >
                    <Check className={`w-3 h-3 mr-2 ${value === opt ? "opacity-100" : "opacity-0"}`} />
                    <span className="truncate">{opt}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
