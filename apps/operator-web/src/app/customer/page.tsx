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
import { readCustomerVisibility } from "../../lib/api";

function toneForCustomerStatus(value: string) {
  if (value === "available" || value === "eligible" || value === "protected" || value === "complete") {
    return "good" as const;
  }
  if (value === "pending" || value === "lock_in_available" || value === "partial" || value === "invite_ready") {
    return "warn" as const;
  }
  if (value === "evidence_gap") return "bad" as const;
  return "neutral" as const;
}

export default async function CustomerVisibilityPage() {
  try {
    const visibility = await readCustomerVisibility();

    return (
      <div className="space-y-4">
        <PageHeader
          title="Customer Visibility"
          subtitle="Controlled external truth surface: filtered inventory, value, proof, hedge, bid, and report status without internal control exposure."
        />

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Customer Visible Lots" value={String(visibility.summary.totalInventoryUnits)} />
          <StatCard label="Current Visible Value" value={formatCurrency(visibility.summary.currentValueUsd)} />
          <StatCard label="Pending Assay Value" value={formatCurrency(visibility.summary.pendingAssayValueUsd)} />
          <StatCard label="Open Customer Issues" value={String(visibility.summary.openDivergences)} />
          <StatCard label="Boxes Visible" value={String(visibility.summary.totalBoxes)} />
          <StatCard label="Converters Visible" value={String(visibility.summary.totalConverters)} />
          <StatCard label="Processed Lots" value={String(visibility.summary.processedLots)} />
          <StatCard label="Unprocessed Lots" value={String(visibility.summary.unprocessedLots)} />
          <StatCard label="Finalized Value" value={formatCurrency(visibility.summary.finalizedValueUsd)} />
          <StatCard label="Estimated Value" value={formatCurrency(visibility.summary.estimatedValueUsd)} />
          <StatCard label="Hedge Protected Lots" value={String(visibility.summary.hedgeProtectedLots)} />
          <StatCard label="Bid Eligible Lots" value={String(visibility.summary.bidEligibleLots)} />
        </section>

        <Panel title="Perspective Separation">
          <DataTable columns={["Perspective", "Exposure", "Controls"]}>
            {visibility.perspectives.map((perspective) => (
              <tr key={perspective.name}>
                <td className="px-3 py-2">{perspective.name}</td>
                <td className="px-3 py-2">{perspective.exposure}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {perspective.controls.map((control) => (
                      <Badge key={control} value={control} tone="info" />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        </Panel>

        <Panel title="Customer Inventory Transparency">
          {visibility.inventory.length === 0 ? (
            <EmptyState message="No customer-visible inventory is available." />
          ) : (
            <DataTable
              columns={[
                "Lot",
                "Progress",
                "Material",
                "Proof",
                "Visible Value",
                "Market / Variance",
                "Hedge",
                "Sale",
                "Bidding",
                "Reports",
                "Trace",
                "Detail",
              ]}
            >
              {visibility.inventory.map((row) => (
                <tr key={row.queueId}>
                  <td className="px-3 py-2">
                    <EntityLink entityType="queue" entityId={row.queueId}>
                      {row.lotRef}
                    </EntityLink>
                    <div className="mt-1 text-xs text-surface-200">
                      {row.boxCount} boxes / {row.converterCount} converters / {row.sampleCount} samples
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge value={row.progressStage} />
                  </td>
                  <td className="px-3 py-2">{row.materialForm}</td>
                  <td className="px-3 py-2">
                    <div className="mb-1">
                      <LifecycleLayer
                        truthStatus={row.truthStatus}
                        confidence={row.confidence}
                        validationStatus={row.validationStatus}
                      />
                    </div>
                    <div className="space-y-1">
                      <Badge value={row.proofStatus} tone={toneForCustomerStatus(row.proofStatus)} />
                      <div className="text-xs text-surface-200">{row.evidenceArtifactCount} evidence artifacts</div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div>visible: {formatCurrency(row.customerVisibleValueUsd)}</div>
                    <div>estimate: {formatCurrency(row.estimatedValueUsd)}</div>
                    <div>final: {formatCurrency(row.finalValueUsd)}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div>{formatCurrency(row.marketComparisonUsd)}</div>
                    <div>{row.openDivergenceCount} open issue(s)</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge value={row.hedgeStatus} tone={toneForCustomerStatus(row.hedgeStatus)} />
                  </td>
                  <td className="px-3 py-2">
                    <Badge value={row.saleStatus} tone={toneForCustomerStatus(row.saleStatus)} />
                  </td>
                  <td className="px-3 py-2">
                    <Badge value={row.bidVisibility} tone={toneForCustomerStatus(row.bidVisibility)} />
                  </td>
                  <td className="px-3 py-2">
                    <Badge value={row.reportStatus} tone={toneForCustomerStatus(row.reportStatus)} />
                  </td>
                  <td className="px-3 py-2">
                    <TraceButton entityType="queue" entityId={row.queueId} />
                  </td>
                  <td className="px-3 py-2">
                    <OpenPanelButton entityType="queue" entityId={row.queueId} />
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>

        <section className="grid gap-4 xl:grid-cols-2">
          <Panel title="Controlled Customer Actions">
            <DataTable columns={["Action", "Status", "Control Boundary", "System Effect"]}>
              {visibility.actions.map((row) => (
                <tr key={row.action}>
                  <td className="px-3 py-2">{row.action}</td>
                  <td className="px-3 py-2">
                    <Badge value={row.status} />
                  </td>
                  <td className="px-3 py-2">{row.control}</td>
                  <td className="px-3 py-2">{row.systemEffect}</td>
                </tr>
              ))}
            </DataTable>
          </Panel>

          <Panel title="Reports and Compliance">
            <DataTable columns={["Report", "Basis", "Status"]}>
              {visibility.reports.map((row) => (
                <tr key={row.report}>
                  <td className="px-3 py-2">{row.report}</td>
                  <td className="px-3 py-2">{row.basis}</td>
                  <td className="px-3 py-2">
                    <Badge value={row.status} tone={toneForCustomerStatus(row.status)} />
                  </td>
                </tr>
              ))}
            </DataTable>
          </Panel>
        </section>

        <section className="grid gap-3 md:grid-cols-4">
          <StatCard label="Converter Activity" value={String(visibility.dailyTotals.converterActivity)} />
          <StatCard label="Active Field Users" value={String(visibility.dailyTotals.activeFieldUsers)} />
          <StatCard label="Latest Capture" value={formatDateTime(visibility.dailyTotals.latestCaptureAt)} />
          <StatCard label="Visible Issues" value={String(visibility.dailyTotals.openCustomerVisibleIssues)} />
        </section>
      </div>
    );
  } catch (error) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Customer Visibility"
          subtitle="Controlled external truth surface: filtered inventory, value, proof, hedge, bid, and report status without internal control exposure."
        />
        <ApiFailure error={error instanceof Error ? error.message : "Unknown API error"} />
      </div>
    );
  }
}
