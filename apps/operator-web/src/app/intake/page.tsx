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
  formatDateTime,
} from "../../components/workbench";
import { EvidencePreview, orderedEvidenceArtifacts } from "../../components/evidence-preview";
import { EntityLink, OpenPanelButton } from "../../components/entity-link";
import { readEvidence, readIntake } from "../../lib/api";
import { assessIntake } from "../../lib/truth";

export default async function IntakePage() {
  try {
    const [intakeRows, evidenceRows] = await Promise.all([readIntake(), readEvidence()]);
    const evidenceByBundle = new Map(evidenceRows.map((row) => [row.evidenceBundleId, row] as const));
    const cleanCaptures = intakeRows.filter((row) => {
      const evidence = evidenceByBundle.get(row.evidenceBundleId);
      const types = new Set((evidence?.artifacts ?? []).map((artifact) => artifact.evidenceType));
      return types.has("image") && types.has("gps");
    }).length;
    const missingEvidence = intakeRows.filter((row) => {
      const evidence = evidenceByBundle.get(row.evidenceBundleId);
      const types = new Set((evidence?.artifacts ?? []).map((artifact) => artifact.evidenceType));
      return !types.has("image") || !types.has("gps");
    }).length;
    const suspiciousOrigin = intakeRows.filter((row) => !row.originUserDisplay || !row.originDeviceRef).length;
    const offlineQueued = intakeRows.filter((row) => row.state === "captured").length;
    const evidenceCoverage =
      intakeRows.length === 0
        ? 0
        : intakeRows.reduce((accumulator, row) => accumulator + row.evidenceArtifactCount, 0) /
          intakeRows.length;

    return (
      <div className="space-y-4">
        <PageHeader
          title="Field Intake"
          subtitle="Incoming capture stream where field truth is forced into structure, evidence, and origin provenance."
        />

        <section className="grid gap-3 md:grid-cols-4">
          <StatCard label="Captured Items" value={String(intakeRows.length)} />
          <StatCard label="Clean Captures" value={String(cleanCaptures)} />
          <StatCard label="Missing Evidence" value={String(missingEvidence)} />
          <StatCard label="Suspicious Origin" value={String(suspiciousOrigin)} />
          <StatCard
            label="Avg Evidence Artifacts / Capture"
            value={evidenceCoverage.toFixed(2)}
          />
          <StatCard label="Evidence Bundles" value={String(evidenceRows.length)} />
          <StatCard label="Queued Offline Submissions" value={String(offlineQueued)} />
        </section>

        <Panel title="Capture Records">
          {intakeRows.length === 0 ? (
            <EmptyState message="No capture records. Run deterministic simulation first." />
          ) : (
            <DataTable
              columns={[
                "Converter",
                "Lifecycle",
                "VIN / Serial",
                "Site",
                "Box",
                "Evidence Proof",
                "Origin",
                "Captured At",
                "Trace",
                "Detail",
              ]}
            >
              {intakeRows.map((row) => {
                const evidence = evidenceByBundle.get(row.evidenceBundleId);
                const required = ["image", "gps"];
                const present = new Set((evidence?.artifacts ?? []).map((artifact) => artifact.evidenceType));
                const missing = required.filter((requiredType) => !present.has(requiredType));
                const lifecycle = assessIntake(row, missing.length > 0);

                return (
                  <tr key={row.converterId}>
                    <td className="px-3 py-2">
                      <EntityLink entityType="converter" entityId={row.converterId}>
                        {row.converterId.slice(0, 8)}
                      </EntityLink>
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
                    <td className="px-3 py-2">{row.vinOrSerial ?? "-"}</td>
                    <td className="px-3 py-2">{row.siteCode ?? "-"}</td>
                    <td className="px-3 py-2">
                      {row.boxCode ? (
                        <EntityLink entityType="box" entityId={row.boxCode}>
                          {row.boxCode}
                        </EntityLink>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="mb-1 text-xs text-surface-200">
                        required: {required.join(", ")} | missing: {missing.join(", ") || "none"}
                      </div>
                      <div className="grid min-w-[196px] max-w-[220px] grid-cols-2 gap-1">
                        {orderedEvidenceArtifacts(evidence?.artifacts ?? []).slice(0, 4).map((artifact) => (
                          <EvidencePreview
                            key={artifact.artifactId}
                            artifactId={artifact.artifactId}
                            evidenceType={artifact.evidenceType}
                            uri={artifact.uri}
                            capturedAt={artifact.capturedAt}
                            gpsLat={evidence?.gpsLat}
                            gpsLon={evidence?.gpsLon}
                            gpsAccuracyM={evidence?.gpsAccuracyM}
                            capturedBy={row.originDeviceRef}
                            size="sm"
                          />
                        ))}
                        {(evidence?.artifacts.length ?? 0) === 0 ? (
                          <div className="rounded border border-status-warn/50 bg-status-warn/10 p-1 text-[10px] text-status-warn">
                            no evidence artifacts
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div>{row.originUserDisplay ?? "-"}</div>
                      <div className="font-mono text-xs text-surface-200">{row.originDeviceRef ?? "-"}</div>
                      {evidence ? (
                        <div className="mt-1 text-[10px] text-surface-200">
                          {evidence.gpsLat}, {evidence.gpsLon} ({evidence.gpsAccuracyM}m)
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{formatDateTime(row.capturedAt)}</td>
                    <td className="px-3 py-2">
                      <TraceButton entityType="converter" entityId={row.converterId} />
                    </td>
                    <td className="px-3 py-2">
                      <OpenPanelButton entityType="converter" entityId={row.converterId} />
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
          title="Field Intake"
          subtitle="Incoming capture stream where field truth is forced into structure, evidence, and origin provenance."
        />
        <ApiFailure error={error instanceof Error ? error.message : "Unknown API error"} />
      </div>
    );
  }
}

