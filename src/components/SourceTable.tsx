import { useState } from "react";
import { StatusPill, trafficStateLabel, trafficStateTone } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBytes, formatCount, formatMbpsValue, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SourceRow } from "@/simulation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

type SortKey = "name" | "packets" | "bytes" | "rateMbps" | "contributionPct";

export function SourceTable({
  sources,
  selectedId,
  onSelect,
}: {
  sources: SourceRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("bytes");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");

  const sorted = [...sources].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const cmp =
      typeof av === "string" && typeof bv === "string"
        ? av.localeCompare(bv)
        : Number(av) - Number(bv);
    return direction === "asc" ? cmp : -cmp;
  });

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection(key === "name" ? "asc" : "desc");
    }
  };

  const header = (key: SortKey, label: string, className?: string) => (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        {sortKey === key ? (
          direction === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowUpDown className="size-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {header("name", "Host / IP")}
          {header("packets", "Packets", "text-right")}
          {header("bytes", "Bytes", "text-right")}
          {header("rateMbps", "Rate", "text-right")}
          {header("contributionPct", "Burst share", "text-right")}
          <TableHead>Policy</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((source) => {
          const selected = selectedId === source.id;
          return (
            <TableRow
              key={source.id}
              data-state={selected ? "selected" : undefined}
              className="cursor-pointer"
              onClick={() => onSelect(source.id)}
            >
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium">{source.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {source.ip}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(source.packets)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatBytes(source.bytes)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMbpsValue(source.rateMbps)} Mbps
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        source.contributionPct >= 50 ? "bg-burst" : "bg-primary",
                      )}
                      style={{ width: `${Math.min(100, source.contributionPct)}%` }}
                    />
                  </div>
                  <span className="tabular-nums">{formatPercent(source.contributionPct)}</span>
                </div>
              </TableCell>
              <TableCell>
                <span
                  className={cn(
                    "text-xs",
                    source.rateCapMbps !== null ? "text-warning" : "text-muted-foreground",
                  )}
                >
                  {source.policy}
                </span>
              </TableCell>
              <TableCell>
                <StatusPill tone={trafficStateTone(source.state)} pulse={source.state === "burst"}>
                  {trafficStateLabel(source.state)}
                </StatusPill>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function SourceTableHint() {
  return (
    <p className="text-[11px] text-muted-foreground">
      Contribution = source bytes during the current burst ÷ total burst bytes × 100. A high
      share indicates volume, not intent — legitimate bulk traffic can also cause microbursts.
    </p>
  );
}

export function ExportButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick}>
      {label}
    </Button>
  );
}
