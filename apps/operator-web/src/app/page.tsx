import Link from "next/link";

import {
  ApiFailure,
  Badge,
  ChainCompletenessBadge,
  DataTable,
  EmptyState,
  LifecycleLayer,
  PageHeader,
  Panel,
  StatCard,
  TraceButton,
  formatCurrency,
  formatDateTime,
} from "../components/workbench";
import { EntityLink, OpenPanelButton } from "../components/entity-link";
import {
  readCommandSurface,
  readCustody,
  readPricingExposure,
  readReconciliation,
  readSettlements,
} from "../lib/api";
import { assessExposure, assessReconciliation, assessSettlement } from "../lib/truth";

export default async function OverviewPage() {
  try {
    const [commandSurface, queueExposure, reconciliation, settlements, custody] = await Promise.all([
      readCommandSurface(),
      readPricingExposure(),
      readReconciliation(),
      readSettlements(),
      readCustody(),
    ]);

    const openCases = reconciliation.filter((row) => row.status === "open" || row.status === "investigating");

    return (
      <div className="space-y-4">
        <PageHeader
          title="Operations Command Surface"
          subtitle="Deterministic control metrics for capital, uncertainty, divergence, and chain completeness across the truth graph."
        />
        <section aria-labelledby="capital-control-heading" className="space-y-2">
          <h2 id="capital-control-heading" className="font-mono text-xs uppercase tracking-wider text-surface-200">
            Capital Control
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Total Capital Deployed" value={formatCurrency(commandSurface.totalCapitalDeployedUsd)} />
            <StatCard label="Material Value Under Control" value={formatCurrency(commandSurface.materialValueUnderControlUsd)} />
            <StatCard label="Unproven Capital Exposure" value={formatCurrency(commandSurface.unprovenCapitalExposureUsd)} />
            <StatCard label="Pending Settlement Value" value={formatCurrency(commandSurface.pendingSettlementValueUsd)} />
            <StatCard label="Material In Custody" value={formatCurrency(commandSurface.materialInCustodyUsd)} compact />
            <StatCard label="Material In Transit" value={formatCurrency(commandSurface.materialInTransitUsd)} compact />
            <StatCard label="Pending Assay Value" value={formatCurrency(commandSurface.pendingAssayValueUsd)} compact />
            <StatCard label="Open Divergence Impact" value={formatCurrency(commandSurface.openDivergenceImpactUsd)} compact />
          </div>
        </section>

        <section aria-labelledby="integrity-control-heading" className="space-y-2">
          <h2 id="integrity-control-heading" className="font-mono text-xs uppercase tracking-wider text-surface-200">
            Integrity Signals
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <StatCard label="Queues Awaiting Assay" value={String(commandSurface.queuesAwaitingAssay)} compact />
            <StatCard label="Open Divergences" value={String(commandSurface.openDivergences)} compact />
            <StatCard label="Evidence Gaps" value={String(commandSurface.evidenceGaps)} compact />
            <StatCard
              label="Chain Completeness"
              value={`${commandSurface.chainCompleteness.complete}/${commandSurface.chainCompleteness.total}`}
              hint={`${commandSurface.chainCompleteness.percent}% complete`}
              compact
            />
            <StatCard label="Low Confidence Exposure" value={formatCurrency(commandSurface.lowConfidenceExposureUsd)} compact />
            <StatCard label="Hedge Coverage" value={`${commandSurface.hedgeCoveragePercent}%`} compact />
          </div>
        </section>

        <section aria-labelledby="operating-context-heading" className="space-y-2">
          <h2 id="operating-context-heading" className="font-mono text-xs uppercase tracking-wider text-surface-200">
            Operating Context
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <StatCard label="Estimated Floor Value" value={formatCurrency(commandSurface.estimatedFloorValueUsd)} compact />
            <StatCard label="Floor Inventory Value" value={formatCurrency(commandSurface.floorInventoryValueUsd)} compact />
            <StatCard label="Processed Catalyst Value" value={formatCurrency(commandSurface.processedCatalystValueUsd)} compact />
            <StatCard label="Whole Converter Value" value={formatCurrency(commandSurface.wholeConverterValueUsd)} compact />
            <StatCard label="Unproven Exposure" value={formatCurrency(commandSurface.unprovenExposureUsd)} compact />
            <StatCard label="Active Sites" value={String(commandSurface.activeSites)} compact />
            <StatCard label="Material In Transit Units" value={String(commandSurface.materialInTransit)} compact />
            <StatCard label="Processing Backlog" value={String(commandSurface.processingBacklog)} compact />
            <StatCard label="Settlement Variance" value={formatCurrency(commandSurface.settlementVarianceUsd)} compact />
            <StatCard label="Estimated vs Final Variance" value={formatCurrency(commandSurface.estimatedVsFinalVarianceUsd)} compact />
            <StatCard label="Oldest Capture Risk" value={`${commandSurface.agingRisk.oldestCaptureDays}d`} compact />
            <StatCard label="Avg Assay Wait" value={`${commandSurface.agingRisk.avgAssayWaitDays}d`} compact />
            <StatCard label="Oldest Open Divergence" value={`${commandSurface.agingRisk.oldestOpenDivergenceDays}d`} compact />
            <StatCard label="Projection Timestamp" value={formatDateTime(commandSurface.generatedAt)} compact />
          </div>
        </section>

        <Panel title="High-Risk Queue Chains">
          {custody.queues.length === 0 ? (
            <EmptyState message="No queue chains found. Run seed + simulation first." />
          ) : (
            <DataTable
              columns={[
                "Queue",
                "Relationship Density",
                "State + Proof",
                "Chain Completeness",
                "Value at Risk",
                "Divergence",
                "Financial Linkage",
                "Trace",
                "Detail",
              ]}
            >
              {custody.queues.slice(0, 18).map((row) => {
                const exposureRow = queueExposure.find((candidate) => candidate.queueId === row.queueId);
                const lifecycle = exposureRow ? assessExposure(exposureRow) : {
                  truthStatus: "estimated" as const,
                  confidence: "unknown" as const,
                  validationStatus: "no_pricing_projection",
                };
                const relatedOpenCases = reconciliation.filter(
                  (candidate) =>
                    candidate.scopeId === row.queueCode || candidate.scopeId === row.queueId,
                );
                return (
                  <tr key={row.queueId}>
                    <td className="px-3 py-2">
                      <EntityLink entityType="queue" entityId={row.queueId}>
                        {row.queueCode}
                      </EntityLink>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>{row.boxCount} boxes</div>
                      <div>{row.converterCount} converters</div>
                      <div>{row.materialMix} material</div>
                      <div>{row.catalystWeightKg ?? "-"} kg catalyst</div>
                      <div>{row.evidenceArtifactCount} evidence</div>
                      <div>{row.sampleCount} samples</div>
                      <div>{formatCurrency(row.linkedLedgerAmountUsd)} ledger linked</div>
                      <div>{row.ledgerEntryCount} ledger entries</div>
                      <div>{row.openReconciliationCount} open divergence</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="mb-1">
                        <Badge value={row.state} />
                      </div>
                      <LifecycleLayer
                        truthStatus={lifecycle.truthStatus}
                        confidence={lifecycle.confidence}
                        validationStatus={lifecycle.validationStatus}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <ChainCompletenessBadge
                        complete={row.chainCompleteness.complete}
                        total={row.chainCompleteness.total}
                        missing={row.chainCompleteness.missing}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>est: {formatCurrency(row.estimatedValueUsd)}</div>
                      <div>exposed: {formatCurrency(row.exposedValueUsd)}</div>
                      <div>possible variance: {formatCurrency(row.possibleVarianceUsd)}</div>
                    </td>
                    <td className="px-3 py-2">
                      {relatedOpenCases.length === 0 ? (
                        <Badge value="none" tone="good" />
                      ) : (
                        <div className="space-y-1">
                          <Badge value={`${relatedOpenCases.length} open`} tone="warn" />
                          <div className="text-xs text-status-warn">
                            unresolved truth gap may affect {formatCurrency(row.possibleVarianceUsd)}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>settlement: {row.settlementStatus ?? "pending"}</div>
                      <div>ledger: {formatCurrency(row.linkedLedgerAmountUsd)}</div>
                      <div>material: {row.materialMix}</div>
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

        <section className="grid gap-4 xl:grid-cols-2">
          <Panel title="Open Reconciliation Cases">
            {openCases.length === 0 ? (
              <EmptyState message="No open divergence cases." />
            ) : (
              <DataTable columns={["Case", "Trigger", "Severity", "Lifecycle", "Scope", "Opened"]}>
                {openCases.slice(0, 8).map((row) => {
                  const lifecycle = assessReconciliation(row);
                  return (
                    <tr key={row.reconciliationCaseId}>
                      <td className="px-3 py-2">
                        <EntityLink entityType="reconciliation_case" entityId={row.reconciliationCaseId}>
                          {row.reconciliationCaseId.slice(0, 8)}
                        </EntityLink>
                      </td>
                      <td className="px-3 py-2">{row.triggerType}</td>
                      <td className="px-3 py-2">
                        <Badge value={row.severity} />
                      </td>
                      <td className="px-3 py-2">
                        <LifecycleLayer
                          truthStatus={lifecycle.truthStatus}
                          confidence={lifecycle.confidence}
                          validationStatus={lifecycle.validationStatus}
                        />
                      </td>
                      <td className="px-3 py-2">{`${row.scopeType}:${row.scopeId}`}</td>
                      <td className="px-3 py-2">{formatDateTime(row.openedAt)}</td>
                    </tr>
                  );
                })}
              </DataTable>
            )}
          </Panel>

          <Panel title="Recent Settlement Artifacts">
            {settlements.length === 0 ? (
              <EmptyState message="No settlement artifacts available yet." />
            ) : (
              <DataTable
                columns={["Settlement", "Status", "Lifecycle", "Chain", "Estimated", "Final", "Variance", "Details"]}
              >
                {settlements.slice(0, 8).map((row) => {
                  const lifecycle = assessSettlement(row);
                  return (
                    <tr key={row.settlementId}>
                      <td className="px-3 py-2">
                        <EntityLink entityType="settlement" entityId={row.settlementId}>
                          {row.settlementId.slice(0, 8)}
                        </EntityLink>
                      </td>
                      <td className="px-3 py-2">
                        <Badge value={row.status} />
                      </td>
                      <td className="px-3 py-2">
                        <LifecycleLayer
                          truthStatus={lifecycle.truthStatus}
                          confidence={lifecycle.confidence}
                          validationStatus={lifecycle.validationStatus}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <ChainCompletenessBadge
                          complete={row.chainCompleteness.complete}
                          total={row.chainCompleteness.total}
                          missing={row.chainCompleteness.missing}
                        />
                      </td>
                      <td className="px-3 py-2">{formatCurrency(row.estimatedValueUsd)}</td>
                      <td className="px-3 py-2">{formatCurrency(row.finalValueUsd)}</td>
                      <td className="px-3 py-2">{formatCurrency(row.varianceUsd)}</td>
                      <td className="px-3 py-2">
                        <Link
                          className="font-mono text-status-info hover:underline"
                          href={`/settlements/${row.settlementId}`}
                        >
                          Drilldown
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </DataTable>
            )}
          </Panel>
        </section>
      </div>
    );
  } catch (error) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Operations Command Surface"
          subtitle="Deterministic control metrics for capital, uncertainty, divergence, and chain completeness across the truth graph."
        />
        <ApiFailure error={error instanceof Error ? error.message : "Unknown API error"} />
      </div>
    );
  }
}

