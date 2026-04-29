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
  TraceButton,
  formatCurrency,
  formatDateTime,
} from "../../components/workbench";
import { EntityLink, OpenPanelButton } from "../../components/entity-link";
import { readSettlements } from "../../lib/api";
import { assessSettlement } from "../../lib/truth";

export default async function SettlementsPage() {
  try {
    const rows = await readSettlements();

    return (
      <div className="space-y-4">
        <PageHeader
          title="Assay to Settlement"
          subtitle="Estimated-to-final transition with immutable financial artifacts and variance visibility."
        />
        <Panel title="Settlement Artifacts">
          {rows.length === 0 ? (
            <EmptyState message="No settlements available." />
          ) : (
            <DataTable
              columns={[
                "Settlement",
                "Scope",
                "Status",
                "Lifecycle",
                "Estimated",
                "Final",
                "Variance",
                "Explanation",
                "Chain Completeness",
                "Invoices",
                "Finalized At",
                "Details",
                "Detail Panel",
              ]}
            >
              {rows.map((row) => {
                const lifecycle = assessSettlement(row);
                const variance = row.varianceUsd ? Number(row.varianceUsd) : null;
                const explanation =
                  row.status !== "finalized" || row.finalValueUsd === null
                    ? "Awaiting final proof."
                    : variance === null
                      ? "Variance metadata missing."
                      : Math.abs(variance) < 1
                        ? "Estimate matched final."
                        : variance > 0
                          ? "Final exceeded estimate."
                          : "Final below estimate.";

                return (
                  <tr key={row.settlementId}>
                    <td className="px-3 py-2">
                      <EntityLink entityType="settlement" entityId={row.settlementId}>
                        {row.settlementId.slice(0, 8)}
                      </EntityLink>
                    </td>
                    <td className="px-3 py-2">
                      <EntityLink entityType="queue" entityId={row.scopeId}>
                        {`${row.scopeType}:${row.scopeId}`}
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
                    <td className="px-3 py-2">{formatCurrency(row.estimatedValueUsd)}</td>
                    <td className="px-3 py-2">{formatCurrency(row.finalValueUsd)}</td>
                    <td className="px-3 py-2">{formatCurrency(row.varianceUsd)}</td>
                    <td className="px-3 py-2">{explanation}</td>
                    <td className="px-3 py-2">
                      <ChainCompletenessBadge
                        complete={row.chainCompleteness.complete}
                        total={row.chainCompleteness.total}
                        missing={row.chainCompleteness.missing}
                      />
                    </td>
                    <td className="px-3 py-2">{row.invoiceCount}</td>
                    <td className="px-3 py-2">{formatDateTime(row.finalizedAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <Link
                          href={`/settlements/${row.settlementId}`}
                          className="font-mono text-status-info hover:underline"
                        >
                          Detail
                        </Link>
                        <TraceButton entityType="settlement" entityId={row.settlementId} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <OpenPanelButton entityType="settlement" entityId={row.settlementId} />
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
          title="Assay to Settlement"
          subtitle="Estimated-to-final transition with immutable financial artifacts and variance visibility."
        />
        <ApiFailure error={error instanceof Error ? error.message : "Unknown API error"} />
      </div>
    );
  }
}

