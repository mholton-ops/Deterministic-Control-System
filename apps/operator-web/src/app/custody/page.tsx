import {
  ApiFailure,
  Badge,
  ChainCompletenessBadge,
  DataTable,
  EmptyState,
  LifecycleLayer,
  PageHeader,
  Panel,
  TraceButton,
  formatCurrency,
  formatDateTime,
} from "../../components/workbench";
import { EvidencePreview, orderedEvidenceArtifacts } from "../../components/evidence-preview";
import { EntityLink, OpenPanelButton } from "../../components/entity-link";
import { readCustody } from "../../lib/api";
import { assessQueue } from "../../lib/truth";

export default async function CustodyPage() {
  try {
    const custody = await readCustody();

    return (
      <div className="space-y-4">
        <PageHeader
          title="Inventory and Custody"
          subtitle="Converter -> box -> queue -> shipment continuity with explicit custody transitions."
        />

        <Panel title="Boxes">
          {custody.boxes.length === 0 ? (
            <EmptyState message="No boxes found." />
          ) : (
            <DataTable columns={["Box", "State + Trust", "Material", "Converters", "Evidence", "Created", "Trace", "Detail"]}>
              {custody.boxes.map((row) => (
                <tr key={row.boxId}>
                  <td className="px-3 py-2">
                    <EntityLink entityType="box" entityId={row.boxId}>
                      {row.boxCode}
                    </EntityLink>
                  </td>
                  <td className="px-3 py-2">
                    <div className="mb-1">
                      <Badge value={row.state} />
                    </div>
                    <LifecycleLayer
                      truthStatus={row.state === "received" || row.state === "closed" ? "validated" : "provisional"}
                      confidence={row.evidenceArtifactCount > 0 ? "medium" : "low"}
                      validationStatus={row.evidenceArtifactCount > 0 ? "evidence_linked" : "evidence_missing"}
                    />
                  </td>
                  <td className="px-3 py-2">{row.materialType}</td>
                  <td className="px-3 py-2">{row.converterCount}</td>
                  <td className="px-3 py-2">
                    <div className="mb-1 text-xs text-surface-200">
                      artifacts: {row.evidenceArtifactCount}
                    </div>
                    <div className="grid max-w-[220px] grid-cols-2 gap-1">
                      {orderedEvidenceArtifacts(row.representativeEvidence).map((artifact) => (
                        <EvidencePreview
                          key={artifact.artifactId}
                          artifactId={artifact.artifactId}
                          evidenceType={artifact.evidenceType}
                          uri={artifact.uri}
                          capturedBy={row.boxCode}
                          size="sm"
                        />
                      ))}
                      {row.representativeEvidence.length === 0 ? (
                        <div className="rounded border border-status-warn/50 bg-status-warn/10 p-1 text-[10px] text-status-warn">
                          no linked evidence
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2">{formatDateTime(row.createdAt)}</td>
                  <td className="px-3 py-2">
                    <TraceButton entityType="box" entityId={row.boxId} />
                  </td>
                  <td className="px-3 py-2">
                    <OpenPanelButton entityType="box" entityId={row.boxId} />
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>

        <Panel title="Queues">
          {custody.queues.length === 0 ? (
            <EmptyState message="No queues found." />
          ) : (
            <DataTable
              columns={[
                "Queue",
                "Relationship Density",
                "State + Trust",
                "Chain Completeness",
                "Locked",
                "Value at Risk",
                "Created",
                "Trace",
                "Detail",
              ]}
            >
              {custody.queues.map((row) => {
                const lifecycle = assessQueue(row);
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
                      <div>{row.ledgerEntryCount} ledger</div>
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
                    <td className="px-3 py-2">{row.lockedForProcessing ? "yes" : "no"}</td>
                    <td className="px-3 py-2 text-xs">
                      <div>est: {formatCurrency(row.estimatedValueUsd)}</div>
                      <div>exposed: {formatCurrency(row.exposedValueUsd)}</div>
                      <div>possible variance: {formatCurrency(row.possibleVarianceUsd)}</div>
                      <div>settlement: {row.settlementStatus ?? "pending"}</div>
                    </td>
                    <td className="px-3 py-2">{formatDateTime(row.createdAt)}</td>
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

        <Panel title="Shipments">
          {custody.shipments.length === 0 ? (
            <EmptyState message="No shipments found." />
          ) : (
            <DataTable
              columns={[
                "Shipment",
                "State",
                "Origin Site",
                "Destination Site",
                "Boxes",
                "Departed",
                "Received",
                "Trace",
                "Detail",
              ]}
            >
              {custody.shipments.map((row) => (
                <tr key={row.shipmentId}>
                  <td className="px-3 py-2">
                    <EntityLink entityType="shipment" entityId={row.shipmentId}>
                      {row.shipmentCode}
                    </EntityLink>
                  </td>
                  <td className="px-3 py-2">
                    <Badge value={row.state} />
                  </td>
                  <td className="px-3 py-2 font-mono">{row.originSiteId.slice(0, 8)}</td>
                  <td className="px-3 py-2 font-mono">{row.destinationSiteId.slice(0, 8)}</td>
                  <td className="px-3 py-2">{row.boxCount}</td>
                  <td className="px-3 py-2">{formatDateTime(row.departedAt)}</td>
                  <td className="px-3 py-2">{formatDateTime(row.receivedAt)}</td>
                  <td className="px-3 py-2">
                    <TraceButton entityType="shipment" entityId={row.shipmentId} />
                  </td>
                  <td className="px-3 py-2">
                    <OpenPanelButton entityType="shipment" entityId={row.shipmentId} />
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      </div>
    );
  } catch (error) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Inventory and Custody"
          subtitle="Converter -> box -> queue -> shipment continuity with explicit custody transitions."
        />
        <ApiFailure error={error instanceof Error ? error.message : "Unknown API error"} />
      </div>
    );
  }
}

