import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Phone, Mail, FileText, Clock } from "lucide-react";
import { ChatTranscriptSheet } from "./ChatTranscriptSheet";
import { formatDistanceToNow } from "date-fns";

interface ContactsTableProps {
  contacts: any[];
}

const CHAT_MEDIA_TYPE_IDS = new Set([3, 4]);
function isChatContact(c: any): boolean {
  if (!c || typeof c !== "object") return false;
  const id = c.mediaType ?? c.mediaTypeId;
  if (typeof id === "number" && CHAT_MEDIA_TYPE_IDS.has(id)) return true;
  const name = (c.mediaTypeName || c.mediaName || "").toString().toLowerCase();
  return name.includes("chat");
}

function mediaIcon(c: any) {
  const name = (c.mediaTypeName || c.mediaName || "").toString().toLowerCase();
  const id = c.mediaType ?? c.mediaTypeId;
  if (name.includes("chat") || CHAT_MEDIA_TYPE_IDS.has(id)) return MessageSquare;
  if (name.includes("email") || id === 1) return Mail;
  if (name.includes("voice") || name.includes("call") || name.includes("phone")) return Phone;
  return FileText;
}

function mediaLabel(c: any): string {
  if (c.mediaTypeName) return String(c.mediaTypeName);
  if (c.mediaName) return String(c.mediaName);
  const id = c.mediaType ?? c.mediaTypeId;
  if (typeof id === "number") {
    if (id === 1) return "Email";
    if (id === 3) return "Voice";
    if (id === 4) return "Chat";
    if (id === 5) return "Voicemail";
    return `Type ${id}`;
  }
  return "—";
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

  if (!contacts.length) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        No active contacts right now.
      </div>
    );
  }

  return (
    <>
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
            {contacts.map((c, i) => {
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
