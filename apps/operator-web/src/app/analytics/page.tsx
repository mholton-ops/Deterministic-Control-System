import {
  ApiFailure,
  DataTable,
  EmptyState,
  LifecycleLayer,
  PageHeader,
  Panel,
  TraceButton,
  formatDateTime,
  formatNumber,
} from "../../components/workbench";
import { EntityLink, OpenPanelButton } from "../../components/entity-link";
import { readAnalytics } from "../../lib/api";
import { assessSample } from "../../lib/truth";

function delta(raw: string, corrected: string | null): string {
  if (!corrected) return "-";
  const rawValue = Number(raw);
  const correctedValue = Number(corrected);
  if (Number.isNaN(rawValue) || Number.isNaN(correctedValue)) return "-";
  return (correctedValue - rawValue).toFixed(2);
}

export default async function AnalyticsPage() {
  try {
    const rows = await readAnalytics();

    return (
      <div className="space-y-4">
        <PageHeader
          title="Analytical Results"
          subtitle="Estimated composition with matrix-corrected values and explicit confidence context."
        />
        <Panel title={`Samples (${rows.length})`}>
          {rows.length === 0 ? (
            <EmptyState message="No sample rows available." />
          ) : (
            <DataTable
              columns={[
                "Sample",
                "Queue",
                "Source",
                "Lifecycle",
                "Pt Raw -> Corrected",
                "Pd Raw -> Corrected",
                "Rh Raw -> Corrected",
                "Matrix",
                "Provisional / Final",
                "Captured",
                "Trace",
                "Detail",
              ]}
            >
              {rows.map((row) => {
                const lifecycle = assessSample(row);
                return (
                  <tr key={row.sampleId}>
                    <td className="px-3 py-2">
                      <EntityLink entityType="sample" entityId={row.sampleId}>
                        {row.sampleId.slice(0, 8)}
                      </EntityLink>
                    </td>
                    <td className="px-3 py-2">
                      <EntityLink entityType="queue" entityId={row.queueCode}>
                        {row.queueCode}
                      </EntityLink>
                    </td>
                    <td className="px-3 py-2">{row.source}</td>
                    <td className="px-3 py-2">
                      <LifecycleLayer
                        truthStatus={lifecycle.truthStatus}
                        confidence={lifecycle.confidence}
                        validationStatus={lifecycle.validationStatus}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {formatNumber(row.ptPpmRaw, 3)}
                      {" -> "}
                      {formatNumber(row.ptPpmCorrected ?? "-", 3)} ({delta(row.ptPpmRaw, row.ptPpmCorrected)})
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {formatNumber(row.pdPpmRaw, 3)}
                      {" -> "}
                      {formatNumber(row.pdPpmCorrected ?? "-", 3)} ({delta(row.pdPpmRaw, row.pdPpmCorrected)})
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {formatNumber(row.rhPpmRaw, 3)}
                      {" -> "}
                      {formatNumber(row.rhPpmCorrected ?? "-", 3)} ({delta(row.rhPpmRaw, row.rhPpmCorrected)})
                    </td>
                    <td className="px-3 py-2">
                      {row.matrixId ? row.matrixQualificationStatus ?? "referenced" : "none"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.source === "icp_final" ? "final assay" : "provisional internal estimate"}
                    </td>
                    <td className="px-3 py-2">{formatDateTime(row.capturedAt)}</td>
                    <td className="px-3 py-2">
                      <TraceButton entityType="sample" entityId={row.sampleId} />
                    </td>
                    <td className="px-3 py-2">
                      <OpenPanelButton entityType="sample" entityId={row.sampleId} />
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
          title="Analytical Results"
          subtitle="Estimated composition with matrix-corrected values and explicit confidence context."
        />
        <ApiFailure error={error instanceof Error ? error.message : "Unknown API error"} />
      </div>
    );
  }
}

