import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ApiFailure,
  Badge,
  LifecycleLayer,
  PageHeader,
  Panel,
  formatDateTime,
} from "../../../../components/workbench";
import { EvidencePreview, orderedEvidenceArtifacts } from "../../../../components/evidence-preview";
import { readTrace, type TraceEntityType } from "../../../../lib/api";

interface RouteParams {
  readonly params: Promise<{ entityType: string; entityId: string }>;
}

const TRACE_TYPES: readonly TraceEntityType[] = [
  "converter",
  "box",
  "queue",
  "shipment",
  "sample",
  "reconciliation_case",
  "settlement",
  "ledger_entry",
];

function isTraceType(value: string): value is TraceEntityType {
  return TRACE_TYPES.includes(value as TraceEntityType);
}

export default async function TraceViewPage(props: RouteParams) {
  const params = await props.params;
  if (!isTraceType(params.entityType)) {
    notFound();
  }

  try {
    const trace = await readTrace(params.entityType, params.entityId);

    const hasReceivedStage = trace.steps.some((step) => step.lifecycleState.toLowerCase().includes("received"));
    const settlementScopeWithoutConverterChain =
      trace.traceRef.entityType === "settlement" &&
      trace.chain.queueId !== null &&
      trace.chain.converterId === null &&
      trace.chain.boxId === null;
    type PipelineState = "present" | "missing" | "not_applicable";
    type PipelineNode = {
      label: string;
      state: PipelineState;
      note: string;
    };
    const pipeline: PipelineNode[] = [
      {
        label: "Field Capture",
        state: settlementScopeWithoutConverterChain
          ? "not_applicable"
          : trace.chain.converterId !== null
            ? "present"
            : "missing",
        note: settlementScopeWithoutConverterChain
          ? "origin is represented at milled queue scope in this chain"
          : "field capture missing",
      },
      {
        label: "Converter",
        state: settlementScopeWithoutConverterChain
          ? "not_applicable"
          : trace.chain.converterId !== null
            ? "present"
            : "missing",
        note: settlementScopeWithoutConverterChain
          ? "converter identity not required for this settlement scope"
          : "converter link missing",
      },
      {
        label: "Box",
        state: settlementScopeWithoutConverterChain
          ? "not_applicable"
          : trace.chain.boxId !== null
            ? "present"
            : "missing",
        note: settlementScopeWithoutConverterChain
          ? "box continuity collapsed into queue-level custody"
          : "box dependency missing",
      },
      {
        label: "Queue",
        state: trace.chain.queueId !== null ? "present" : "missing",
        note: "queue continuity missing",
      },
      {
        label: "Shipment",
        state: trace.chain.shipmentIds.length > 0 ? "present" : "missing",
        note: "shipment evidence missing",
      },
      {
        label: "Received",
        state: hasReceivedStage ? "present" : "missing",
        note: "receipt confirmation missing",
      },
      {
        label: "Sample / Analysis",
        state: trace.chain.sampleIds.length > 0 ? "present" : "missing",
        note: "sample chain missing",
      },
      {
        label: "Estimated Value",
        state: trace.chain.pricingDecisionId !== null ? "present" : "missing",
        note: "pricing estimate missing",
      },
      {
        label: "Hedge / Exposure",
        state: trace.chain.hedgePositionIds.length > 0 ? "present" : "missing",
        note: "hedge association missing",
      },
      {
        label: "Ledger Entries",
        state: trace.chain.ledgerEntryIds.length > 0 ? "present" : "missing",
        note: "financial binding missing",
      },
      {
        label: "Reconciliation Cases",
        state: trace.chain.reconciliationCaseIds.length > 0 ? "present" : "missing",
        note: "disagreement challenge missing",
      },
      {
        label: "Settlement",
        state: trace.chain.settlementId !== null ? "present" : "missing",
        note: "settlement artifact missing",
      },
      {
        label: "Final Invoice / Final Truth",
        state: trace.certaintySummary.finalizationState === "finalized" ? "present" : "missing",
        note: "final assay/invoice unresolved",
      },
    ];
    const chainComplete = pipeline.filter((node) => node.state !== "missing").length;

    return (
      <div className="space-y-4">
        <PageHeader
          title="Trace View"
          subtitle="How this state came to exist, what supports it, how certain it is, and whether it is proven."
        />

        <Panel title="Trace Anchor">
          <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
            <div>
              <dt className="text-surface-200">Entity</dt>
              <dd className="font-mono">
                {trace.traceRef.entityType}:{trace.traceRef.entityId}
              </dd>
            </div>
            <div>
              <dt className="text-surface-200">Resolved</dt>
              <dd>{formatDateTime(trace.traceRef.resolvedAt)}</dd>
            </div>
            <div>
              <dt className="text-surface-200">Overall Trust</dt>
              <dd>
                <Badge value={trace.certaintySummary.overallTrust} />
              </dd>
            </div>
            <div>
              <dt className="text-surface-200">Finalization State</dt>
              <dd>
                <Badge value={trace.certaintySummary.finalizationState} />
              </dd>
            </div>
          </dl>
          <div className="mt-3 rounded-lg border border-surface-700/70 bg-surface-850/40 p-3">
            <div className="text-xs uppercase tracking-wider text-surface-200">Resolved Chain</div>
            <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
              <div>Converter: {trace.chain.converterId ?? "-"}</div>
              <div>Box: {trace.chain.boxCode ?? trace.chain.boxId ?? "-"}</div>
              <div>Queue: {trace.chain.queueCode ?? trace.chain.queueId ?? "-"}</div>
              <div>Shipments: {trace.chain.shipmentIds.length}</div>
              <div>Settlement: {trace.chain.settlementId ?? "-"}</div>
              <div>Samples: {trace.chain.sampleIds.length}</div>
              <div>Ledger Entries: {trace.chain.ledgerEntryIds.length}</div>
              <div>Reconciliation Cases: {trace.chain.reconciliationCaseIds.length}</div>
            </div>
            <div className="mt-2 text-xs text-surface-200">
              Chain completeness: {chainComplete}/{pipeline.length} (present + not applicable)
            </div>
          </div>
        </Panel>

        <Panel title="Expected Chain">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {pipeline.map((node) => (
              <article
                key={node.label}
                className={`rounded border p-2 ${
                  node.state === "present"
                    ? "border-status-good/40 bg-status-good/10"
                    : node.state === "not_applicable"
                      ? "border-status-info/40 bg-status-info/10"
                      : "border-status-warn/40 bg-status-warn/10"
                }`}
              >
                <div className="font-mono text-xs uppercase tracking-wider text-surface-200">{node.label}</div>
                <div className="mt-1 text-sm">
                  {node.state === "present" ? (
                    <Badge value="present" tone="good" />
                  ) : node.state === "not_applicable" ? (
                    <Badge value="not applicable at this scope" tone="info" />
                  ) : (
                    <Badge value="missing dependency" tone="warn" />
                  )}
                </div>
                {node.state === "missing" ? (
                  <div className="mt-1 text-xs text-status-warn">{node.note}</div>
                ) : node.state === "not_applicable" ? (
                  <div className="mt-1 text-xs text-status-info">{node.note}</div>
                ) : null}
              </article>
            ))}
          </div>
        </Panel>

        <Panel title="Open Gaps">
          {trace.certaintySummary.openGaps.length === 0 ? (
            <div className="rounded border border-status-good/40 bg-status-good/10 p-3 text-sm text-status-good">
              No active proof gaps were detected in the resolved chain.
            </div>
          ) : (
            <ul className="space-y-1 text-sm">
              {trace.certaintySummary.openGaps.map((gap) => (
                <li
                  key={gap}
                  className="rounded border border-status-warn/40 bg-status-warn/10 px-3 py-2 text-status-warn"
                >
                  {gap}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Chronological Chain">
          <div className="space-y-3">
            {trace.steps.map((step) => (
              <details
                key={step.stepKey}
                className="rounded-lg border border-surface-700/70 bg-surface-850/35 p-3"
                open
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-xs uppercase tracking-wider text-surface-200">
                      Step {step.stepOrder} | {step.entityType}:{step.entityId}
                    </div>
                    <div className="mt-1 text-base text-surface-100">{step.title}</div>
                    <div className="text-xs text-surface-200">{formatDateTime(step.occurredAt)}</div>
                  </div>
                  <LifecycleLayer
                    truthStatus={step.truthStatus}
                    confidence={step.confidence}
                    validationStatus={step.validationStatus}
                  />
                </summary>

                <p className="mt-2 text-sm text-surface-100">{step.summary}</p>
                <div className="mt-2 text-xs text-surface-200">
                  Lifecycle state: <span className="font-mono text-surface-100">{step.lifecycleState}</span>
                </div>
                <div className="mt-2">
                  <Link
                    href={`/trace/${encodeURIComponent(step.entityType)}/${encodeURIComponent(step.entityId)}`}
                    className="font-mono text-xs text-status-info hover:underline"
                  >
                    open step-specific trace
                  </Link>
                </div>

                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <section className="rounded border border-surface-700/60 p-2">
                    <div className="text-xs uppercase tracking-wider text-surface-200">Origin</div>
                    {step.origin ? (
                      <div className="mt-1 space-y-1 text-sm">
                        <div>Source: {step.origin.sourceSystem}</div>
                        <div>User: {step.origin.originUserDisplay ?? step.origin.originUserId}</div>
                        <div className="font-mono text-xs text-surface-200">
                          Device: {step.origin.originDeviceRef ?? step.origin.originDeviceId}
                        </div>
                        <div className="text-xs text-surface-200">{formatDateTime(step.origin.capturedAt)}</div>
                      </div>
                    ) : (
                      <div className="mt-1 text-sm text-status-warn">
                        Origin not directly linked for this step.
                      </div>
                    )}
                  </section>

                  <section className="rounded border border-surface-700/60 p-2">
                    <div className="text-xs uppercase tracking-wider text-surface-200">Dependencies</div>
                    <div className="mt-1 text-xs">
                      <Badge value={`dependencies:${step.dependencyState}`} />
                    </div>
                    {step.dependencies.length === 0 ? (
                      <div className="mt-1 text-sm text-surface-200">No explicit dependency refs.</div>
                    ) : (
                      <ul className="mt-1 space-y-1 text-sm">
                        {step.dependencies.map((dependency) => (
                          <li
                            key={`${step.stepKey}-${dependency.entityType}-${dependency.entityId}`}
                            className="font-mono text-xs text-surface-100"
                          >
                            {dependency.entityType}:{dependency.entityId} {"=>"} {dependency.requiredState}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>

                {step.evidence ? (
                  <section className="mt-3 rounded border border-surface-700/60 p-2">
                    <div className="text-xs uppercase tracking-wider text-surface-200">Evidence</div>
                    <div className="mt-1 text-sm">
                      Bundle: <span className="font-mono">{step.evidence.evidenceBundleId}</span>
                    </div>
                    <div className="text-xs text-surface-200">
                      Captured by {step.evidence.capturedByUser ?? "-"} / {" "}
                      {step.evidence.capturedByDevice ?? "-"} at {formatDateTime(step.evidence.capturedAt)}
                    </div>
                    <div className="text-xs text-surface-200">
                      Location {step.evidence.location.lat}, {step.evidence.location.lon} (
                      {step.evidence.location.accuracyM}m)
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge value={`required:${step.evidence.requiredTypes.join(",") || "none"}`} tone="neutral" />
                      <Badge value={`present:${step.evidence.presentTypes.join(",") || "none"}`} tone="info" />
                      {step.evidence.missingTypes.length > 0 ? (
                        <Badge value={`missing:${step.evidence.missingTypes.join(",")}`} tone="warn" />
                      ) : (
                        <Badge value="missing:none" tone="good" />
                      )}
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {orderedEvidenceArtifacts(step.evidence.artifacts).map((artifact) => (
                        <div
                          key={artifact.artifactId}
                          className="rounded border border-surface-700/60 bg-surface-900/60 p-2"
                        >
                          <EvidencePreview
                            artifactId={artifact.artifactId}
                            evidenceType={artifact.evidenceType}
                            uri={artifact.uri}
                            capturedAt={artifact.capturedAt}
                            gpsLat={step.evidence!.location.lat}
                            gpsLon={step.evidence!.location.lon}
                            gpsAccuracyM={step.evidence!.location.accuracyM}
                            capturedBy={step.evidence!.capturedByDevice}
                            size="md"
                          />
                          <div className="font-mono text-[10px] text-surface-200">
                            {artifact.artifactId.slice(0, 8)}
                          </div>
                          <div className="text-[10px] text-surface-200">{formatDateTime(artifact.capturedAt)}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}
              </details>
            ))}
          </div>
        </Panel>

        <div className="flex gap-4">
          {trace.chain.settlementId ? (
            <Link
              className="text-status-info hover:underline"
              href={`/settlements/${trace.chain.settlementId}/reconstruct`}
            >
              Reconstruct settlement proof chain
            </Link>
          ) : null}
          <Link className="text-status-info hover:underline" href="/">
            Back to overview
          </Link>
        </div>
      </div>
    );
  } catch (error) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Trace View"
          subtitle="How this state came to exist, what supports it, how certain it is, and whether it is proven."
        />
        <ApiFailure error={error instanceof Error ? error.message : "Unknown API error"} />
      </div>
    );
  }
}
