import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useState } from "react";
import { FileAudio, Download, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { TableSkeleton } from "@/components/table-skeleton";

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

export default function RecordingsPage() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const pageSize = 50;

  const { data, isLoading, error } = useQuery({
    queryKey: ["recordings"],
    queryFn: () => api.get<Recording[]>("/bq/recordings"),
    retry: false,
  });

  const allRecordings = data ?? [];
  const filtered = search
    ? allRecordings.filter(
        (r) =>
          r.acd_contact_id?.includes(search) ||
          r.contact_id?.includes(search) ||
          r.agent_name?.toLowerCase().includes(search.toLowerCase()) ||
          r.file_name?.includes(search)
      )
    : allRecordings;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const clampedPage = Math.min(page, totalPages - 1);
  if (clampedPage !== page) setPage(clampedPage);
  const recordings = filtered.slice(clampedPage * pageSize, (clampedPage + 1) * pageSize);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Call Recordings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {allRecordings.length.toLocaleString()} recordings stored in BigQuery
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href="/api/export/recordings?format=csv"
            download
            className="text-xs border border-border rounded px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-1.5"
          >
            <Download className="w-3 h-3" />
            CSV
          </a>
          <a
            href="/api/export/recordings?format=json"
            download
            className="text-xs border border-border rounded px-3 py-1.5 hover:bg-muted transition-colors flex items-center gap-1.5"
          >
            <Download className="w-3 h-3" />
            JSON
          </a>
        </div>
      </div>

      {!isLoading && !error && allRecordings.length > 0 && (
        <div className="mb-4 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search by contact ID, agent name, or file name..."
            className="w-full pl-9 pr-3 py-2 border border-input rounded-md text-sm bg-background"
          />
        </div>
      )}

      {error ? (
        <div className="border border-destructive/30 rounded-lg p-4 bg-destructive/5">
          <p className="text-sm text-destructive">Unable to load recordings from BigQuery.</p>
          <p className="text-xs text-muted-foreground mt-1">{(error as Error).message}</p>
        </div>
      ) : isLoading ? (
        <TableSkeleton rows={10} cols={8} />
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-lg">
          <FileAudio className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">{search ? "No matching recordings" : "No recordings found"}</p>
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
                {recordings.map((r) => (
                  <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs">{r.acd_contact_id || r.contact_id}</td>
                    <td className="px-4 py-3 text-xs">{r.agent_name || r.agent_id || "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {r.start_date ? new Date(r.start_date).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs">{formatDuration(r.duration_seconds)}</td>
                    <td className="px-4 py-3 text-xs">{r.direction || "—"}</td>
                    <td className="px-4 py-3 text-xs">{formatBytes(r.file_size_bytes)}</td>
                    <td className="px-4 py-3 text-xs font-mono text-muted-foreground truncate max-w-[200px]">
                      {r.gcs_uri || "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {r.ingestion_timestamp ? new Date(r.ingestion_timestamp).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-xs text-muted-foreground">
                Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}
              </span>
              <div className="flex gap-1">
                <button
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                  className="p-1.5 border border-border rounded hover:bg-muted disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(page + 1)}
                  className="p-1.5 border border-border rounded hover:bg-muted disabled:opacity-30 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
