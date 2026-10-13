import { EVENT_TYPE_LABELS, type AppEvent } from "@/types";

/** Minimal CSV serialization used for real event / experiment exports. */

export interface CsvColumn<T> {
  key: string;
  header: string;
  value: (row: T) => string | number | null | undefined;
}

function escapeCell(value: string): string {
  if (value === "") return "";
  const needsQuotes = /[",\n\r]/.test(value);
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCell(c.header)).join(",");
  const body = rows.map((row) =>
    columns
      .map((c) => {
        const raw = c.value(row);
        if (raw === null || raw === undefined) return "";
        return escapeCell(String(raw));
      })
      .join(","),
  );
  return [header, ...body].join("\n");
}

/** Trigger a browser download of a CSV string. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function timestampSlug(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

export function exportEventsCsv(events: AppEvent[]): void {
  const csv = toCsv(events, [
    { key: "timestamp", header: "Timestamp", value: (r) => new Date(r.timestamp).toISOString() },
    { key: "type", header: "Event type", value: (r) => EVENT_TYPE_LABELS[r.type] ?? r.type },
    { key: "severity", header: "Severity", value: (r) => r.severity },
    { key: "sourceIp", header: "Source IP", value: (r) => r.sourceIp ?? "" },
    { key: "hostName", header: "Host", value: (r) => r.hostName ?? "" },
    {
      key: "rate",
      header: "Rate (Mbps)",
      value: (r) => (r.rateMbps !== undefined ? r.rateMbps.toFixed(3) : ""),
    },
    { key: "action", header: "Action taken", value: (r) => r.action },
    { key: "outcome", header: "Outcome", value: (r) => r.outcome },
    { key: "dataSource", header: "Data source", value: (r) => r.dataSource },
  ]);
  downloadCsv(`microbursthunter-events-${timestampSlug()}.csv`, csv);
}
