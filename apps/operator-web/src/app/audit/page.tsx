import {
  ApiFailure,
  Badge,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  formatDateTime,
} from "../../components/workbench";
import { EvidencePreview, orderedEvidenceArtifacts } from "../../components/evidence-preview";
import { readEvidence, readTransactions } from "../../lib/api";

export default async function AuditPage() {
  try {
    const [transactions, evidence] = await Promise.all([readTransactions(120), readEvidence()]);

    return (
      <div className="space-y-4">
        <PageHeader
          title="Audit Trail and Evidence Explorer"
          subtitle="Provenance-first views for reconstructability across command origin, validation, and evidence linkage."
        />

        <Panel title={`Transaction History (${transactions.length})`}>
          {transactions.length === 0 ? (
            <EmptyState message="No transactions found in event history." />
          ) : (
            <DataTable
              columns={[
                "Transaction",
                "Event Type",
                "Source",
                "Validation",
                "Origin",
                "Created At",
                "Applied At",
              ]}
            >
              {transactions.map((row) => (
                <tr key={row.transactionId}>
                  <td className="px-3 py-2 font-mono">{row.transactionId.slice(0, 8)}</td>
                  <td className="px-3 py-2">{row.eventType}</td>
                  <td className="px-3 py-2">{row.sourceSystem}</td>
                  <td className="px-3 py-2">
                    <Badge value={row.validationState} />
                  </td>
                  <td className="px-3 py-2">
                    <div>{row.originUserDisplay ?? "-"}</div>
                    <div className="font-mono text-xs text-surface-200">{row.originDeviceRef ?? "-"}</div>
                  </td>
                  <td className="px-3 py-2">{formatDateTime(row.createdAt)}</td>
                  <td className="px-3 py-2">{formatDateTime(row.appliedAt)}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>

        <Panel title={`Evidence Bundles (${evidence.length})`}>
          {evidence.length === 0 ? (
            <EmptyState message="No evidence bundles found." />
          ) : (
            <DataTable
              columns={[
                "Bundle",
                "Captured By",
                "Artifacts",
                "Converter Links",
                "Custody Links",
                "Ledger Links",
                "GPS",
                "Captured At",
              ]}
            >
              {evidence.map((row) => (
                <tr key={row.evidenceBundleId}>
                  <td className="px-3 py-2 font-mono">{row.evidenceBundleId.slice(0, 8)}</td>
                  <td className="px-3 py-2">
                    <div>{row.capturedByUser ?? "-"}</div>
                    <div className="font-mono text-xs text-surface-200">{row.capturedByDevice ?? "-"}</div>
                  </td>
                  <td className="px-3 py-2">{row.artifactCount}</td>
                  <td className="px-3 py-2">{row.converterLinks}</td>
                  <td className="px-3 py-2">{row.custodyEventLinks}</td>
                  <td className="px-3 py-2">{row.ledgerLinks}</td>
                  <td className="px-3 py-2 font-mono">
                    {row.gpsLat}, {row.gpsLon} ({row.gpsAccuracyM}m)
                  </td>
                  <td className="px-3 py-2">{formatDateTime(row.capturedAt)}</td>
                </tr>
              ))}
            </DataTable>
          )}
          {evidence.length > 0 ? (
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {evidence.slice(0, 6).map((row) => (
                <article
                  key={`${row.evidenceBundleId}-artifacts`}
                  className="rounded-lg border border-surface-700/70 bg-surface-850/50 p-2"
                >
                  <div className="mb-1 font-mono text-xs text-surface-200">
                    {row.evidenceBundleId.slice(0, 8)}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {orderedEvidenceArtifacts(row.artifacts).slice(0, 4).map((artifact) => (
                      <EvidencePreview
                        key={artifact.artifactId}
                        artifactId={artifact.artifactId}
                        evidenceType={artifact.evidenceType}
                        uri={artifact.uri}
                        capturedAt={artifact.capturedAt}
                        gpsLat={row.gpsLat}
                        gpsLon={row.gpsLon}
                        gpsAccuracyM={row.gpsAccuracyM}
                        capturedBy={row.capturedByDevice}
                        size="sm"
                      />
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </Panel>
      </div>
    );
  } catch (error) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Audit Trail and Evidence Explorer"
          subtitle="Provenance-first views for reconstructability across command origin, validation, and evidence linkage."
        />
        <ApiFailure error={error instanceof Error ? error.message : "Unknown API error"} />
      </div>
    );
  }
}

