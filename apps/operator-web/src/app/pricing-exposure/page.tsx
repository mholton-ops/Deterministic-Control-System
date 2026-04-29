import {
  ApiFailure,
  Badge,
  DataTable,
  EmptyState,
  LifecycleLayer,
  PageHeader,
  Panel,
  StatCard,
  TraceButton,
  formatCurrency,
} from "../../components/workbench";
import { EntityLink, OpenPanelButton } from "../../components/entity-link";
import { readPricingExposure } from "../../lib/api";
import { assessExposure } from "../../lib/truth";

export default async function PricingExposurePage() {
  try {
    const rows = await readPricingExposure();
    const totalEstimated = rows.reduce(
      (accumulator, row) => accumulator + Number(row.estimatedValueUsd ?? "0"),
      0,
    );
    const needsHedgeAttention = rows.filter((row) => row.needsHedgeAttention).length;

    return (
      <div className="space-y-4">
        <PageHeader
          title="Pricing and Exposure"
          subtitle="Estimated value, confidence hierarchy, and hedge linkage tied directly to queue continuity."
        />

        <section className="grid gap-3 md:grid-cols-3">
          <StatCard label="Queues in Exposure View" value={String(rows.length)} />
          <StatCard
            label="Total Estimated Value"
            value={new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
            }).format(totalEstimated)}
          />
          <StatCard label="Need-Hedged Queues" value={String(needsHedgeAttention)} />
        </section>

        <Panel title="Exposure Rows">
          {rows.length === 0 ? (
            <EmptyState message="No exposure rows available." />
          ) : (
            <DataTable
              columns={[
                "Queue",
                "State",
                "Material",
                "Lifecycle",
                "Estimated / Exposed",
                "Possible Variance",
                "Pricing Source",
                "Confidence",
                "Hedges Pt/Pd/Rh",
                "Open Hedge Positions",
                "Linked Ledger",
                "Open Divergence",
                "Settlement Status",
                "Need-Hedged",
                "Trace",
                "Detail",
              ]}
            >
              {rows.map((row) => {
                const lifecycle = assessExposure(row);
                return (
                  <tr key={row.queueId}>
                    <td className="px-3 py-2">
                      <EntityLink entityType="queue" entityId={row.queueId}>
                        {row.queueCode}
                      </EntityLink>
                    </td>
                    <td className="px-3 py-2">
                      <Badge value={row.queueState} />
                    </td>
                    <td className="px-3 py-2">{row.materialForm}</td>
                    <td className="px-3 py-2">
                      <LifecycleLayer
                        truthStatus={lifecycle.truthStatus}
                        confidence={lifecycle.confidence}
                        validationStatus={lifecycle.validationStatus}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>est: {formatCurrency(row.estimatedValueUsd)}</div>
                      <div>exposed: {formatCurrency(row.exposedValueUsd)}</div>
                    </td>
                    <td className="px-3 py-2">{formatCurrency(row.possibleVarianceUsd)}</td>
                    <td className="px-3 py-2">{row.sourceMethod ?? "-"}</td>
                    <td className="px-3 py-2">{row.confidenceBand ?? "-"}</td>
                    <td className="px-3 py-2 font-mono">
                      {row.hedgedPtOz}/{row.hedgedPdOz}/{row.hedgedRhOz}
                    </td>
                    <td className="px-3 py-2">{row.openHedgeCount}</td>
                    <td className="px-3 py-2">{formatCurrency(row.linkedLedgerAmountUsd)}</td>
                    <td className="px-3 py-2">
                      {row.openDivergenceCount > 0 ? (
                        <div className="text-xs text-status-warn">{row.openDivergenceCount}</div>
                      ) : (
                        <div className="text-xs text-status-good">0</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge value={row.settlementStatus ?? "unset"} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="space-y-1">
                        <Badge value={row.needsHedgeAttention ? "attention" : "ok"} />
                        {row.needsHedgeAttention ? (
                          <div className="text-xs text-status-warn">
                            uncovered uncertainty may affect {formatCurrency(row.possibleVarianceUsd)}
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <TraceButton entityType="queue" entityId={row.queueId} />
                    </td>
                    <td className="px-3 py-2">
                      <OpenPanelButton entityType="queue" entityId={row.queueId} />
                    </td>
                  </tr>
                );
              })}
            </DataTable>
          )}
        </Panel>
      </div>
    );
  } catch (error) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Pricing and Exposure"
          subtitle="Estimated value, confidence hierarchy, and hedge linkage tied directly to queue continuity."
        />
        <ApiFailure error={error instanceof Error ? error.message : "Unknown API error"} />
      </div>
    );
  }
}

