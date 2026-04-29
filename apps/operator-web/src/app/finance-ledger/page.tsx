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
import { readFundingControl, readLedgerTrace } from "../../lib/api";

function ledgerLifecycle(purposeCode: string): {
  truthStatus: "estimated" | "provisional" | "validated" | "finalized";
  confidence: "high" | "medium" | "low" | "unknown";
  validationStatus: string;
} {
  if (purposeCode === "settlement_payout") {
    return { truthStatus: "finalized", confidence: "high", validationStatus: "settlement_attached" };
  }
  if (purposeCode === "adjustment") {
    return { truthStatus: "validated", confidence: "medium", validationStatus: "additive_correction" };
  }
  if (purposeCode === "funding_advance") {
    return { truthStatus: "provisional", confidence: "medium", validationStatus: "awaiting_final_truth" };
  }
  return { truthStatus: "estimated", confidence: "unknown", validationStatus: "unclassified" };
}

export default async function FinanceLedgerPage() {
  try {
    const [ledger, fundingControl] = await Promise.all([readLedgerTrace(), readFundingControl()]);
    const total = ledger.entries.reduce((accumulator, entry) => accumulator + Number(entry.amountUsd), 0);

    return (
      <div className="space-y-4">
        <PageHeader
          title="Financial Ledger"
          subtitle="Immutable ledger entries tied to operational source references."
        />
        <section className="grid gap-3 md:grid-cols-3">
          <StatCard label="Ledger Entries" value={String(ledger.entries.length)} />
          <StatCard label="Summed Amount (Demo)" value={formatCurrency(total.toFixed(2))} />
          <StatCard label="Projection Generated" value={formatDateTime(ledger.generatedAt)} />
        </section>

        <Panel title="Funding / Money Control">
          <div className="mb-3 rounded-lg border border-surface-700/70 bg-surface-850/60 px-3 py-2 text-sm text-surface-100">
            This prevents money from floating apart from material state, valuation confidence, and settlement truth.
          </div>
          <section className="mb-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Funding Advances" value={String(fundingControl.summary.fundingAdvanceCount)} />
            <StatCard label="Total Advanced" value={formatCurrency(fundingControl.summary.totalFundingAdvancedUsd)} />
            <StatCard label="Provisional" value={String(fundingControl.summary.provisionalCount)} />
            <StatCard label="Finalized" value={String(fundingControl.summary.finalizedCount)} />
            <StatCard label="Corrections" value={String(fundingControl.summary.correctionCount)} />
          </section>
          {fundingControl.rows.length === 0 ? (
            <EmptyState message="No funding control records available." />
          ) : (
            <DataTable
              columns={[
                "Entry",
                "Purpose",
                "Advance",
                "Approving Actor",
                "Executing Actor",
                "Buyer / Site Balance",
                "Linked Purchases",
                "Linked Boxes / Queues",
                "State",
                "Corrections",
                "Separation Of Duty",
                "Evidence / Notes",
                "Ledger Source",
                "Trace",
                "Detail",
              ]}
            >
              {fundingControl.rows.slice(0, 24).map((row) => (
                <tr key={row.ledgerEntryId}>
                  <td className="px-3 py-2">
                    <EntityLink entityType="ledger_entry" entityId={row.ledgerEntryId}>
                      {row.ledgerEntryId.slice(0, 8)}
                    </EntityLink>
                  </td>
                  <td className="px-3 py-2">{row.purposeCode}</td>
                  <td className="px-3 py-2">{formatCurrency(row.fundingAdvanceUsd)}</td>
                  <td className="px-3 py-2">{row.approvingActor}</td>
                  <td className="px-3 py-2 text-xs">{row.executingActor}</td>
                  <td className="px-3 py-2">{formatCurrency(row.buyerOrSiteBalanceUsd)}</td>
                  <td className="px-3 py-2 text-xs">{row.linkedPurchases}</td>
                  <td className="px-3 py-2 text-xs">{row.linkedBoxesQueues}</td>
                  <td className="px-3 py-2">
                    <Badge
                      value={row.provisionalFinalState}
                      tone={row.provisionalFinalState.startsWith("finalized") ? "good" : "warn"}
                    />
                  </td>
                  <td className="px-3 py-2 text-xs">{row.offsettingCorrections}</td>
                  <td className="px-3 py-2 text-xs">{row.separationOfDutyTrail}</td>
                  <td className="px-3 py-2 text-xs">{row.evidenceRequirement}</td>
                  <td className="px-3 py-2 text-xs">{row.ledgerSourceReferences}</td>
                  <td className="px-3 py-2">
                    <TraceButton entityType="ledger_entry" entityId={row.ledgerEntryId} />
                  </td>
                  <td className="px-3 py-2">
                    <OpenPanelButton entityType="ledger_entry" entityId={row.ledgerEntryId} />
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>

        <Panel title="Ledger Trace">
          {ledger.entries.length === 0 ? (
            <EmptyState message="No ledger entries available." />
          ) : (
            <DataTable
              columns={[
                "Entry",
                "Purpose",
                "Lifecycle",
                "Amount",
                "Operational Ref",
                "Created",
                "Trace",
                "Detail",
              ]}
            >
              {ledger.entries.map((entry) => {
                const lifecycle = ledgerLifecycle(entry.purposeCode);
                return (
                  <tr key={entry.ledgerEntryId}>
                    <td className="px-3 py-2">
                      <EntityLink entityType="ledger_entry" entityId={entry.ledgerEntryId}>
                        {entry.ledgerEntryId.slice(0, 8)}
                      </EntityLink>
                    </td>
                    <td className="px-3 py-2">{entry.purposeCode}</td>
                    <td className="px-3 py-2">
                      <LifecycleLayer
                        truthStatus={lifecycle.truthStatus}
                        confidence={lifecycle.confidence}
                        validationStatus={lifecycle.validationStatus}
                      />
                    </td>
                    <td className="px-3 py-2">{formatCurrency(entry.amountUsd)}</td>
                    <td className="px-3 py-2">
                      <EntityLink entityType="queue" entityId={entry.sourceOperationalRef}>
                        {entry.sourceOperationalRef}
                      </EntityLink>
                    </td>
                    <td className="px-3 py-2">{formatDateTime(entry.createdAt)}</td>
                    <td className="px-3 py-2">
                      <TraceButton entityType="ledger_entry" entityId={entry.ledgerEntryId} />
                    </td>
                    <td className="px-3 py-2">
                      <OpenPanelButton entityType="ledger_entry" entityId={entry.ledgerEntryId} />
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
          title="Financial Ledger"
          subtitle="Immutable ledger entries tied to operational source references."
        />
        <ApiFailure error={error instanceof Error ? error.message : "Unknown API error"} />
      </div>
    );
  }
}

