import type { CSSProperties } from "react";

const STAGES = [
  "Binding custody continuity",
  "Verifying evidence bundles",
  "Reconciling financial lineage",
] as const;

export function RouteLoader(props: { compact?: boolean }) {
  const compact = Boolean(props.compact);

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-surface-700/70 bg-surface-900/80 ${
        compact ? "p-4" : "min-h-[68vh] p-8"
      }`}
    >
      <div className="haldn-loader-grid absolute inset-0 opacity-60" aria-hidden />
      <div className="haldn-loader-sweep absolute inset-x-0 top-0 h-1.5" aria-hidden />

      <div
        className={`relative z-10 ${compact ? "grid gap-4 md:grid-cols-[1fr_auto]" : "mx-auto grid max-w-3xl gap-6 lg:grid-cols-[1fr_auto]"}`}
      >
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.18em] text-status-info">
            HALDN CONTROL
          </div>
          <h2
            className={`mt-2 font-mono uppercase tracking-[0.14em] text-surface-100 ${
              compact ? "text-sm" : "text-2xl"
            }`}
          >
            Synchronizing Truth Graph
          </h2>
          <p className={`mt-2 text-surface-200 ${compact ? "text-xs" : "text-sm"}`}>
            Re-linking material custody, evidence proof, and financial exposure before rendering
            operator state.
          </p>

          <div className="mt-4 space-y-2">
            {STAGES.map((stage, index) => (
              <div
                key={stage}
                className="flex items-center gap-2 rounded border border-surface-700/60 bg-surface-850/60 px-3 py-2"
              >
                <span
                  className="haldn-loader-dot"
                  style={{ animationDelay: `${index * 180}ms` } as CSSProperties}
                />
                <span className={`${compact ? "text-xs" : "text-sm"} text-surface-100`}>{stage}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid place-items-center">
          <div className={`haldn-loader-core ${compact ? "h-20 w-20" : "h-28 w-28"}`}>
            <div className="haldn-loader-ring haldn-loader-ring-a" />
            <div className="haldn-loader-ring haldn-loader-ring-b" />
            <div className="haldn-loader-center" />
          </div>
        </div>
      </div>
    </div>
  );
}

