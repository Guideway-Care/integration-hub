import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { BarChart3 } from "lucide-react";

interface DailyCount {
  contact_date: { value: string };
  dow: number;
  contact_count: number;
}

export default function MonitorPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["monitor-daily"],
    queryFn: () => api.get<{ data: DailyCount[] }>("/monitor/contact-daily-counts?startDate=2026-01-01"),
  });

  const rows = data?.data ?? [];
  const maxCount = Math.max(...rows.map((r) => r.contact_count), 1);

  const months: Map<string, DailyCount[]> = new Map();
  for (const row of rows) {
    const date = row.contact_date?.value ?? row.contact_date;
    const month = String(date).slice(0, 7);
    if (!months.has(month)) months.set(month, []);
    months.get(month)!.push(row);
  }

  function getIntensity(count: number): string {
    const ratio = count / maxCount;
    if (ratio === 0) return "bg-muted";
    if (ratio < 0.25) return "bg-green-200";
    if (ratio < 0.5) return "bg-green-300";
    if (ratio < 0.75) return "bg-green-400";
    return "bg-green-600";
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Contact Monitor</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Daily contact volume heatmap from BigQuery
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading BigQuery data...</div>
      ) : error ? (
        <div className="border border-destructive/30 rounded-lg p-4 bg-destructive/5">
          <p className="text-sm text-destructive">
            Unable to load monitor data. Make sure GCP credentials are configured.
          </p>
          <p className="text-xs text-muted-foreground mt-1">{(error as Error).message}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-lg">
          <BarChart3 className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No contact data found</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="border border-border rounded-lg p-4 bg-card">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold">{rows.length}</div>
                <div className="text-xs text-muted-foreground">Days with Data</div>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {rows.reduce((a, b) => a + b.contact_count, 0).toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground">Total Contacts</div>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {Math.round(rows.reduce((a, b) => a + b.contact_count, 0) / rows.length).toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground">Avg / Day</div>
              </div>
            </div>
          </div>

          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-3">Daily Heatmap</h3>
            <div className="flex flex-wrap gap-1">
              {rows.map((row) => {
                const date = row.contact_date?.value ?? String(row.contact_date);
                return (
                  <div
                    key={date}
                    className={`w-3 h-3 rounded-sm ${getIntensity(row.contact_count)}`}
                    title={`${date}: ${row.contact_count} contacts`}
                  />
                );
              })}
            </div>
            <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
              <span>Less</span>
              <div className="w-3 h-3 rounded-sm bg-muted" />
              <div className="w-3 h-3 rounded-sm bg-green-200" />
              <div className="w-3 h-3 rounded-sm bg-green-300" />
              <div className="w-3 h-3 rounded-sm bg-green-400" />
              <div className="w-3 h-3 rounded-sm bg-green-600" />
              <span>More</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
