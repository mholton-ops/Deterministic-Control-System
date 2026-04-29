import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ApiFailure,
  Badge,
  LifecycleLayer,
  PageHeader,
  Panel,
  formatCurrency,
} from "../../../../components/workbench";
import { readSettlementReconstruction } from "../../../../lib/api";

interface RouteParams {
  readonly params: Promise<{ settlementId: string }>;
}

export default async function SettlementReconstructPage(props: RouteParams) {
  const params = await props.params;

  try {
    const reconstruction = await readSettlementReconstruction(params.settlementId);
    if (!reconstruction) {
      notFound();
    }

    return (
      <div className="space-y-4">
        <PageHeader
          title="Settlement Reconstruction"
          subtitle="Step-by-step replay of how this outcome formed, where uncertainty existed, and what finalized proof closed it."
        />

        <Panel title="Before / After Value Chain">
          <dl className="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt className="text-surface-200">Estimated Value</dt>
              <dd>{formatCurrency(reconstruction.beforeAfter.estimatedValueUsd)}</dd>
            </div>
            <div>
              <dt className="text-surface-200">Final Value</dt>
              <dd>{formatCurrency(reconstruction.beforeAfter.finalValueUsd)}</dd>
            </div>
            <div>
              <dt className="text-surface-200">Variance</dt>
              <dd>{formatCurrency(reconstruction.beforeAfter.varianceUsd)}</dd>
            </div>
            <div>
              <dt className="text-surface-200">Explanation</dt>
              <dd>{reconstruction.beforeAfter.explanation}</dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Replay">
          <div className="space-y-3">
            {reconstruction.replay.map((step) => (
              <article
                key={`${step.order}-${step.stage}`}
                className="rounded-lg border border-surface-700/70 bg-surface-850/35 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-xs uppercase tracking-wider text-surface-200">
                      Step {step.order}
                    </div>
                    <div className="text-base text-surface-100">{step.stage}</div>
                  </div>
                  <LifecycleLayer
                    truthStatus={step.truthStatus}
                    confidence={step.confidence}
                    validationStatus={step.validationStatus}
                  />
                </div>
                <p className="mt-2 text-sm text-surface-100">{step.summary}</p>

                <div className="mt-2 flex flex-wrap gap-1">
                  {step.uncertainty.length === 0 ? (
                    <Badge value="uncertainty:none" tone="good" />
                  ) : (
                    step.uncertainty.map((uncertainty) => (
                      <Badge key={`${step.order}-${uncertainty}`} value={uncertainty} tone="warn" />
                    ))
                  )}
                </div>

                {step.origin ? (
                  <div className="mt-2 rounded border border-surface-700/60 p-2 text-xs text-surface-200">
                    Origin: {step.origin.sourceSystem} | {step.origin.originUserDisplay ?? step.origin.originUserId}
                    {" | "}
                    <span className="font-mono">
                      {step.origin.originDeviceRef ?? step.origin.originDeviceId}
                    </span>
                  </div>
                ) : null}

                {step.dependencies.length > 0 ? (
                  <div className="mt-2 rounded border border-surface-700/60 p-2">
                    <div className="text-xs uppercase tracking-wider text-surface-200">Dependencies</div>
                    <ul className="mt-1 space-y-1 text-xs text-surface-100">
                      {step.dependencies.map((dependency) => (
                        <li
                          key={`${step.order}-${dependency.entityType}-${dependency.entityId}`}
                          className="font-mono"
                        >
                          {dependency.entityType}:{dependency.entityId} {"=>"} {dependency.requiredState}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {step.evidenceBundleId ? (
                  <div className="mt-2 rounded border border-surface-700/60 p-2 text-xs">
                    <div className="text-surface-200">
                      Evidence bundle: <span className="font-mono text-surface-100">{step.evidenceBundleId}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {step.evidenceMissingTypes.length === 0 ? (
                        <Badge value="evidence_gap:none" tone="good" />
                      ) : (
                        step.evidenceMissingTypes.map((missingType) => (
                          <Badge key={`${step.order}-${missingType}`} value={`missing:${missingType}`} tone="warn" />
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </Panel>

        <div className="flex gap-4">
          <Link className="text-status-info hover:underline" href={`/settlements/${params.settlementId}`}>
            Back to settlement detail
          </Link>
          <Link className="text-status-info hover:underline" href={`/trace/settlement/${params.settlementId}`}>
            Open full trace
          </Link>
        </div>
      </div>
    );
  } catch (error) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Settlement Reconstruction"
          subtitle="Step-by-step replay of how this outcome formed, where uncertainty existed, and what finalized proof closed it."
        />
        <ApiFailure error={error instanceof Error ? error.message : "Unknown API error"} />
      </div>
    );
  }
}
