import type { DcsDb } from "@dcs/db";

import {
  buildCustodyProjection,
  buildFieldIntakeProjection,
  buildPricingExposureWorkbenchProjection,
  buildReconciliationWorkbenchProjection,
  buildSettlementListProjection,
} from "./workbench";

type CustomerTruthStatus = "estimated" | "provisional" | "validated" | "finalized";
type CustomerConfidence = "high" | "medium" | "low" | "unknown";

export interface CustomerVisibilitySummary {
  readonly generatedAt: string;
  readonly visibilityMode: "customer_filtered";
  readonly totalInventoryUnits: number;
  readonly totalBoxes: number;
  readonly totalConverters: number;
  readonly processedLots: number;
  readonly unprocessedLots: number;
  readonly currentValueUsd: string;
  readonly estimatedValueUsd: string;
  readonly finalizedValueUsd: string;
  readonly pendingAssayValueUsd: string;
  readonly openDivergences: number;
  readonly hedgeProtectedLots: number;
  readonly bidEligibleLots: number;
}

export interface CustomerInventoryRow {
  readonly lotRef: string;
  readonly queueId: string;
  readonly progressStage: "intake" | "processing" | "assay" | "settlement";
  readonly materialForm: string;
  readonly boxCount: number;
  readonly converterCount: number;
  readonly evidenceArtifactCount: number;
  readonly sampleCount: number;
  readonly truthStatus: CustomerTruthStatus;
  readonly confidence: CustomerConfidence;
  readonly validationStatus: string;
  readonly estimatedValueUsd: string | null;
  readonly finalValueUsd: string | null;
  readonly varianceUsd: string | null;
  readonly customerVisibleValueUsd: string | null;
  readonly marketComparisonUsd: string | null;
  readonly openDivergenceCount: number;
  readonly hedgeStatus: "protected" | "lock_in_available" | "not_required";
  readonly saleStatus: "eligible" | "needs_assay_or_pricing" | "intake_pending" | "settled";
  readonly bidVisibility: "invite_ready" | "not_ready" | "closed";
  readonly reportStatus: "available" | "pending";
  readonly proofStatus: "complete" | "partial" | "evidence_gap";
}

export interface CustomerActionRow {
  readonly action: string;
  readonly status: string;
  readonly control: string;
  readonly systemEffect: string;
}

export interface CustomerReportRow {
  readonly report: string;
  readonly basis: string;
  readonly status: "available" | "pending";
}

export interface CustomerVisibilityProjection {
  readonly summary: CustomerVisibilitySummary;
  readonly perspectives: readonly {
    readonly name: "Internal System View" | "Customer View" | "External Market View";
    readonly exposure: string;
    readonly controls: readonly string[];
  }[];
  readonly inventory: readonly CustomerInventoryRow[];
  readonly actions: readonly CustomerActionRow[];
  readonly reports: readonly CustomerReportRow[];
  readonly dailyTotals: {
    readonly converterActivity: number;
    readonly activeFieldUsers: number;
    readonly latestCaptureAt: string | null;
    readonly openCustomerVisibleIssues: number;
  };
}

function money(value: number): string {
  return value.toFixed(2);
}

function numeric(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isProcessedMaterial(materialForm: string): boolean {
  const normalized = materialForm.toLowerCase();
  return (
    normalized.includes("processed") ||
    normalized.includes("milled") ||
    normalized.includes("powder") ||
    normalized.includes("dust") ||
    normalized.includes("sample")
  );
}

function progressStage(input: {
  readonly queueState: string;
  readonly sampleCount: number;
  readonly settlementStatus: string | null;
  readonly lockedForProcessing: boolean;
}): CustomerInventoryRow["progressStage"] {
  if (input.settlementStatus === "finalized" || input.queueState === "settled") return "settlement";
  if (input.sampleCount > 0 || input.queueState === "sampled" || input.queueState === "assay_pending") return "assay";
  if (input.lockedForProcessing || input.queueState === "processing") return "processing";
  return "intake";
}

function truthStatus(stage: CustomerInventoryRow["progressStage"]): CustomerTruthStatus {
  if (stage === "settlement") return "finalized";
  if (stage === "assay") return "validated";
  if (stage === "processing") return "provisional";
  return "estimated";
}

function proofStatus(input: {
  readonly evidenceArtifactCount: number;
  readonly chainComplete: number;
  readonly chainTotal: number;
}): CustomerInventoryRow["proofStatus"] {
  if (input.evidenceArtifactCount === 0) return "evidence_gap";
  return input.chainComplete >= input.chainTotal ? "complete" : "partial";
}

export async function buildCustomerVisibilityProjection(
  db: DcsDb,
): Promise<CustomerVisibilityProjection> {
  const [custody, exposureRows, reconciliationRows, settlementRows, intakeRows] = await Promise.all([
    buildCustodyProjection(db),
    buildPricingExposureWorkbenchProjection(db),
    buildReconciliationWorkbenchProjection(db),
    buildSettlementListProjection(db),
    buildFieldIntakeProjection(db),
  ]);

  const exposureByQueueId = new Map(exposureRows.map((row) => [row.queueId, row] as const));
  const settlementByScope = new Map<string, (typeof settlementRows)[number]>();
  for (const settlement of settlementRows) {
    if (!settlementByScope.has(settlement.scopeId)) {
      settlementByScope.set(settlement.scopeId, settlement);
    }
  }

  const openReconciliation = reconciliationRows.filter(
    (row) => row.status === "open" || row.status === "investigating",
  );
  const openReconciliationByScope = new Map<string, number>();
  for (const row of openReconciliation) {
    openReconciliationByScope.set(row.scopeId, (openReconciliationByScope.get(row.scopeId) ?? 0) + 1);
  }

  const inventory: CustomerInventoryRow[] = custody.queues.map((queue) => {
    const exposure = exposureByQueueId.get(queue.queueId);
    const settlement = settlementByScope.get(queue.queueCode) ?? settlementByScope.get(queue.queueId);
    const stage = progressStage({
      queueState: queue.state,
      sampleCount: queue.sampleCount,
      settlementStatus: settlement?.status ?? queue.settlementStatus,
      lockedForProcessing: queue.lockedForProcessing,
    });
    const rowTruthStatus = truthStatus(stage);
    const evidenceStatus = proofStatus({
      evidenceArtifactCount: queue.evidenceArtifactCount,
      chainComplete: queue.chainCompleteness.complete,
      chainTotal: queue.chainCompleteness.total,
    });
    const finalValueUsd = settlement?.finalValueUsd ?? null;
    const estimatedValueUsd = settlement?.estimatedValueUsd ?? queue.estimatedValueUsd;
    const visibleValueUsd = finalValueUsd ?? estimatedValueUsd;
    const openDivergenceCount =
      openReconciliationByScope.get(queue.queueCode) ?? openReconciliationByScope.get(queue.queueId) ?? 0;
    const hasPrice = numeric(estimatedValueUsd) > 0;
    const isFinalized = rowTruthStatus === "finalized";
    const isSaleEligible = queue.boxCount > 0 && hasPrice;

    return {
      lotRef: queue.queueCode,
      queueId: queue.queueId,
      progressStage: stage,
      materialForm: queue.materialMix,
      boxCount: queue.boxCount,
      converterCount: queue.converterCount,
      evidenceArtifactCount: queue.evidenceArtifactCount,
      sampleCount: queue.sampleCount,
      truthStatus: rowTruthStatus,
      confidence:
        isFinalized || evidenceStatus === "complete"
          ? "high"
          : evidenceStatus === "partial"
            ? "medium"
            : "low",
      validationStatus:
        isFinalized
          ? "settlement_final"
          : queue.sampleCount > 0
            ? "assay_visible"
            : evidenceStatus === "evidence_gap"
              ? "proof_gap"
              : "customer_visible",
      estimatedValueUsd,
      finalValueUsd,
      varianceUsd: settlement?.varianceUsd ?? null,
      customerVisibleValueUsd: visibleValueUsd,
      marketComparisonUsd: settlement?.varianceUsd ?? exposure?.possibleVarianceUsd ?? null,
      openDivergenceCount,
      hedgeStatus:
        exposure && exposure.openHedgeCount > 0
          ? "protected"
          : exposure?.needsHedgeAttention
            ? "lock_in_available"
            : "not_required",
      saleStatus: isFinalized
        ? "settled"
        : isSaleEligible
          ? "eligible"
          : queue.boxCount > 0
            ? "needs_assay_or_pricing"
            : "intake_pending",
      bidVisibility: isFinalized ? "closed" : isSaleEligible ? "invite_ready" : "not_ready",
      reportStatus: evidenceStatus === "evidence_gap" ? "pending" : "available",
      proofStatus: evidenceStatus,
    };
  });

  const estimatedValue = inventory.reduce((total, row) => total + numeric(row.estimatedValueUsd), 0);
  const finalizedValue = inventory.reduce((total, row) => total + numeric(row.finalValueUsd), 0);
  const currentValue = inventory.reduce((total, row) => total + numeric(row.customerVisibleValueUsd), 0);
  const pendingAssayValue = inventory
    .filter((row) => row.truthStatus !== "finalized")
    .reduce((total, row) => total + numeric(row.estimatedValueUsd), 0);
  const hedgeProtectedLots = inventory.filter((row) => row.hedgeStatus === "protected").length;
  const bidEligibleLots = inventory.filter((row) => row.bidVisibility === "invite_ready").length;
  const saleEligibleLots = inventory.filter((row) => row.saleStatus === "eligible").length;
  const latestCaptureAt =
    intakeRows.length === 0
      ? null
      : intakeRows
          .map((row) => row.capturedAt)
          .sort()
          .at(-1) ?? null;
  const activeFieldUsers = new Set(
    intakeRows.map((row) => row.originUserDisplay).filter((value): value is string => Boolean(value)),
  ).size;

  return {
    summary: {
      generatedAt: new Date().toISOString(),
      visibilityMode: "customer_filtered",
      totalInventoryUnits: inventory.length,
      totalBoxes: inventory.reduce((total, row) => total + row.boxCount, 0),
      totalConverters: inventory.reduce((total, row) => total + row.converterCount, 0),
      processedLots: inventory.filter((row) => isProcessedMaterial(row.materialForm)).length,
      unprocessedLots: inventory.filter((row) => !isProcessedMaterial(row.materialForm)).length,
      currentValueUsd: money(currentValue),
      estimatedValueUsd: money(estimatedValue),
      finalizedValueUsd: money(finalizedValue),
      pendingAssayValueUsd: money(pendingAssayValue),
      openDivergences: openReconciliation.length,
      hedgeProtectedLots,
      bidEligibleLots,
    },
    perspectives: [
      {
        name: "Internal System View",
        exposure: "full control surface",
        controls: ["all state", "all trace", "pricing controls", "ledger controls"],
      },
      {
        name: "Customer View",
        exposure: "filtered verification surface",
        controls: ["inventory progress", "controlled value", "proof summaries", "allowed requests"],
      },
      {
        name: "External Market View",
        exposure: "limited bid surface",
        controls: ["specific exposed lots", "structured bids", "recorded outcomes"],
      },
    ],
    inventory,
    actions: [
      {
        action: "Sell converters",
        status: saleEligibleLots > 0 ? `${saleEligibleLots} lot(s) eligible` : "waiting on value/proof",
        control: "Customer can request sale; internal pricing logic remains authoritative.",
        systemEffect: "Creates controlled workflow intent for invoice, shipment, notification, and hedge review.",
      },
      {
        action: "Hedge lock-in visibility",
        status: hedgeProtectedLots > 0 ? `${hedgeProtectedLots} protected lot(s)` : "lock-in review available",
        control: "Customer-visible hedge status is a controlled value-protection representation.",
        systemEffect: "Keeps customer-facing exposure separate from internal market execution.",
      },
      {
        action: "Invite bids",
        status: bidEligibleLots > 0 ? `${bidEligibleLots} lot(s) ready` : "no lots ready",
        control: "Only selected lot summaries can be exposed to external market participants.",
        systemEffect: "Tracks structured bids without exposing internal system control.",
      },
      {
        action: "Reports and exports",
        status: "available",
        control: "Reports derive from immutable system data.",
        systemEffect: "Supports compliance, assay comparison, settlement review, and customer self-service.",
      },
    ],
    reports: [
      {
        report: "Inventory transparency",
        basis: "queues, boxes, converters, evidence counts, and value state",
        status: inventory.length > 0 ? "available" : "pending",
      },
      {
        report: "Assay comparison",
        basis: "estimated value, final value, variance, and settlement status",
        status: settlementRows.length > 0 ? "available" : "pending",
      },
      {
        report: "Reconciliation history",
        basis: "customer-visible open/closed divergence cases and resolution status",
        status: reconciliationRows.length > 0 ? "available" : "pending",
      },
      {
        report: "Daily yard activity",
        basis: "converter capture activity, source users, and latest capture timestamp",
        status: intakeRows.length > 0 ? "available" : "pending",
      },
    ],
    dailyTotals: {
      converterActivity: intakeRows.length,
      activeFieldUsers,
      latestCaptureAt,
      openCustomerVisibleIssues: openReconciliation.length,
    },
  };
}
