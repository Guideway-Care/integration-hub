import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Phone, Mail, FileText, Clock, Filter, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChatTranscriptSheet } from "./ChatTranscriptSheet";
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

function agentLabel(c: any): string {
  if (c?.agentName) return String(c.agentName);
  if (c?.AgentName) return String(c.AgentName);
  if (c?.firstName && c?.lastName) return `${c.firstName} ${c.lastName}`;
  if (c?.agentId) return String(c.agentId);
  return "—";
}

const ALL = "__all__";

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
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [skillFilter, setSkillFilter] = useState<string>(ALL);
  const [agentFilter, setAgentFilter] = useState<string>(ALL);

  const validContacts = useMemo(
    () => contacts.filter((c) => c && typeof c === "object"),
    [contacts]
  );

  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    validContacts.forEach((c) => set.add(mediaLabel(c)));
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
    return validContacts.filter((c) => {
      if (typeFilter !== ALL && mediaLabel(c) !== typeFilter) return false;
      if (skillFilter !== ALL && skillLabel(c) !== skillFilter) return false;
      if (agentFilter !== ALL && agentLabel(c) !== agentFilter) return false;
      return true;
    });
  }, [validContacts, typeFilter, skillFilter, agentFilter]);

  const anyFilterActive =
    typeFilter !== ALL || skillFilter !== ALL || agentFilter !== ALL;

  function clearFilters() {
    setTypeFilter(ALL);
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
        <Filter className="w-4 h-4 text-muted-foreground" />
        <FilterSelect
          label="Type"
          value={typeFilter}
          onChange={setTypeFilter}
          options={typeOptions}
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
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Contact ID</th>
              <th className="px-4 py-3 font-medium">From</th>
              <th className="px-4 py-3 font-medium">Skill</th>
              <th className="px-4 py-3 font-medium">Agent</th>
              <th className="px-4 py-3 font-medium">Started</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
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
              const started =
                c.startDate ||
                c.StartDate ||
                c.contactStartTime ||
                c.contactStart;
              const label = `${mediaLabel(c)} · ${contactId || "(no id)"}`;

              return (
                <tr
                  key={contactId || i}
                  className="hover:bg-muted/40 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-muted-foreground" />
                      <span className="text-xs">{mediaLabel(c)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{contactId || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{String(from)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{String(skill)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{String(agent)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3" />
                      <span className="text-xs">{fmtTime(started)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
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
                      <Badge variant="secondary" className="text-[10px] font-normal">
                        {isChat ? "no id" : "n/a"}
                      </Badge>
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
    </>
  );
}

interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}

function FilterSelect({ label, value, onChange, options }: FilterSelectProps) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}:</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-7 text-xs w-[160px] bg-background">
          <SelectValue placeholder={`All ${label.toLowerCase()}s`} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All {label.toLowerCase()}s</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt} className="text-xs">
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
