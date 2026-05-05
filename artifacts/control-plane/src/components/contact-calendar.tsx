import { useState } from "react";

export interface DailyCount {
  contact_date: { value: string } | string;
  dow: number;
  contact_count: number;
}

export const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function ContactCalendar({ rows, monthsPerPage = 3 }: { rows: DailyCount[]; monthsPerPage?: number }) {
  const [monthPage, setMonthPage] = useState<number | null>(null);

  const dataByDate = new Map<string, number>();
  for (const row of rows) {
    const date = typeof row.contact_date === "string" ? row.contact_date : row.contact_date?.value ?? "";
    dataByDate.set(date, row.contact_count);
  }

  const dowTotals = [0, 0, 0, 0, 0, 0, 0];
  const dowCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const row of rows) {
    const bqDow = row.dow ?? new Date(typeof row.contact_date === "string" ? row.contact_date : row.contact_date?.value ?? "").getDay() + 1;
    const jsDay = bqDow === 1 ? 0 : bqDow - 1;
    dowTotals[jsDay] += row.contact_count;
    dowCounts[jsDay] += 1;
  }
  const dowAvg = dowTotals.map((t, i) => (dowCounts[i] > 0 ? Math.round(t / dowCounts[i]) : 0));

  const months = new Map<string, { year: number; month: number }>();
  for (const row of rows) {
    const date = typeof row.contact_date === "string" ? row.contact_date : row.contact_date?.value ?? "";
    const key = date.slice(0, 7);
    if (!months.has(key)) {
      const [y, m] = key.split("-").map(Number);
      months.set(key, { year: y, month: m });
    }
  }
  const sortedMonths = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const totalPages = Math.max(1, Math.ceil(sortedMonths.length / monthsPerPage));
  const activePage = monthPage ?? totalPages - 1;
  const endIdx = sortedMonths.length - (totalPages - 1 - activePage) * monthsPerPage;
  const startIdx = Math.max(0, endIdx - monthsPerPage);
  const visibleMonths = sortedMonths.slice(startIdx, endIdx);

  function getCellColor(count: number, dow: number): string {
    const avg = dowAvg[dow];
    if (avg === 0) return "bg-gray-100";
    const pctOff = Math.abs(count - avg) / avg;
    if (pctOff <= 0.1) return "bg-green-100";
    if (pctOff <= 0.2) return "bg-yellow-100";
    return "bg-red-100";
  }

  function getVariance(count: number, dow: number): { text: string; color: string } {
    const avg = dowAvg[dow];
    if (avg === 0) return { text: "", color: "" };
    const pct = ((count - avg) / avg) * 100;
    const arrow = pct >= 0 ? "▲" : "▼";
    const color = Math.abs(pct) <= 10 ? "text-green-600" : Math.abs(pct) <= 20 ? "text-yellow-600" : "text-red-600";
    return { text: `${arrow} ${Math.abs(pct).toFixed(1)}%`, color };
  }

  function buildMonthGrid(year: number, month: number) {
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const weeks: (number | null)[][] = [];
    let week: (number | null)[] = Array(firstDay).fill(null);

    for (let day = 1; day <= daysInMonth; day++) {
      week.push(day);
      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
    }
    if (week.length > 0) {
      while (week.length < 7) week.push(null);
      weeks.push(week);
    }
    return weeks;
  }

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-lg p-4 bg-card">
        <h3 className="text-sm font-semibold mb-3">Day of Week Averages</h3>
        <div className="grid grid-cols-7 gap-2">
          {DOW_LABELS.map((label, i) => (
            <div key={label} className="text-center">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-lg font-bold">{dowAvg[i].toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="text-muted-foreground">Legend:</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-100 border border-green-200" /> Within 10% of avg</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-yellow-100 border border-yellow-200" /> 10%–20% off avg</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-100 border border-red-200" /> Over 20% off avg</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-gray-100 border border-gray-200" /> No data</span>
      </div>

      {sortedMonths.length > monthsPerPage && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setMonthPage(Math.max(0, activePage - 1))}
            disabled={activePage === 0}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Older
          </button>
          <span className="text-xs text-muted-foreground">
            {visibleMonths.length > 0
              ? `${MONTH_NAMES[visibleMonths[0][1].month - 1]} ${visibleMonths[0][1].year} – ${MONTH_NAMES[visibleMonths[visibleMonths.length - 1][1].month - 1]} ${visibleMonths[visibleMonths.length - 1][1].year}`
              : ""}
            {" "}({activePage + 1} of {totalPages})
          </span>
          <button
            onClick={() => setMonthPage(Math.min(totalPages - 1, activePage + 1))}
            disabled={activePage >= totalPages - 1}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Newer →
          </button>
        </div>
      )}

      <div className={`grid gap-4 ${monthsPerPage === 1 ? "" : monthsPerPage === 2 ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
        {visibleMonths.map(([key, { year, month }]) => {
          const weeks = buildMonthGrid(year, month);
          return (
            <div key={key} className="border border-border rounded-lg p-3 bg-card">
              <h4 className="text-sm font-semibold mb-2">{MONTH_NAMES[month - 1]} {year}</h4>
              <div className="grid grid-cols-7 gap-px text-center">
                {DOW_LABELS.map((d) => (
                  <div key={d} className="text-[10px] text-muted-foreground font-medium py-1">{d}</div>
                ))}
                {weeks.flat().map((day, idx) => {
                  if (day === null) return <div key={`e-${idx}`} className="p-1" />;
                  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const count = dataByDate.get(dateStr);
                  const dow = idx % 7;
                  if (count === undefined) {
                    return (
                      <div key={dateStr} className="bg-gray-50 rounded-sm p-0.5 min-h-[40px]">
                        <div className="text-[10px] text-muted-foreground">{day}</div>
                        <div className="text-[9px] text-muted-foreground">—</div>
                      </div>
                    );
                  }
                  const variance = getVariance(count, dow);
                  return (
                    <div
                      key={dateStr}
                      className={`${getCellColor(count, dow)} rounded-sm p-0.5 min-h-[40px] border border-transparent hover:border-primary/30 transition-colors`}
                      title={`${dateStr}: ${count.toLocaleString()} contacts`}
                    >
                      <div className="text-[10px] font-medium text-foreground/70">{day}</div>
                      <div className="text-[10px] font-bold leading-tight">{count.toLocaleString()}</div>
                      {variance.text && (
                        <div className={`text-[8px] leading-tight ${variance.color}`}>{variance.text}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
