import Link from "next/link";
import { notFound } from "next/navigation";

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
} from "../../../components/workbench";
import { EntityLink, OpenPanelButton } from "../../../components/entity-link";
import { readSettlement } from "../../../lib/api";
import { assessSettlement } from "../../../lib/truth";

interface RouteParams {
  readonly params: Promise<{ settlementId: string }>;
}

export default async function SettlementDetailPage(props: RouteParams) {
  const params = await props.params;

  try {
    const detail = await readSettlement(params.settlementId);
    if (!detail?.settlement) {
      notFound();
    }

    return (
      <div className="space-y-4">
        <PageHeader
          title="Settlement Detail"
          subtitle="Proof view: estimated vs final value, chain steps, invoice immutability, and reconstruct path."
        />
        <Panel title="Settlement Summary">
          {(() => {
            const lifecycle = assessSettlement({
              settlementId: detail.settlement.settlementId,
              scopeType: "queue",
              scopeId: detail.settlement.settlementId,
              status: detail.settlement.status,
              estimatedValueUsd: detail.settlement.estimatedValueUsd,
              finalValueUsd: detail.settlement.finalValueUsd,
              varianceUsd: detail.settlement.varianceUsd,
              invoiceCount: detail.invoices.length,
              chainCompleteness: {
                complete: detail.settlement.status === "finalized" ? 11 : 7,
                total: 11,
                missing: detail.settlement.status === "finalized" ? [] : ["final_assay", "invoice_finalization", "reconciliation_closure", "proof_closure"],
              },
              createdAt: detail.steps[0]?.recordedAt ?? new Date().toISOString(),
              finalizedAt: detail.settlement.finalizedAt,
            });
            return (
              <div className="mb-3">
                <LifecycleLayer
                  truthStatus={lifecycle.truthStatus}
                  confidence={lifecycle.confidence}
                  validationStatus={lifecycle.validationStatus}
                />
              </div>
            );
          })()}
          <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
            <div>
              <dt className="text-surface-200">Settlement ID</dt>
              <dd className="font-mono">
                <EntityLink entityType="settlement" entityId={detail.settlement.settlementId}>
                  {detail.settlement.settlementId}
                </EntityLink>
              </dd>
            </div>
            <div>
              <dt className="text-surface-200">Status</dt>
              <dd>
                <Badge value={detail.settlement.status} />
              </dd>
            </div>
            <div>
              <dt className="text-surface-200">Estimated Value</dt>
              <dd>{formatCurrency(detail.settlement.estimatedValueUsd)}</dd>
            </div>
            <div>
              <dt className="text-surface-200">Final Value</dt>
              <dd>{formatCurrency(detail.settlement.finalValueUsd)}</dd>
            </div>
            <div>
              <dt className="text-surface-200">Variance</dt>
              <dd>{formatCurrency(detail.settlement.varianceUsd)}</dd>
            </div>
            <div>
              <dt className="text-surface-200">Variance Explanation</dt>
              <dd>
                {detail.settlement.finalValueUsd
                  ? Number(detail.settlement.varianceUsd ?? "0") >= 0
                    ? "Final value moved above estimate after assay."
                    : "Final value moved below estimate after assay."
                  : "Final value not proven yet."}
              </dd>
            </div>
            <div>
              <dt className="text-surface-200">Finalized At</dt>
              <dd>{formatDateTime(detail.settlement.finalizedAt)}</dd>
            </div>
          </dl>
        </Panel>

        <Panel title="Sequence Steps">
          {detail.steps.length === 0 ? (
            <EmptyState message="No settlement steps recorded." />
          ) : (
            <DataTable columns={["Order", "Step", "Recorded At"]}>
              {detail.steps.map((step) => (
                <tr key={`${step.stepOrder}-${step.stepName}`}>
                  <td className="px-3 py-2">{step.stepOrder}</td>
                  <td className="px-3 py-2">{step.stepName}</td>
                  <td className="px-3 py-2">{formatDateTime(step.recordedAt)}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>

        <Panel title="Invoice Artifacts">
          {detail.invoices.length === 0 ? (
            <EmptyState message="No invoices generated for this settlement." />
          ) : (
            <div className="space-y-3">
              {detail.invoices.map((invoice) => (
                <div key={invoice.invoiceId} className="rounded-lg border border-surface-700/70 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="font-mono text-surface-100">{invoice.invoiceNumber}</div>
                    <div className="text-xs text-surface-200">{formatDateTime(invoice.issuedAt)}</div>
                  </div>
                  <DataTable columns={["Order", "Type", "Description", "Amount"]}>
                    {invoice.lines.map((line) => (
                      <tr key={`${invoice.invoiceId}-${line.sortOrder}`}>
                        <td className="px-3 py-2">{line.sortOrder}</td>
                        <td className="px-3 py-2">{line.lineType}</td>
                        <td className="px-3 py-2">{line.description}</td>
                        <td className="px-3 py-2">{formatCurrency(line.amountUsd)}</td>
                      </tr>
                    ))}
                  </DataTable>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <div>
          <div className="flex flex-wrap gap-4">
            <Link className="text-status-info hover:underline" href="/settlements">
              Back to settlements
            </Link>
            <Link
              className="text-status-info hover:underline"
              href={`/settlements/${detail.settlement.settlementId}/reconstruct`}
            >
              Reconstruct
            </Link>
            <TraceButton entityType="settlement" entityId={detail.settlement.settlementId} />
            <OpenPanelButton entityType="settlement" entityId={detail.settlement.settlementId} />
          </div>
        </div>
      </div>
    );
  } catch (error) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Settlement Detail"
          subtitle="Proof view: estimated vs final value, chain steps, invoice immutability, and reconstruct path."
        />
        <ApiFailure error={error instanceof Error ? error.message : "Unknown API error"} />
      </div>
    );
  }
}
