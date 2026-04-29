import Link from "next/link";
import type { ReactNode } from "react";

type BadgeTone = "neutral" | "good" | "warn" | "bad" | "info";

const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "border-surface-700 bg-surface-850 text-surface-100",
  good: "border-status-good/50 bg-status-good/15 text-status-good",
  warn: "border-status-warn/50 bg-status-warn/15 text-status-warn",
  bad: "border-status-bad/50 bg-status-bad/15 text-status-bad",
  info: "border-status-info/50 bg-status-info/15 text-status-info",
};

export function toneForState(value: string | null | undefined): BadgeTone {
  if (!value) return "neutral";
  const normalized = value.toLowerCase();
  if (normalized === "finalized" || normalized === "resolved" || normalized === "settled") {
    return "good";
  }
  if (normalized === "open" || normalized === "in_transit" || normalized === "assay_pending") {
    return "warn";
  }
  if (normalized === "critical" || normalized === "failed" || normalized === "discrepant") {
    return "bad";
  }

  return "info";
}

export function PageHeader(props: { title: string; subtitle: string }) {
  return (
    <header className="min-w-0 rounded-xl border border-surface-700/80 bg-surface-900/75 px-6 py-4 shadow-panel">
      <h1 className="font-mono text-xl uppercase tracking-wide text-surface-100">{props.title}</h1>
      <p className="mt-1 text-sm text-surface-200">{props.subtitle}</p>
    </header>
  );
}

export function Panel(props: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-surface-700/70 bg-surface-900/70 p-4 shadow-panel">
      <h2 className="font-mono text-sm uppercase tracking-wider text-surface-200">{props.title}</h2>
      <div className="mt-3">{props.children}</div>
    </section>
  );
}

export function StatCard(props: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-surface-700/80 bg-surface-850/70 p-3">
      <div className="text-xs uppercase tracking-wider text-surface-200">{props.label}</div>
      <div className="mt-1 font-mono text-2xl text-surface-100">{props.value}</div>
      {props.hint ? <div className="mt-1 text-xs text-surface-200">{props.hint}</div> : null}
    </div>
  );
}

export function Badge(props: { value: string; tone?: BadgeTone }) {
  const tone = props.tone ?? toneForState(props.value);
  return (
    <span
      className={`inline-flex rounded-md border px-2 py-0.5 text-xs uppercase tracking-wide ${BADGE_TONE_CLASS[tone]}`}
    >
      {props.value}
    </span>
  );
}

export function truthStatusTone(
  value: "estimated" | "provisional" | "validated" | "finalized",
): BadgeTone {
  if (value === "finalized") return "good";
  if (value === "validated") return "info";
  if (value === "provisional") return "warn";
  return "neutral";
}

export function confidenceTone(value: "high" | "medium" | "low" | "unknown"): BadgeTone {
  if (value === "high") return "good";
  if (value === "medium") return "info";
  if (value === "low") return "warn";
  return "neutral";
}

export function TraceButton(props: {
  entityType:
    | "converter"
    | "box"
    | "queue"
    | "shipment"
    | "sample"
    | "reconciliation_case"
    | "settlement"
    | "ledger_entry";
  entityId: string;
  label?: string;
}) {
  return (
    <Link
      href={`/trace/${encodeURIComponent(props.entityType)}/${encodeURIComponent(props.entityId)}`}
      className="inline-flex rounded border border-status-info/60 bg-status-info/10 px-2 py-1 font-mono text-xs uppercase tracking-wide text-status-info hover:bg-status-info/20"
    >
      {props.label ?? "Trace"}
    </Link>
  );
}

export function LifecycleLayer(props: {
  truthStatus: "estimated" | "provisional" | "validated" | "finalized";
  confidence: "high" | "medium" | "low" | "unknown";
  validationStatus: string;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      <Badge value={props.truthStatus} tone={truthStatusTone(props.truthStatus)} />
      <Badge value={`confidence:${props.confidence}`} tone={confidenceTone(props.confidence)} />
      <Badge value={props.validationStatus} tone="neutral" />
    </div>
  );
}

export function ChainCompletenessBadge(props: {
  complete: number;
  total: number;
  missing?: readonly string[];
}) {
  const percent = props.total === 0 ? 0 : Math.round((props.complete / props.total) * 100);
  const tone: BadgeTone = percent >= 90 ? "good" : percent >= 65 ? "info" : percent >= 40 ? "warn" : "bad";
  return (
    <div className="space-y-1">
      <Badge value={`chain ${props.complete}/${props.total}`} tone={tone} />
      {props.missing && props.missing.length > 0 ? (
        <div className="text-[10px] text-surface-200">missing: {props.missing.join(", ")}</div>
      ) : null}
    </div>
  );
}

export function DataTable(props: {
  columns: readonly string[];
  children: ReactNode;
  stickyActionColumns?: 0 | 1 | 2;
}) {
  const lastColumn = props.columns[props.columns.length - 1];
  const nextToLastColumn = props.columns[props.columns.length - 2];
  const stickyActionColumns =
    props.stickyActionColumns ??
    (nextToLastColumn === "Trace" && lastColumn === "Detail"
      ? 2
      : lastColumn === "Trace" || lastColumn === "Detail"
        ? 1
        : 0);
  const stickyClass =
    stickyActionColumns === 2
      ? "haldn-table-sticky-actions-2"
      : stickyActionColumns === 1
        ? "haldn-table-sticky-actions-1"
        : "";

  return (
    <div className={`max-w-full overflow-x-auto rounded-lg border border-surface-700/60 ${stickyClass}`}>
      <table className="min-w-max w-full divide-y divide-surface-700 text-left text-sm">
        <thead className="bg-surface-850/80">
          <tr>
            {props.columns.map((column) => (
              <th
                key={column}
                className="px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-surface-200"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-700/70 bg-surface-900/40">{props.children}</tbody>
      </table>
    </div>
  );
}

export function EmptyState(props: { message: string }) {
  return (
    <div className="rounded-lg border border-status-warn/40 bg-status-warn/10 p-3 text-sm text-status-warn">
      {props.message}
    </div>
  );
}

export function ApiFailure(props: { error: string }) {
  return (
    <div className="rounded-lg border border-status-bad/40 bg-status-bad/10 p-4 text-sm text-status-bad">
      Unable to query control API: {props.error}
    </div>
  );
}

export function formatCurrency(value: string | null): string {
  if (!value) return "-";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return value;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(numeric);
}

export function formatNumber(value: string, fractionDigits = 2): string {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return value;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: fractionDigits }).format(numeric);
}

export function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").replace(".000Z", "Z");
}

