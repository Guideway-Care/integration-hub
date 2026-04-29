import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, MessageSquare, RefreshCw, User, Bot, Info } from "lucide-react";
import { extractArray } from "@/lib/api";
import { format } from "date-fns";

interface ChatTranscriptSheetProps {
  contactId: string | null;
  contactLabel?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ChatMessage {
  PostTime?: string;
  postTime?: string;
  Label?: string;
  label?: string;
  From?: string;
  from?: string;
  Body?: string;
  body?: string;
  MessageText?: string;
  messageText?: string;
  Type?: string;
  type?: string;
  MessageType?: string;
}

async function fetchChatTranscript(contactId: string) {
  const res = await fetch("/api/incontact/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: "/incontactapi/services/v30.0/contacts/chats/{contactId}",
      params: { contactId, timeout: "0" },
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  const payload = await res.json();
  if (typeof payload?.statusCode === "number" && payload.statusCode >= 400) {
    const upstreamMsg =
      payload?.data?.error?.message ||
      payload?.data?.message ||
      (typeof payload.data === "string" ? payload.data : null) ||
      payload.statusText ||
      `Upstream HTTP ${payload.statusCode}`;
    throw new Error(`NICE ${payload.statusCode}: ${upstreamMsg}`);
  }
  return payload;
}

function pickField(msg: ChatMessage, ...keys: (keyof ChatMessage)[]): string | undefined {
  for (const k of keys) {
    const v = msg[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

function classifySender(from?: string, type?: string): "agent" | "customer" | "system" {
  const v = (from || type || "").toLowerCase();
  if (v.includes("agent")) return "agent";
  if (v.includes("client") || v.includes("customer") || v.includes("contact")) return "customer";
  return "system";
}

export function ChatTranscriptSheet({
  contactId,
  contactLabel,
  open,
  onOpenChange,
}: ChatTranscriptSheetProps) {
  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["chatTranscript", contactId],
    queryFn: () => fetchChatTranscript(contactId!),
    enabled: open && !!contactId,
    refetchInterval: open ? 5000 : false,
    staleTime: 0,
  });

  const messages: ChatMessage[] = extractArray(data?.data);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col p-0">
        <SheetHeader className="p-6 pb-3 border-b border-border/50">
          <SheetTitle className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" />
            Chat Transcript
            {isFetching && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
          </SheetTitle>
          <SheetDescription className="text-xs font-mono">
            {contactLabel || `Contact ${contactId}`} · auto-refresh every 5s
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {isLoading && (
            <div className="text-sm text-muted-foreground text-center py-8">
              Loading transcript...
            </div>
          )}

          {isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Could not load transcript</AlertTitle>
              <AlertDescription className="text-xs break-words">
                {error?.message}
              </AlertDescription>
            </Alert>
          )}

          {!isLoading && !isError && messages.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-8">
              No messages yet. The chat may not have started, or this isn't a chat contact.
            </div>
          )}

          {messages.map((msg, i) => {
            const text = pickField(msg, "Body", "body", "MessageText", "messageText") || "";
            const from = pickField(msg, "From", "from");
            const label = pickField(msg, "Label", "label");
            const type = pickField(msg, "Type", "type", "MessageType");
            const time = pickField(msg, "PostTime", "postTime");
            const sender = classifySender(from, type);

            const align =
              sender === "agent" ? "items-end" : sender === "customer" ? "items-start" : "items-center";
            const bubbleColor =
              sender === "agent"
                ? "bg-primary text-primary-foreground"
                : sender === "customer"
                ? "bg-secondary text-secondary-foreground"
                : "bg-muted text-muted-foreground italic";
            const Icon = sender === "agent" ? Bot : sender === "customer" ? User : Info;

            return (
              <div key={i} className={`flex flex-col ${align}`}>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
                  <Icon className="w-3 h-3" />
                  <span className="font-medium">{label || from || sender}</span>
                  {time && (
                    <span className="font-mono">
                      · {(() => {
                        try {
                          return format(new Date(time), "HH:mm:ss");
                        } catch {
                          return time;
                        }
                      })()}
                    </span>
                  )}
                </div>
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${bubbleColor}`}
                >
                  {text || <span className="opacity-60">(no message body)</span>}
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
