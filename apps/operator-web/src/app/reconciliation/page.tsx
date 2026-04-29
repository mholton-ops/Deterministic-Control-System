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
  formatDateTime,
} from "../../components/workbench";
import { EntityLink, OpenPanelButton } from "../../components/entity-link";
import { readReconciliation } from "../../lib/api";
import { assessReconciliation } from "../../lib/truth";

export default async function ReconciliationPage() {
  try {
    const rows = await readReconciliation();
    const open = rows.filter((row) => row.status === "open" || row.status === "investigating");
    const critical = rows.filter((row) => row.severity === "critical");
    const totalOpenImpact = open.reduce(
      (accumulator, row) => accumulator + Number(row.financialImpactUsd ?? "0"),
      0,
    );

    return (
      <div className="space-y-4">
        <PageHeader
          title="Reconciliation"
          subtitle="Detected disagreements between system belief and observed truth, with chain and financial consequence."
        />
        <section className="grid gap-3 md:grid-cols-4">
          <StatCard label="Total Cases" value={String(rows.length)} />
          <StatCard label="Open Cases" value={String(open.length)} />
          <StatCard label="Critical Cases" value={String(critical.length)} />
          <StatCard label="Open Divergence Impact" value={formatCurrency(totalOpenImpact.toFixed(2))} />
        </section>
        <Panel title="Divergence Cases">
          {rows.length === 0 ? (
            <EmptyState message="No reconciliation cases available." />
          ) : (
            <DataTable
              columns={[
                "Case",
                "Divergence",
                "Affected Chain",
                "Expected vs Observed",
                "Financial Impact",
                "Confidence Impact",
                "Resolution Step",
                "Evidence",
                "Lifecycle",
                "Opened / Closed",
                "Chain Trace",
                "Case Trace",
                "Detail",
              ]}
            >
              {rows.map((row) => {
                const lifecycle = assessReconciliation(row);
                const traceEntityType =
                  row.scopeType === "ledger"
                    ? "ledger_entry"
                    : row.scopeType === "queue"
                      ? "queue"
                      : row.scopeType === "shipment"
                        ? "shipment"
                        : null;

                return (
                  <tr key={row.reconciliationCaseId}>
                    <td className="px-3 py-2">
                      <EntityLink entityType="reconciliation_case" entityId={row.reconciliationCaseId}>
                        {row.reconciliationCaseId.slice(0, 8)}
                      </EntityLink>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>{row.triggerType}</div>
                      <div>
                        <Badge value={row.status} />
                      </div>
                      <div>
                        <Badge value={row.severity} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {row.scopeType === "queue" ? (
                        <EntityLink entityType="queue" entityId={row.scopeId}>
                          {`${row.scopeType}:${row.scopeId}`}
                        </EntityLink>
                      ) : row.scopeType === "ledger" ? (
                        <EntityLink entityType="ledger_entry" entityId={row.scopeId}>
                          {`${row.scopeType}:${row.scopeId}`}
                        </EntityLink>
                      ) : row.scopeType === "shipment" ? (
                        <EntityLink entityType="shipment" entityId={row.scopeId}>
                          {`${row.scopeType}:${row.scopeId}`}
                        </EntityLink>
                      ) : (
                        <span className="font-mono">{`${row.scopeType}:${row.scopeId}`}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>expected: {formatCurrency(row.expectedValueUsd)}</div>
                      <div>observed: {formatCurrency(row.observedValueUsd)}</div>
                      <div>variance: {formatCurrency(row.varianceUsd)}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>{formatCurrency(row.financialImpactUsd)}</div>
                      <div className="text-status-warn">
                        unresolved truth gap may affect {formatCurrency(row.financialImpactUsd)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">{row.confidenceImpact}</td>
                    <td className="px-3 py-2 text-xs">{row.currentResolutionStep}</td>
                    <td className="px-3 py-2 text-xs">{row.relatedEvidenceBundles} bundles</td>
                    <td className="px-3 py-2">
                      <LifecycleLayer
                        truthStatus={lifecycle.truthStatus}
                        confidence={lifecycle.confidence}
                        validationStatus={lifecycle.validationStatus}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>{formatDateTime(row.openedAt)}</div>
                      <div>{formatDateTime(row.closedAt)}</div>
                    </td>
                    <td className="px-3 py-2">
                      {traceEntityType ? (
                        <TraceButton entityType={traceEntityType} entityId={row.scopeId} />
                      ) : (
                        <span className="text-xs text-surface-200">n/a</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <TraceButton entityType="reconciliation_case" entityId={row.reconciliationCaseId} />
                    </td>
                    <td className="px-3 py-2">
                      <OpenPanelButton entityType="reconciliation_case" entityId={row.reconciliationCaseId} />
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
          title="Reconciliation"
          subtitle="Divergence is surfaced structurally and resolved through additive action trails."
        />
        <ApiFailure error={error instanceof Error ? error.message : "Unknown API error"} />
      </div>
    );
  }
}
