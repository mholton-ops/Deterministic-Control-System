import {
  ApiFailure,
  Badge,
  DataTable,
  EmptyState,
  LifecycleLayer,
  PageHeader,
  Panel,
  TraceButton,
  formatCurrency,
  formatDateTime,
} from "../../components/workbench";
import { EntityLink, OpenPanelButton } from "../../components/entity-link";
import { readGrading, readSmartLibraryDetail } from "../../lib/api";

export default async function GradingPage() {
  try {
    const [rows, smartLibrary] = await Promise.all([readGrading(), readSmartLibraryDetail()]);
    const overrides = rows.filter((row) => row.overridden).length;

    return (
      <div className="space-y-4">
        <PageHeader
          title="Grading Workbench"
          subtitle="Where physical identity becomes financial consequence through controlled match hierarchies and override governance."
        />

        <Panel title={`Decisions (${rows.length}) | Overrides (${overrides})`}>
          {rows.length === 0 ? (
            <EmptyState message="No grading decisions available." />
          ) : (
            <DataTable
              columns={[
                "Decision",
                "Converter",
                "Method",
                "Lifecycle",
                "Estimate",
                "Match Context",
                "Library Status",
                "Override",
                "Decided At",
                "Trace",
                "Detail",
              ]}
            >
              {rows.map((row) => (
                <tr key={row.gradingDecisionId}>
                  <td className="px-3 py-2">
                    <EntityLink entityType="converter" entityId={row.converterId}>
                      {row.gradingDecisionId.slice(0, 8)}
                    </EntityLink>
                  </td>
                  <td className="px-3 py-2">
                    <EntityLink entityType="converter" entityId={row.converterId}>
                      {row.converterId.slice(0, 8)}
                    </EntityLink>
                  </td>
                  <td className="px-3 py-2">{row.method}</td>
                  <td className="px-3 py-2">
                    <LifecycleLayer
                      truthStatus="estimated"
                      confidence={row.confidenceBand === "high" ? "high" : row.confidenceBand === "medium" ? "medium" : "low"}
                      validationStatus={row.qualificationStatus === "qualified" ? "library_qualified" : "library_fallback"}
                    />
                  </td>
                  <td className="px-3 py-2">{formatCurrency(row.estimatedValueUsd)}</td>
                  <td className="px-3 py-2 text-xs">
                    {row.method === "vin" ? "VIN match" : row.method === "serial" ? "Serial match" : row.method === "library_match" ? "Library fallback" : "Category fallback"}
                    <div className="text-surface-200">confidence: {row.confidenceBand}</div>
                  </td>
                  <td className="px-3 py-2">{row.qualificationStatus}</td>
                  <td className="px-3 py-2">{row.overridden ? row.overrideReason ?? "yes" : "no"}</td>
                  <td className="px-3 py-2">{formatDateTime(row.decidedAt)}</td>
                  <td className="px-3 py-2">
                    <TraceButton entityType="converter" entityId={row.converterId} />
                  </td>
                  <td className="px-3 py-2">
                    <OpenPanelButton entityType="converter" entityId={row.converterId} />
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>

        <Panel title="Smart Library Detail">
          <div className="mb-3 rounded-lg border border-surface-700/70 bg-surface-850/60 px-3 py-2 text-sm text-surface-100">
            This keeps valuation authority centralized while allowing the library to improve from final assay outcomes.
          </div>
          {smartLibrary.rows.length === 0 ? (
            <EmptyState message="No smart library detail available." />
          ) : (
            <DataTable
              columns={[
                "Converter",
                "Match Method",
                "Image / Artifact",
                "Physical Characteristics",
                "Dimensions",
                "Assay History",
                "Pricing History",
                "Qualification",
                "Override History",
                "Assay Feedback",
                "Refinement",
                "Authority",
                "Trace",
                "Detail",
              ]}
            >
              {smartLibrary.rows.slice(0, 16).map((row) => (
                <tr key={row.gradingDecisionId}>
                  <td className="px-3 py-2">
                    <EntityLink entityType="converter" entityId={row.converterId}>
                      {row.vinOrSerial ?? row.converterId.slice(0, 8)}
                    </EntityLink>
                    <div className="text-xs text-surface-200">{row.converterState}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <Badge value={row.matchMethod} tone="info" />
                    <div className="mt-1 text-surface-200">{row.matchHierarchy}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">{row.imageArtifactRef}</td>
                  <td className="px-3 py-2 text-xs">{row.physicalCharacteristics}</td>
                  <td className="px-3 py-2 text-xs">{row.dimensionalAttributes}</td>
                  <td className="px-3 py-2 text-xs">{row.assayHistory}</td>
                  <td className="px-3 py-2 text-xs">{row.pricingHistory}</td>
                  <td className="px-3 py-2">
                    <Badge value={row.qualificationStatus} />
                  </td>
                  <td className="px-3 py-2 text-xs">{row.overrideHistory}</td>
                  <td className="px-3 py-2 text-xs">{row.finalAssayFeedbackLoop}</td>
                  <td className="px-3 py-2 text-xs">{row.libraryRefinementNote}</td>
                  <td className="px-3 py-2 text-xs">{row.authorityControl}</td>
                  <td className="px-3 py-2">
                    <TraceButton entityType="converter" entityId={row.converterId} />
                  </td>
                  <td className="px-3 py-2">
                    <OpenPanelButton entityType="converter" entityId={row.converterId} />
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
          title="Grading Workbench"
          subtitle="Where physical identity becomes financial consequence through controlled match hierarchies and override governance."
        />
        <ApiFailure error={error instanceof Error ? error.message : "Unknown API error"} />
      </div>
    );
  }
}

