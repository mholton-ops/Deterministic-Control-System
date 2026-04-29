import { desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { DcsDb } from "@dcs/db";
import {
  boxConverters,
  boxes,
  converters,
  devices,
  evidenceArtifacts,
  evidenceBundles,
  hedgePositions,
  invoices,
  ledgerEntries,
  pricingDecisions,
  queueBoxes,
  queues,
  reconciliationActions,
  reconciliationCases,
  samples,
  settlementSteps,
  settlements,
  shipmentBoxes,
  shipments,
  sites,
  users,
} from "@dcs/db";

import { buildTraceViewProjection, type TraceEntityType, type TraceViewProjection } from "./trace";

export type GraphEntityType =
  | "converter"
  | "box"
  | "queue"
  | "shipment"
  | "sample"
  | "ledger_entry"
  | "reconciliation_case"
  | "settlement";

export interface ChainCompletenessProjection {
  readonly complete: number;
  readonly total: number;
  readonly missing: readonly string[];
}

export interface TruthGraphLink {
  readonly entityType: GraphEntityType;
  readonly entityId: string;
  readonly label: string;
  readonly state: string;
}

export interface TruthGraphEntityProjection {
  readonly identity: {
    readonly entityType: GraphEntityType;
    readonly entityId: string;
    readonly displayId: string;
    readonly title: string;
  };
  readonly lifecycle: {
    readonly state: string;
    readonly truthStatus: "estimated" | "provisional" | "validated" | "finalized";
    readonly confidence: "high" | "medium" | "low" | "unknown";
    readonly validationStatus: string;
    readonly updatedAt: string | null;
  };
  readonly chainCompleteness: ChainCompletenessProjection;
  readonly origin: {
    readonly sourceSystem: string;
    readonly user: string;
    readonly device: string;
    readonly capturedAt: string;
  } | null;
  readonly evidenceBundles: readonly {
    bundleId: string;
    artifactCount: number;
    types: readonly string[];
    capturedAt: string;
    capturedByUser: string | null;
    capturedByDevice: string | null;
    gps: {
      lat: string;
      lon: string;
      accuracyM: string;
    };
  }[];
  readonly upstream: readonly TruthGraphLink[];
  readonly downstream: readonly TruthGraphLink[];
  readonly financial: {
    readonly ledgerEntryCount: number;
    readonly settlementCount: number;
    readonly ledgerAmountUsd: string;
    readonly estimatedValueUsd: string | null;
    readonly exposedValueUsd: string | null;
    readonly settlementValueUsd: string | null;
    readonly varianceUsd: string | null;
    readonly financialStatus: "provisional" | "exposed" | "reconciled" | "finalized";
    readonly materialForm: string;
    readonly custodyStatus: string;
    readonly entries: readonly {
      ledgerEntryId: string;
      purposeCode: string;
      amountUsd: string;
      sourceOperationalRef: string;
      createdAt: string;
      settlementId: string | null;
    }[];
  };
  readonly reconciliation: readonly {
    reconciliationCaseId: string;
    triggerType: string;
    severity: string;
    status: string;
    scopeType: string;
    scopeId: string;
    actionCount: number;
    openedAt: string;
    closedAt: string | null;
  }[];
  readonly valueLineage: {
    estimatedValueUsd: string | null;
    finalValueUsd: string | null;
    varianceUsd: string | null;
    explanation: string;
  } | null;
  readonly divergence: {
    triggerType: string;
    expectedValueUsd: string | null;
    observedValueUsd: string | null;
    varianceUsd: string | null;
    financialImpactUsd: string | null;
    confidenceImpact: string;
    currentResolutionStep: string;
    originScope: string;
    relatedEvidenceBundles: number;
  } | null;
  readonly related: {
    readonly queueFacts: {
      boxCount: number;
      converterCount: number;
      sampleCount: number;
      evidenceArtifactCount: number;
      ledgerEntryCount: number;
      openReconciliationCount: number;
    } | null;
  };
  readonly actions: {
    readonly fullTraceHref: string | null;
  };
}

export interface TruthGraphSearchResult {
  readonly entityType: GraphEntityType;
  readonly entityId: string;
  readonly label: string;
  readonly state: string;
  readonly context: string;
}

export interface CommandSurfaceProjection {
  readonly generatedAt: string;
  readonly totalCapitalDeployedUsd: string;
  readonly materialValueUnderControlUsd: string;
  readonly estimatedFloorValueUsd: string;
  readonly floorInventoryValueUsd: string;
  readonly materialInCustodyUsd: string;
  readonly materialInTransitUsd: string;
  readonly processedCatalystValueUsd: string;
  readonly wholeConverterValueUsd: string;
  readonly pendingSettlementValueUsd: string;
  readonly pendingAssayValueUsd: string;
  readonly unprovenExposureUsd: string;
  readonly unprovenCapitalExposureUsd: string;
  readonly lowConfidenceExposureUsd: string;
  readonly openDivergenceImpactUsd: string;
  readonly queuesAwaitingAssay: number;
  readonly openDivergences: number;
  readonly evidenceGaps: number;
  readonly chainCompleteness: {
    complete: number;
    total: number;
    percent: number;
  };
  readonly activeSites: number;
  readonly materialInTransit: number;
  readonly processingBacklog: number;
  readonly estimatedVsFinalVarianceUsd: string;
  readonly settlementVarianceUsd: string;
  readonly hedgeCoveragePercent: number;
  readonly agingRisk: {
    oldestCaptureDays: number;
    avgAssayWaitDays: number;
    oldestOpenDivergenceDays: number;
  };
}

interface QueueFacts {
  readonly queueId: string;
  readonly queueCode: string;
  readonly queueState: string;
  readonly materialForm: string;
  readonly boxCount: number;
  readonly converterCount: number;
  readonly sampleCount: number;
  readonly icpFinalCount: number;
  readonly evidenceArtifactCount: number;
  readonly ledgerEntryCount: number;
  readonly linkedLedgerAmountUsd: string;
  readonly openReconciliationCount: number;
  readonly settlementStatus: string | null;
  readonly settlementId: string | null;
  readonly settlementValueUsd: string | null;
  readonly estimatedValueUsd: string | null;
  readonly hedgeCount: number;
  readonly closedHedgeCount: number;
  readonly lockedForProcessing: boolean;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function queueRefCondition(ref: string) {
  return isUuid(ref) ? eq(queues.queueId, ref) : eq(queues.queueCode, ref);
}

function boxRefCondition(ref: string) {
  return isUuid(ref) ? eq(boxes.boxId, ref) : eq(boxes.externalCode, ref);
}

function shipmentRefCondition(ref: string) {
  return isUuid(ref) ? eq(shipments.shipmentId, ref) : eq(shipments.shipmentCode, ref);
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function statusFromState(state: string): "estimated" | "provisional" | "validated" | "finalized" {
  const normalized = state.toLowerCase();
  if (normalized.includes("final") || normalized.includes("settled") || normalized === "closed") {
    return "finalized";
  }
  if (normalized.includes("validated") || normalized.includes("valued") || normalized.includes("received")) {
    return "validated";
  }
  if (normalized.includes("pending") || normalized.includes("processing") || normalized.includes("transit")) {
    return "provisional";
  }
  return "estimated";
}

function confidenceFromTrace(trace: TraceViewProjection | null): "high" | "medium" | "low" | "unknown" {
  return trace?.certaintySummary.overallTrust ?? "unknown";
}

function chainLinksFromTrace(trace: TraceViewProjection): TruthGraphLink[] {
  const links: TruthGraphLink[] = [];

  if (trace.chain.converterId) {
    links.push({ entityType: "converter", entityId: trace.chain.converterId, label: "Converter", state: "captured" });
  }
  if (trace.chain.boxId) {
    links.push({ entityType: "box", entityId: trace.chain.boxId, label: trace.chain.boxCode ?? "Box", state: "boxed" });
  }
  if (trace.chain.queueId) {
    links.push({ entityType: "queue", entityId: trace.chain.queueId, label: trace.chain.queueCode ?? "Queue", state: "processing" });
  }
  for (const shipmentId of trace.chain.shipmentIds) {
    links.push({ entityType: "shipment", entityId: shipmentId, label: `Shipment ${shipmentId.slice(0, 8)}`, state: "in_transit" });
  }
  for (const sampleId of trace.chain.sampleIds) {
    links.push({ entityType: "sample", entityId: sampleId, label: `Sample ${sampleId.slice(0, 8)}`, state: "sampled" });
  }
  for (const ledgerId of trace.chain.ledgerEntryIds) {
    links.push({ entityType: "ledger_entry", entityId: ledgerId, label: `Ledger ${ledgerId.slice(0, 8)}`, state: "posted" });
  }
  for (const reconciliationCaseId of trace.chain.reconciliationCaseIds) {
    links.push({
      entityType: "reconciliation_case",
      entityId: reconciliationCaseId,
      label: `Reconciliation ${reconciliationCaseId.slice(0, 8)}`,
      state: "open",
    });
  }
  if (trace.chain.settlementId) {
    links.push({ entityType: "settlement", entityId: trace.chain.settlementId, label: "Settlement", state: "finalized" });
  }

  return links;
}

async function buildQueueFacts(db: DcsDb, queueId: string, queueCode: string): Promise<QueueFacts> {
  const queueRows = await db
    .select({
      queueId: queues.queueId,
      queueCode: queues.queueCode,
      queueState: queues.state,
      estimatedValueUsd: queues.estimatedValueUsd,
      lockedForProcessing: queues.lockedForProcessing,
    })
    .from(queues)
    .where(eq(queues.queueId, queueId))
    .limit(1);
  if (queueRows.length === 0) {
    throw new Error(`Queue ${queueId} not found while building queue facts.`);
  }

  const queueRow = queueRows[0];
  const boxRows = await db
    .select({ boxId: queueBoxes.boxId })
    .from(queueBoxes)
    .where(eq(queueBoxes.queueId, queueId));
  const boxIds = boxRows.map((row) => row.boxId);
  const boxMaterialRows =
    boxIds.length === 0
      ? []
      : await db
          .select({
            materialType: boxes.materialType,
            count: sql<number>`count(*)::int`,
          })
          .from(boxes)
          .where(inArray(boxes.boxId, boxIds))
          .groupBy(boxes.materialType);
  const materialPriority = new Map<string, number>([
    ["processed_catalyst", 4],
    ["catalyst_processed", 4],
    ["whole_converter", 3],
    ["converter_whole", 3],
    ["dust_recovery", 2],
    ["baghouse_dust", 2],
  ]);
  let materialForm = "mixed_unknown";
  let materialScore = -1;
  for (const row of boxMaterialRows) {
    const normalized = row.materialType.toLowerCase();
    const score = materialPriority.get(normalized) ?? 1;
    if (score > materialScore) {
      materialScore = score;
      materialForm = normalized;
    }
  }

  const converterRows =
    boxIds.length === 0
      ? []
      : await db
          .select({ converterId: boxConverters.converterId, evidenceBundleId: converters.evidenceBundleId })
          .from(boxConverters)
          .leftJoin(converters, eq(converters.converterId, boxConverters.converterId))
          .where(inArray(boxConverters.boxId, boxIds));

  const evidenceBundleIds = converterRows
    .map((row) => row.evidenceBundleId)
    .filter((bundleId): bundleId is string => Boolean(bundleId));

  const evidenceCountRows =
    evidenceBundleIds.length === 0
      ? [{ count: 0 }]
      : await db
          .select({ count: sql<number>`count(*)::int` })
          .from(evidenceArtifacts)
          .where(inArray(evidenceArtifacts.evidenceBundleId, evidenceBundleIds));

  const sampleRows = await db
    .select({ sampleId: samples.sampleId, source: samples.source })
    .from(samples)
    .where(eq(samples.queueId, queueId));

  const ledgerRows = await db
    .select({ ledgerEntryId: ledgerEntries.ledgerEntryId, amountUsd: ledgerEntries.amountUsd })
    .from(ledgerEntries)
    .where(or(eq(ledgerEntries.sourceOperationalRef, queueId), eq(ledgerEntries.sourceOperationalRef, queueCode)));

  const reconRows = await db
    .select({
      reconciliationCaseId: reconciliationCases.reconciliationCaseId,
      status: reconciliationCases.status,
    })
    .from(reconciliationCases)
    .where(
      or(
        eq(reconciliationCases.scopeId, queueId),
        eq(reconciliationCases.scopeId, queueCode),
      ),
    );

  const settlementRows = await db
    .select({
      settlementId: settlements.settlementId,
      status: settlements.status,
      finalValueUsd: settlements.finalValueUsd,
    })
    .from(settlements)
    .where(or(eq(settlements.scopeId, queueId), eq(settlements.scopeId, queueCode)))
    .orderBy(desc(settlements.createdAt))
    .limit(1);

  const hedgeRows = await db
    .select({ status: hedgePositions.status })
    .from(hedgePositions)
    .where(or(eq(hedgePositions.scopeId, queueId), eq(hedgePositions.scopeId, queueCode)));

  return {
    queueId: queueRow.queueId,
    queueCode: queueRow.queueCode,
    queueState: queueRow.queueState,
    materialForm,
    boxCount: boxIds.length,
    converterCount: converterRows.length,
    sampleCount: sampleRows.length,
    icpFinalCount: sampleRows.filter((row) => row.source === "icp_final").length,
    evidenceArtifactCount: evidenceCountRows[0]?.count ?? 0,
    ledgerEntryCount: ledgerRows.length,
    linkedLedgerAmountUsd: ledgerRows
      .reduce((accumulator, row) => accumulator + Number(row.amountUsd), 0)
      .toFixed(2),
    openReconciliationCount: reconRows.filter((row) => row.status === "open" || row.status === "investigating").length,
    settlementStatus: settlementRows[0]?.status ?? null,
    settlementId: settlementRows[0]?.settlementId ?? null,
    settlementValueUsd: settlementRows[0]?.finalValueUsd ?? null,
    estimatedValueUsd: queueRow.estimatedValueUsd,
    hedgeCount: hedgeRows.length,
    closedHedgeCount: hedgeRows.filter((row) => row.status === "closed").length,
    lockedForProcessing: queueRow.lockedForProcessing,
  };
}

function queueCompletenessFromFacts(facts: QueueFacts): ChainCompletenessProjection {
  const missing: string[] = [];
  if (facts.converterCount === 0) missing.push("field_capture");
  if (facts.boxCount === 0) missing.push("box_assignment");
  if (!facts.lockedForProcessing) missing.push("queue_lock");
  if (facts.sampleCount === 0) missing.push("sample_recorded");
  if (facts.icpFinalCount === 0 && facts.settlementStatus !== "finalized") missing.push("final_assay");
  if (facts.estimatedValueUsd === null) missing.push("pricing_estimate");
  if (facts.hedgeCount === 0) missing.push("hedge_opened");
  if (facts.closedHedgeCount === 0 && facts.settlementStatus !== "finalized") missing.push("hedge_closure");
  if (facts.ledgerEntryCount === 0) missing.push("ledger_binding");
  if (!facts.settlementStatus) missing.push("settlement_started");
  if (facts.settlementStatus !== "finalized") missing.push("invoice_finalization");

  return {
    complete: 11 - missing.length,
    total: 11,
    missing,
  };
}

async function settlementCompleteness(
  db: DcsDb,
  settlementId: string,
  scopeId: string,
  status: string,
): Promise<ChainCompletenessProjection> {
  const queueRows = await db
    .select({ queueId: queues.queueId, queueCode: queues.queueCode })
    .from(queues)
    .where(queueRefCondition(scopeId))
    .limit(1);
  const queue = queueRows[0] ?? null;

  const sampleCountRows =
    queue === null
      ? [{ count: 0 }]
      : await db
          .select({ count: sql<number>`count(*)::int` })
          .from(samples)
          .where(eq(samples.queueId, queue.queueId));

  const stepRows = await db
    .select({ stepName: settlementSteps.stepName })
    .from(settlementSteps)
    .where(eq(settlementSteps.settlementId, settlementId));

  const invoiceRows = await db
    .select({ invoiceId: invoices.invoiceId, status: invoices.status })
    .from(invoices)
    .where(eq(invoices.settlementId, settlementId));

  const hedgeRows =
    queue === null
      ? []
      : await db
          .select({ hedgePositionId: hedgePositions.hedgePositionId, status: hedgePositions.status })
          .from(hedgePositions)
          .where(or(eq(hedgePositions.scopeId, queue.queueId), eq(hedgePositions.scopeId, queue.queueCode)));

  const ledgerRows = await db
    .select({ ledgerEntryId: ledgerEntries.ledgerEntryId })
    .from(ledgerEntries)
    .where(or(eq(ledgerEntries.sourceOperationalRef, settlementId), eq(ledgerEntries.sourceOperationalRef, scopeId)));

  const missing: string[] = [];
  if (!queue) missing.push("queue_link");
  if (sampleCountRows[0]?.count === 0) missing.push("sample_data");
  if (!stepRows.some((row) => row.stepName === "final_value_calculated") && status !== "finalized") missing.push("final_value_calculated");
  if (hedgeRows.length === 0) missing.push("hedge_association");
  if (ledgerRows.length === 0) missing.push("ledger_impact");
  if (status !== "finalized") missing.push("final_assay");
  if (invoiceRows.length === 0) missing.push("invoice_generated");
  if (invoiceRows.length > 0 && !invoiceRows.every((row) => row.status === "final")) missing.push("invoice_finalized");
  if (status === "finalized" && !stepRows.some((row) => row.stepName === "invoice_finalized")) missing.push("step_history_gap");

  const total = 11;
  const complete = Math.max(0, total - missing.length);
  return { complete, total, missing };
}

function linksAround(
  links: readonly TruthGraphLink[],
  entityType: GraphEntityType,
  entityId: string,
): { upstream: TruthGraphLink[]; downstream: TruthGraphLink[] } {
  const idx = links.findIndex((link) => link.entityType === entityType && link.entityId === entityId);
  if (idx < 0) {
    return {
      upstream: links.slice(0, Math.max(0, links.length - 1)),
      downstream: links.length > 0 ? [links[links.length - 1]] : [],
    };
  }

  return {
    upstream: links.slice(0, idx),
    downstream: links.slice(idx + 1),
  };
}

function candidateTraceAnchor(
  entityType: GraphEntityType,
  entityId: string,
  queueId: string | null,
  settlementId: string | null,
  ledgerEntryId: string | null,
): { type: TraceEntityType; id: string } | null {
  if (
    entityType === "converter" ||
    entityType === "box" ||
    entityType === "queue" ||
    entityType === "shipment" ||
    entityType === "sample" ||
    entityType === "reconciliation_case" ||
    entityType === "settlement" ||
    entityType === "ledger_entry"
  ) {
    return { type: entityType, id: entityId };
  }

  return null;
}

export async function buildTruthGraphEntityProjection(
  db: DcsDb,
  entityType: GraphEntityType,
  entityId: string,
): Promise<TruthGraphEntityProjection | null> {
  let displayId = entityId;
  let title = `${entityType.replaceAll("_", " ")} ${entityId.slice(0, 8)}`;
  let state = "unknown";
  let updatedAt: Date | null = null;
  let queueRefId: string | null = null;
  let queueRefCode: string | null = null;
  let settlementRefId: string | null = null;
  let ledgerRefId: string | null = null;
  let materialFormHint: string | null = null;
  let reconciliationRef:
    | {
        reconciliationCaseId: string;
        triggerType: string;
        severity: string;
        status: string;
        scopeType: string;
        scopeId: string;
      }
    | null = null;

  if (entityType === "queue") {
    const rows = await db
      .select({ queueId: queues.queueId, queueCode: queues.queueCode, state: queues.state, createdAt: queues.createdAt })
      .from(queues)
      .where(
        isUuid(entityId)
          ? or(eq(queues.queueId, entityId), eq(queues.queueCode, entityId))
          : eq(queues.queueCode, entityId),
      )
      .limit(1);
    if (rows.length === 0) return null;
    queueRefId = rows[0].queueId;
    queueRefCode = rows[0].queueCode;
    displayId = rows[0].queueCode;
    title = `Queue ${rows[0].queueCode}`;
    state = rows[0].state;
    updatedAt = rows[0].createdAt;
    entityId = rows[0].queueId;
  }

  if (entityType === "converter") {
    const rows = await db
      .select({ converterId: converters.converterId, vinOrSerial: converters.vinOrSerial, state: converters.state, capturedAt: converters.capturedAt })
      .from(converters)
      .where(eq(converters.converterId, entityId))
      .limit(1);
    if (rows.length === 0) return null;
    displayId = rows[0].vinOrSerial ?? rows[0].converterId.slice(0, 8);
    title = `Converter ${displayId}`;
    state = rows[0].state;
    updatedAt = rows[0].capturedAt;
  }

  if (entityType === "box") {
    const rows = await db
      .select({
        boxId: boxes.boxId,
        externalCode: boxes.externalCode,
        state: boxes.state,
        materialType: boxes.materialType,
        createdAt: boxes.createdAt,
      })
      .from(boxes)
      .where(
        isUuid(entityId)
          ? or(eq(boxes.boxId, entityId), eq(boxes.externalCode, entityId))
          : eq(boxes.externalCode, entityId),
      )
      .limit(1);
    if (rows.length === 0) return null;
    displayId = rows[0].externalCode;
    title = `Box ${rows[0].externalCode}`;
    state = rows[0].state;
    materialFormHint = rows[0].materialType;
    updatedAt = rows[0].createdAt;
    entityId = rows[0].boxId;
  }

  if (entityType === "sample") {
    const rows = await db
      .select({ sampleId: samples.sampleId, queueId: samples.queueId, source: samples.source, capturedAt: samples.capturedAt })
      .from(samples)
      .where(eq(samples.sampleId, entityId))
      .limit(1);
    if (rows.length === 0) return null;
    displayId = rows[0].sampleId.slice(0, 8);
    title = `Sample ${rows[0].source}`;
    state = rows[0].source;
    updatedAt = rows[0].capturedAt;
    queueRefId = rows[0].queueId;
  }

  if (entityType === "shipment") {
    const rows = await db
      .select({ shipmentId: shipments.shipmentId, shipmentCode: shipments.shipmentCode, state: shipments.state, departedAt: shipments.departedAt })
      .from(shipments)
      .where(
        isUuid(entityId)
          ? or(eq(shipments.shipmentId, entityId), eq(shipments.shipmentCode, entityId))
          : eq(shipments.shipmentCode, entityId),
      )
      .limit(1);
    if (rows.length === 0) return null;
    displayId = rows[0].shipmentCode;
    title = `Shipment ${rows[0].shipmentCode}`;
    state = rows[0].state;
    updatedAt = rows[0].departedAt;
    entityId = rows[0].shipmentId;

    const boxRows = await db
      .select({ boxId: shipmentBoxes.boxId })
      .from(shipmentBoxes)
      .where(eq(shipmentBoxes.shipmentId, rows[0].shipmentId));
    const boxIds = boxRows.map((row) => row.boxId);
    if (boxIds.length > 0) {
      const queueRows = await db
        .select({ queueId: queueBoxes.queueId, queueCode: queues.queueCode })
        .from(queueBoxes)
        .leftJoin(queues, eq(queues.queueId, queueBoxes.queueId))
        .where(inArray(queueBoxes.boxId, boxIds))
        .limit(1);
      if (queueRows.length > 0 && queueRows[0].queueCode) {
        queueRefId = queueRows[0].queueId;
        queueRefCode = queueRows[0].queueCode;
      }
    }
  }

  if (entityType === "ledger_entry") {
    const rows = await db
      .select({ ledgerEntryId: ledgerEntries.ledgerEntryId, purposeCode: ledgerEntries.purposeCode, sourceOperationalRef: ledgerEntries.sourceOperationalRef, createdAt: ledgerEntries.createdAt })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.ledgerEntryId, entityId))
      .limit(1);
    if (rows.length === 0) return null;
    displayId = rows[0].ledgerEntryId.slice(0, 8);
    title = `Ledger ${rows[0].purposeCode}`;
    state = rows[0].purposeCode;
    updatedAt = rows[0].createdAt;
    ledgerRefId = rows[0].ledgerEntryId;

    const queueRows = await db
      .select({ queueId: queues.queueId, queueCode: queues.queueCode })
      .from(queues)
      .where(queueRefCondition(rows[0].sourceOperationalRef))
      .limit(1);
    if (queueRows.length > 0) {
      queueRefId = queueRows[0].queueId;
      queueRefCode = queueRows[0].queueCode;
    }
  }

  if (entityType === "settlement") {
    const rows = await db
      .select({ settlementId: settlements.settlementId, scopeId: settlements.scopeId, status: settlements.status, finalizedAt: settlements.finalizedAt, createdAt: settlements.createdAt })
      .from(settlements)
      .where(eq(settlements.settlementId, entityId))
      .limit(1);
    if (rows.length === 0) return null;
    settlementRefId = rows[0].settlementId;
    displayId = rows[0].settlementId.slice(0, 8);
    title = `Settlement ${rows[0].scopeId}`;
    state = rows[0].status;
    updatedAt = rows[0].finalizedAt ?? rows[0].createdAt;

    const queueRows = await db
      .select({ queueId: queues.queueId, queueCode: queues.queueCode })
      .from(queues)
      .where(queueRefCondition(rows[0].scopeId))
      .limit(1);
    if (queueRows.length > 0) {
      queueRefId = queueRows[0].queueId;
      queueRefCode = queueRows[0].queueCode;
    }
  }

  if (entityType === "reconciliation_case") {
    const rows = await db
      .select({
        reconciliationCaseId: reconciliationCases.reconciliationCaseId,
        scopeType: reconciliationCases.scopeType,
        scopeId: reconciliationCases.scopeId,
        severity: reconciliationCases.severity,
        status: reconciliationCases.status,
        openedAt: reconciliationCases.openedAt,
        triggerType: reconciliationCases.triggerType,
      })
      .from(reconciliationCases)
      .where(eq(reconciliationCases.reconciliationCaseId, entityId))
      .limit(1);
    if (rows.length === 0) return null;
    displayId = rows[0].reconciliationCaseId.slice(0, 8);
    title = `Reconciliation ${rows[0].triggerType}`;
    state = rows[0].status;
    updatedAt = rows[0].openedAt;
    reconciliationRef = {
      reconciliationCaseId: rows[0].reconciliationCaseId,
      triggerType: rows[0].triggerType,
      severity: rows[0].severity,
      status: rows[0].status,
      scopeType: rows[0].scopeType,
      scopeId: rows[0].scopeId,
    };

    if (rows[0].scopeType === "queue") {
      const queueRows = await db
        .select({ queueId: queues.queueId, queueCode: queues.queueCode })
        .from(queues)
        .where(queueRefCondition(rows[0].scopeId))
        .limit(1);
      if (queueRows.length > 0) {
        queueRefId = queueRows[0].queueId;
        queueRefCode = queueRows[0].queueCode;
      }
    }
    if (rows[0].scopeType === "ledger") {
      ledgerRefId = rows[0].scopeId;
    }
    if (rows[0].scopeType === "shipment") {
      const shipmentRows = await db
        .select({ shipmentId: shipments.shipmentId, shipmentCode: shipments.shipmentCode })
        .from(shipments)
        .where(shipmentRefCondition(rows[0].scopeId))
        .limit(1);
      const shipment = shipmentRows[0];
      if (shipment) {
        const shipmentBoxRows = await db
          .select({ boxId: shipmentBoxes.boxId })
          .from(shipmentBoxes)
          .where(eq(shipmentBoxes.shipmentId, shipment.shipmentId));
        const boxIds = shipmentBoxRows.map((row) => row.boxId);
        if (boxIds.length > 0) {
          const queueRows = await db
            .select({ queueId: queueBoxes.queueId, queueCode: queues.queueCode })
            .from(queueBoxes)
            .leftJoin(queues, eq(queues.queueId, queueBoxes.queueId))
            .where(inArray(queueBoxes.boxId, boxIds))
            .limit(1);
          if (queueRows.length > 0 && queueRows[0].queueCode) {
            queueRefId = queueRows[0].queueId;
            queueRefCode = queueRows[0].queueCode;
          }
        }
      }
    }
    if (rows[0].scopeType === "lot") {
      const settlementRows = await db
        .select({ settlementId: settlements.settlementId })
        .from(settlements)
        .where(eq(settlements.scopeId, rows[0].scopeId))
        .limit(1);
      settlementRefId = settlementRows[0]?.settlementId ?? null;
    }
  }

  if (state === "unknown") {
    return null;
  }

  const anchor = candidateTraceAnchor(entityType, entityId, queueRefId, settlementRefId, ledgerRefId);
  let trace: TraceViewProjection | null = null;
  if (anchor) {
    try {
      trace = await buildTraceViewProjection(db, anchor.type, anchor.id);
    } catch {
      trace = null;
    }
  }

  const links = trace ? chainLinksFromTrace(trace) : [];
  const { upstream, downstream } = linksAround(links, entityType, entityId);

  if (!queueRefId && trace?.chain.queueId) {
    queueRefId = trace.chain.queueId;
    queueRefCode = trace.chain.queueCode;
  }
  if (!settlementRefId && trace?.chain.settlementId) {
    settlementRefId = trace.chain.settlementId;
  }

  const queueFacts = queueRefId
    ? await buildQueueFacts(db, queueRefId, queueRefCode ?? queueRefId)
    : null;

  const chainCompleteness =
    entityType === "settlement" && settlementRefId
      ? await settlementCompleteness(db, settlementRefId, queueRefCode ?? queueRefId ?? settlementRefId, state)
      : queueFacts
        ? queueCompletenessFromFacts(queueFacts)
        : { complete: 0, total: 11, missing: ["queue_link"] };

  const evidenceBundleIds = new Set<string>();
  for (const step of trace?.steps ?? []) {
    if (step.evidence?.evidenceBundleId) {
      evidenceBundleIds.add(step.evidence.evidenceBundleId);
    }
  }

  const evidenceBundleRows =
    evidenceBundleIds.size === 0
      ? []
      : await db
          .select({
            bundleId: evidenceBundles.evidenceBundleId,
            capturedAt: evidenceBundles.capturedAt,
            lat: evidenceBundles.gpsLat,
            lon: evidenceBundles.gpsLon,
            accuracyM: evidenceBundles.gpsAccuracyM,
            user: users.displayName,
            device: devices.externalRef,
            artifactCount: sql<number>`count(${evidenceArtifacts.artifactId})::int`,
          })
          .from(evidenceBundles)
          .leftJoin(evidenceArtifacts, eq(evidenceArtifacts.evidenceBundleId, evidenceBundles.evidenceBundleId))
          .leftJoin(users, eq(users.userId, evidenceBundles.createdByUserId))
          .leftJoin(devices, eq(devices.deviceId, evidenceBundles.createdByDeviceId))
          .where(inArray(evidenceBundles.evidenceBundleId, [...evidenceBundleIds]))
          .groupBy(
            evidenceBundles.evidenceBundleId,
            evidenceBundles.capturedAt,
            evidenceBundles.gpsLat,
            evidenceBundles.gpsLon,
            evidenceBundles.gpsAccuracyM,
            users.displayName,
            devices.externalRef,
          )
          .orderBy(desc(evidenceBundles.capturedAt));

  const artifactTypeRows =
    evidenceBundleIds.size === 0
      ? []
      : await db
          .select({ bundleId: evidenceArtifacts.evidenceBundleId, evidenceType: evidenceArtifacts.evidenceType })
          .from(evidenceArtifacts)
          .where(inArray(evidenceArtifacts.evidenceBundleId, [...evidenceBundleIds]));
  const artifactTypesByBundle = new Map<string, Set<string>>();
  for (const row of artifactTypeRows) {
    const set = artifactTypesByBundle.get(row.bundleId) ?? new Set<string>();
    set.add(row.evidenceType);
    artifactTypesByBundle.set(row.bundleId, set);
  }

  const financialRefs = [
    queueRefId,
    queueRefCode,
    settlementRefId,
    ...(trace?.chain.ledgerEntryIds ?? []),
  ].filter((value): value is string => Boolean(value));

  const ledgerRows =
    financialRefs.length === 0
      ? []
      : await (async () => {
          const ledgerIdRefs = financialRefs.filter((value) => isUuid(value));
          const base = db
            .select({
              ledgerEntryId: ledgerEntries.ledgerEntryId,
              purposeCode: ledgerEntries.purposeCode,
              amountUsd: ledgerEntries.amountUsd,
              sourceOperationalRef: ledgerEntries.sourceOperationalRef,
              createdAt: ledgerEntries.createdAt,
            })
            .from(ledgerEntries);
          if (ledgerIdRefs.length === 0) {
            return base
              .where(inArray(ledgerEntries.sourceOperationalRef, financialRefs))
              .orderBy(desc(ledgerEntries.createdAt));
          }
          return base
            .where(
              or(
                inArray(ledgerEntries.sourceOperationalRef, financialRefs),
                inArray(ledgerEntries.ledgerEntryId, ledgerIdRefs),
              ),
            )
            .orderBy(desc(ledgerEntries.createdAt));
        })();

  const reconciliationRows =
    financialRefs.length === 0
      ? []
      : await db
          .select({
            reconciliationCaseId: reconciliationCases.reconciliationCaseId,
            triggerType: reconciliationCases.triggerType,
            severity: reconciliationCases.severity,
            status: reconciliationCases.status,
            scopeType: reconciliationCases.scopeType,
            scopeId: reconciliationCases.scopeId,
            openedAt: reconciliationCases.openedAt,
            closedAt: reconciliationCases.closedAt,
            actionCount: sql<number>`count(${reconciliationActions.reconciliationActionId})::int`,
          })
          .from(reconciliationCases)
          .leftJoin(reconciliationActions, eq(reconciliationActions.reconciliationCaseId, reconciliationCases.reconciliationCaseId))
          .where(inArray(reconciliationCases.scopeId, financialRefs))
          .groupBy(
            reconciliationCases.reconciliationCaseId,
            reconciliationCases.triggerType,
            reconciliationCases.severity,
            reconciliationCases.status,
            reconciliationCases.scopeType,
            reconciliationCases.scopeId,
            reconciliationCases.openedAt,
            reconciliationCases.closedAt,
          )
          .orderBy(desc(reconciliationCases.openedAt));

  const settlementSnapshots =
    settlementRefId
      ? await db
          .select({
            settlementId: settlements.settlementId,
            status: settlements.status,
            scopeId: settlements.scopeId,
            estimatedValueUsd: settlements.estimatedValueUsd,
            finalValueUsd: settlements.finalValueUsd,
            varianceUsd: settlements.varianceUsd,
            finalizedAt: settlements.finalizedAt,
          })
          .from(settlements)
          .where(eq(settlements.settlementId, settlementRefId))
          .limit(1)
      : queueRefId || queueRefCode
        ? await db
            .select({
              settlementId: settlements.settlementId,
              status: settlements.status,
              scopeId: settlements.scopeId,
              estimatedValueUsd: settlements.estimatedValueUsd,
              finalValueUsd: settlements.finalValueUsd,
              varianceUsd: settlements.varianceUsd,
              finalizedAt: settlements.finalizedAt,
            })
            .from(settlements)
            .where(
              or(
                ...(queueRefId ? [eq(settlements.scopeId, queueRefId)] : []),
                ...(queueRefCode ? [eq(settlements.scopeId, queueRefCode)] : []),
              ),
            )
            .orderBy(desc(settlements.createdAt))
            .limit(1)
        : [];
  const settlementSnapshot = settlementSnapshots[0] ?? null;
  if (!settlementRefId && settlementSnapshot) {
    settlementRefId = settlementSnapshot.settlementId;
  }

  const estimatedValueUsd = settlementSnapshot?.estimatedValueUsd ?? queueFacts?.estimatedValueUsd ?? null;
  const finalValueUsd = settlementSnapshot?.finalValueUsd ?? null;
  const varianceValue =
    settlementSnapshot?.varianceUsd ??
    (estimatedValueUsd !== null && finalValueUsd !== null
      ? (Number(finalValueUsd) - Number(estimatedValueUsd)).toFixed(2)
      : null);
  const valueLineage =
    estimatedValueUsd !== null || finalValueUsd !== null || varianceValue !== null
      ? {
          estimatedValueUsd,
          finalValueUsd,
          varianceUsd: varianceValue,
          explanation:
            finalValueUsd === null
              ? "Final truth is pending; estimate remains provisional."
              : varianceValue === null
                ? "Final truth exists but variance metadata is incomplete."
                : Math.abs(Number(varianceValue)) < 1
                  ? "Estimated and final value align within tolerance."
                  : Number(varianceValue) > 0
                    ? "Final value exceeded estimate after proof closure."
                    : "Final value came in below estimate after proof closure.",
        }
      : null;

  let divergence: TruthGraphEntityProjection["divergence"] = null;
  if (reconciliationRef) {
    let expected = estimatedValueUsd;
    let observed = finalValueUsd;
    let financialImpact = varianceValue;

    if (reconciliationRef.scopeType === "ledger") {
      const ledgerRows = await db
        .select({
          amountUsd: ledgerEntries.amountUsd,
          sourceOperationalRef: ledgerEntries.sourceOperationalRef,
        })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.ledgerEntryId, reconciliationRef.scopeId))
        .limit(1);
      if (ledgerRows.length > 0) {
        expected = ledgerRows[0].amountUsd;
        const adjustmentRows = await db
          .select({ amountUsd: ledgerEntries.amountUsd })
          .from(ledgerEntries)
          .where(
            or(
              eq(ledgerEntries.sourceOperationalRef, reconciliationRef.scopeId),
              eq(ledgerEntries.sourceOperationalRef, ledgerRows[0].sourceOperationalRef),
            ),
          );
        const observedAmount = adjustmentRows.reduce(
          (accumulator, row) => accumulator + Number(row.amountUsd),
          0,
        );
        observed = observedAmount.toFixed(2);
        financialImpact = (observedAmount - Number(expected)).toFixed(2);
      }
    }

    const confidenceImpact =
      reconciliationRef.status === "resolved" || reconciliationRef.status === "accepted_variance"
        ? "contained"
        : reconciliationRef.severity === "critical" || reconciliationRef.severity === "high"
          ? "reduced_to_low"
          : reconciliationRef.severity === "medium"
            ? "reduced_to_medium"
            : "localized";
    const currentResolutionStep =
      reconciliationRef.status === "open"
        ? "triage_and_scope"
        : reconciliationRef.status === "investigating"
          ? "collecting_counter_evidence"
          : reconciliationRef.status === "accepted_variance"
            ? "variance_accepted_with_controls"
            : "closed_with_additive_correction";
    const variance =
      expected !== null && observed !== null ? (Number(observed) - Number(expected)).toFixed(2) : null;

    divergence = {
      triggerType: reconciliationRef.triggerType,
      expectedValueUsd: expected,
      observedValueUsd: observed,
      varianceUsd: variance,
      financialImpactUsd: financialImpact,
      confidenceImpact,
      currentResolutionStep,
      originScope: `${reconciliationRef.scopeType}:${reconciliationRef.scopeId}`,
      relatedEvidenceBundles: evidenceBundleRows.length,
    };
  }

  const totalLedger = ledgerRows.reduce((accumulator, row) => accumulator + Number(row.amountUsd), 0).toFixed(2);
  const openReconciliationCount = reconciliationRows.filter(
    (row) => row.status === "open" || row.status === "investigating",
  ).length;
  const exposedValueUsd =
    estimatedValueUsd !== null && settlementSnapshot?.status !== "finalized" ? estimatedValueUsd : "0.00";
  const financialStatus: TruthGraphEntityProjection["financial"]["financialStatus"] =
    settlementSnapshot?.status === "finalized"
      ? "finalized"
      : openReconciliationCount > 0
        ? "exposed"
        : settlementSnapshot?.status === "validated"
          ? "reconciled"
          : "provisional";
  const materialForm = queueFacts?.materialForm ?? materialFormHint ?? "mixed_unknown";
  const custodyStatus = queueFacts?.queueState ?? state;

  const firstOrigin = trace?.steps.find((step) => step.origin)?.origin ?? null;
  const lifecycleState =
    entityType === "settlement" ? settlementSnapshot?.status ?? state : state;
  const lifecycleTruthStatus = statusFromState(lifecycleState);
  const lifecycleConfidence: "high" | "medium" | "low" | "unknown" =
    entityType === "settlement" && settlementSnapshot
      ? settlementSnapshot.status === "finalized"
        ? "high"
        : settlementSnapshot.status === "validated"
          ? "medium"
          : "low"
      : confidenceFromTrace(trace);
  const lifecycleValidationStatus =
    entityType === "settlement" && settlementSnapshot
      ? settlementSnapshot.status === "finalized"
        ? "finalized"
        : settlementSnapshot.status === "validated"
          ? "pending_finalization"
          : "pending_finalization"
      : trace?.certaintySummary.finalizationState ?? "unlinked";

  return {
    identity: {
      entityType,
      entityId,
      displayId,
      title,
    },
    lifecycle: {
      state: lifecycleState,
      truthStatus: lifecycleTruthStatus,
      confidence: lifecycleConfidence,
      validationStatus: lifecycleValidationStatus,
      updatedAt: toIso(updatedAt),
    },
    chainCompleteness,
    origin: firstOrigin
      ? {
          sourceSystem: firstOrigin.sourceSystem,
          user: firstOrigin.originUserDisplay ?? firstOrigin.originUserId,
          device: firstOrigin.originDeviceRef ?? firstOrigin.originDeviceId,
          capturedAt: firstOrigin.capturedAt,
        }
      : null,
    evidenceBundles: evidenceBundleRows.map((row) => ({
      bundleId: row.bundleId,
      artifactCount: row.artifactCount,
      types: [...(artifactTypesByBundle.get(row.bundleId) ?? new Set<string>())],
      capturedAt: row.capturedAt.toISOString(),
      capturedByUser: row.user,
      capturedByDevice: row.device,
      gps: {
        lat: row.lat,
        lon: row.lon,
        accuracyM: row.accuracyM,
      },
    })),
    upstream,
    downstream,
    financial: {
      ledgerEntryCount: ledgerRows.length,
      settlementCount: settlementSnapshot ? 1 : 0,
      ledgerAmountUsd: totalLedger,
      estimatedValueUsd,
      exposedValueUsd,
      settlementValueUsd: settlementSnapshot?.finalValueUsd ?? queueFacts?.settlementValueUsd ?? null,
      varianceUsd: varianceValue,
      financialStatus,
      materialForm,
      custodyStatus,
      entries: ledgerRows.map((row) => ({
        ledgerEntryId: row.ledgerEntryId,
        purposeCode: row.purposeCode,
        amountUsd: row.amountUsd,
        sourceOperationalRef: row.sourceOperationalRef,
        createdAt: row.createdAt.toISOString(),
        settlementId: settlementSnapshot?.settlementId ?? settlementRefId,
      })),
    },
    reconciliation: reconciliationRows.map((row) => ({
      reconciliationCaseId: row.reconciliationCaseId,
      triggerType: row.triggerType,
      severity: row.severity,
      status: row.status,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      actionCount: row.actionCount,
      openedAt: row.openedAt.toISOString(),
      closedAt: toIso(row.closedAt),
    })),
    valueLineage,
    divergence,
    related: {
      queueFacts: queueFacts
        ? {
            boxCount: queueFacts.boxCount,
            converterCount: queueFacts.converterCount,
            sampleCount: queueFacts.sampleCount,
            evidenceArtifactCount: queueFacts.evidenceArtifactCount,
            ledgerEntryCount: queueFacts.ledgerEntryCount,
            openReconciliationCount: queueFacts.openReconciliationCount,
          }
        : null,
    },
    actions: {
      fullTraceHref: anchor ? `/trace/${anchor.type}/${anchor.id}` : null,
    },
  };
}

export async function searchTruthGraph(
  db: DcsDb,
  query: string,
  limit = 20,
): Promise<readonly TruthGraphSearchResult[]> {
  const normalized = query.trim();
  if (normalized.length === 0) return [];
  const uuidSearch = isUuid(normalized);
  const pattern = `%${normalized}%`;

  const [queueRows, boxRows, shipmentRows, settlementRows, ledgerRows, converterRows, reconRows] =
    await Promise.all([
      db
        .select({ entityId: queues.queueId, label: queues.queueCode, state: queues.state })
        .from(queues)
        .where(ilike(queues.queueCode, pattern))
        .limit(8),
      db
        .select({ entityId: boxes.boxId, label: boxes.externalCode, state: boxes.state })
        .from(boxes)
        .where(ilike(boxes.externalCode, pattern))
        .limit(8),
      db
        .select({ entityId: shipments.shipmentId, label: shipments.shipmentCode, state: shipments.state })
        .from(shipments)
        .where(ilike(shipments.shipmentCode, pattern))
        .limit(8),
      db
        .select({ entityId: settlements.settlementId, label: settlements.scopeId, state: settlements.status })
        .from(settlements)
        .where(
          uuidSearch
            ? or(eq(settlements.settlementId, normalized), ilike(settlements.scopeId, pattern))
            : ilike(settlements.scopeId, pattern),
        )
        .limit(8),
      db
        .select({ entityId: ledgerEntries.ledgerEntryId, label: ledgerEntries.sourceOperationalRef, state: ledgerEntries.purposeCode })
        .from(ledgerEntries)
        .where(
          uuidSearch
            ? or(eq(ledgerEntries.ledgerEntryId, normalized), ilike(ledgerEntries.sourceOperationalRef, pattern))
            : ilike(ledgerEntries.sourceOperationalRef, pattern),
        )
        .limit(8),
      db
        .select({ entityId: converters.converterId, label: converters.vinOrSerial, state: converters.state })
        .from(converters)
        .where(
          uuidSearch
            ? or(eq(converters.converterId, normalized), ilike(converters.vinOrSerial, pattern))
            : ilike(converters.vinOrSerial, pattern),
        )
        .limit(8),
      db
        .select({ entityId: reconciliationCases.reconciliationCaseId, label: reconciliationCases.scopeId, state: reconciliationCases.status })
        .from(reconciliationCases)
        .where(
          uuidSearch
            ? or(eq(reconciliationCases.reconciliationCaseId, normalized), ilike(reconciliationCases.scopeId, pattern))
            : ilike(reconciliationCases.scopeId, pattern),
        )
        .limit(8),
    ]);

  const results: TruthGraphSearchResult[] = [
    ...queueRows.map((row) => ({ entityType: "queue" as const, entityId: row.entityId, label: row.label, state: row.state, context: "queue" })),
    ...boxRows.map((row) => ({ entityType: "box" as const, entityId: row.entityId, label: row.label, state: row.state, context: "box" })),
    ...shipmentRows.map((row) => ({ entityType: "shipment" as const, entityId: row.entityId, label: row.label, state: row.state, context: "shipment" })),
    ...settlementRows.map((row) => ({ entityType: "settlement" as const, entityId: row.entityId, label: row.label, state: row.state, context: "settlement" })),
    ...ledgerRows.map((row) => ({ entityType: "ledger_entry" as const, entityId: row.entityId, label: row.label, state: row.state, context: "ledger" })),
    ...converterRows.map((row) => ({ entityType: "converter" as const, entityId: row.entityId, label: row.label ?? row.entityId.slice(0, 8), state: row.state, context: "converter" })),
    ...reconRows.map((row) => ({ entityType: "reconciliation_case" as const, entityId: row.entityId, label: row.label, state: row.state, context: "reconciliation" })),
  ];

  return results.slice(0, limit);
}

export async function buildCommandSurfaceProjection(db: DcsDb): Promise<CommandSurfaceProjection> {
  const queueRows = await db
    .select({
      queueId: queues.queueId,
      queueCode: queues.queueCode,
      state: queues.state,
      estimatedValueUsd: queues.estimatedValueUsd,
      createdAt: queues.createdAt,
    })
    .from(queues);

  const queueFacts = await Promise.all(queueRows.map((queue) => buildQueueFacts(db, queue.queueId, queue.queueCode)));
  const completeness = queueFacts.map(queueCompletenessFromFacts);
  const completeSum = completeness.reduce((accumulator, value) => accumulator + value.complete, 0);
  const totalSum = completeness.reduce((accumulator, value) => accumulator + value.total, 0);

  const ledgerRows = await db
    .select({ amountUsd: ledgerEntries.amountUsd, purposeCode: ledgerEntries.purposeCode })
    .from(ledgerEntries);
  const settlementsRows = await db
    .select({ scopeId: settlements.scopeId, varianceUsd: settlements.varianceUsd, status: settlements.status })
    .from(settlements);
  const queueScopeRefs = new Set<string>();
  for (const queue of queueRows) {
    queueScopeRefs.add(queue.queueId);
    queueScopeRefs.add(queue.queueCode);
  }
  const operationalSettlementsRows = settlementsRows.filter((row) => queueScopeRefs.has(row.scopeId));
  const reconciliationRows = await db
    .select({ status: reconciliationCases.status, openedAt: reconciliationCases.openedAt })
    .from(reconciliationCases);
  const shipmentRows = await db
    .select({ state: shipments.state })
    .from(shipments);
  const boxRows = await db
    .select({ state: boxes.state, materialType: boxes.materialType })
    .from(boxes);
  const converterRows = await db
    .select({ capturedAt: converters.capturedAt })
    .from(converters);
  const siteRows = await db
    .select({ siteId: sites.siteId })
    .from(sites);

  const pricingRows = await db
    .select({ queueId: pricingDecisions.queueId, confidenceBand: pricingDecisions.confidenceBand })
    .from(pricingDecisions)
    .orderBy(desc(pricingDecisions.decidedAt));
  const latestPricingConfidence = new Map<string, string>();
  for (const row of pricingRows) {
    if (!latestPricingConfidence.has(row.queueId)) {
      latestPricingConfidence.set(row.queueId, row.confidenceBand);
    }
  }

  const hedgeRows = await db
    .select({ scopeId: hedgePositions.scopeId, status: hedgePositions.status })
    .from(hedgePositions);
  const hedgedScope = new Set(hedgeRows.map((row) => row.scopeId));

  const evidenceGapRows = await db
    .select({ converterId: converters.converterId, evidenceBundleId: converters.evidenceBundleId })
    .from(converters);
  const evidenceBundlesIds = evidenceGapRows.map((row) => row.evidenceBundleId);
  const artifactRows = evidenceBundlesIds.length === 0
    ? []
    : await db
        .select({ evidenceBundleId: evidenceArtifacts.evidenceBundleId, evidenceType: evidenceArtifacts.evidenceType })
        .from(evidenceArtifacts)
        .where(inArray(evidenceArtifacts.evidenceBundleId, evidenceBundlesIds));
  const artifactTypeMap = new Map<string, Set<string>>();
  for (const artifact of artifactRows) {
    const set = artifactTypeMap.get(artifact.evidenceBundleId) ?? new Set<string>();
    set.add(artifact.evidenceType);
    artifactTypeMap.set(artifact.evidenceBundleId, set);
  }
  const evidenceGaps = evidenceGapRows.filter((row) => {
    const set = artifactTypeMap.get(row.evidenceBundleId);
    if (!set) return true;
    return !set.has("image") || !set.has("gps");
  }).length;

  const now = Date.now();
  const oldestCaptureDays = converterRows.length === 0
    ? 0
    : Math.max(...converterRows.map((row) => Math.floor((now - row.capturedAt.getTime()) / 86_400_000)));

  const assayQueues = queueRows.filter((queue) => queue.state === "assay_pending");
  const avgAssayWaitDays = assayQueues.length === 0
    ? 0
    : Math.round(
        assayQueues.reduce((accumulator, queue) => accumulator + (now - queue.createdAt.getTime()) / 86_400_000, 0) /
          assayQueues.length,
      );

  const unresolvedDivergence = reconciliationRows.filter(
    (row) => row.status === "open" || row.status === "investigating",
  );
  const oldestOpenDivergenceDays = unresolvedDivergence.length === 0
    ? 0
    : Math.max(...unresolvedDivergence.map((row) => Math.floor((now - row.openedAt.getTime()) / 86_400_000)));

  const totalCapital = ledgerRows
    .filter((row) => row.purposeCode === "funding_advance" || row.purposeCode === "field_purchase")
    .reduce((accumulator, row) => accumulator + Number(row.amountUsd), 0);

  const unprovenExposure = queueFacts
    .filter((row) => row.settlementStatus !== "finalized")
    .reduce((accumulator, row) => accumulator + Number(row.estimatedValueUsd ?? "0"), 0);

  const pendingAssayValue = queueFacts
    .filter((row) => row.queueState === "assay_pending" || row.queueState === "sampled")
    .reduce((accumulator, row) => accumulator + Number(row.estimatedValueUsd ?? "0"), 0);

  const pendingSettlementValue = queueFacts
    .filter((row) => row.settlementStatus !== "finalized")
    .reduce((accumulator, row) => accumulator + Number(row.estimatedValueUsd ?? "0"), 0);

  const lowConfidenceExposure = queueFacts
    .filter((row) => {
      const confidence = latestPricingConfidence.get(row.queueId);
      return confidence === "low" || confidence === undefined;
    })
    .reduce((accumulator, row) => accumulator + Number(row.estimatedValueUsd ?? "0"), 0);

  const processingBacklog = queueRows.filter((queue) => queue.state === "processing" || queue.state === "open").length;
  const materialInTransit = shipmentRows.filter((shipment) => shipment.state === "in_transit" || shipment.state === "discrepant").length;

  const varianceTotal = operationalSettlementsRows.reduce(
    (accumulator, row) => accumulator + Math.abs(Number(row.varianceUsd ?? "0")),
    0,
  );

  const openDivergenceImpact = queueFacts
    .filter((row) => row.openReconciliationCount > 0)
    .reduce((accumulator, row) => accumulator + Number(row.estimatedValueUsd ?? "0"), 0);

  function boxValue(materialType: string): number {
    const normalized = materialType.toLowerCase();
    if (normalized === "processed_catalyst" || normalized === "catalyst_processed") return 145_000;
    if (normalized === "whole_converter" || normalized === "converter_whole") return 12_500;
    if (normalized === "dust_recovery" || normalized === "baghouse_dust") return 48_000;
    return 35_000;
  }

  const boxValueRows = boxRows.map((row) => ({
    valueUsd: boxValue(row.materialType),
    state: row.state,
    materialType: row.materialType.toLowerCase(),
  }));
  const materialInTransitUsd = boxValueRows
    .filter((row) => row.state === "shipped")
    .reduce((accumulator, row) => accumulator + row.valueUsd, 0);
  const materialInCustodyUsd = boxValueRows
    .filter((row) => row.state !== "retired" && row.state !== "shipped")
    .reduce((accumulator, row) => accumulator + row.valueUsd, 0);
  const processedCatalystValueUsd = boxValueRows
    .filter((row) => row.materialType === "processed_catalyst" || row.materialType === "catalyst_processed")
    .reduce((accumulator, row) => accumulator + row.valueUsd, 0);
  const wholeConverterValueUsd = boxValueRows
    .filter((row) => row.materialType === "whole_converter" || row.materialType === "converter_whole")
    .reduce((accumulator, row) => accumulator + row.valueUsd, 0);
  const estimatedFloorValue = queueFacts.reduce(
    (accumulator, row) => accumulator + Number(row.estimatedValueUsd ?? "0"),
    0,
  );
  const materialValueUnderControl = Math.max(estimatedFloorValue, materialInCustodyUsd + materialInTransitUsd);

  const hedgeCoveragePercent = queueFacts.length === 0
    ? 0
    : Math.round(
        (queueFacts.filter((row) => hedgedScope.has(row.queueId) || hedgedScope.has(row.queueCode)).length /
          queueFacts.length) *
          100,
      );

  return {
    generatedAt: new Date().toISOString(),
    totalCapitalDeployedUsd: totalCapital.toFixed(2),
    materialValueUnderControlUsd: materialValueUnderControl.toFixed(2),
    estimatedFloorValueUsd: estimatedFloorValue.toFixed(2),
    floorInventoryValueUsd: estimatedFloorValue.toFixed(2),
    materialInCustodyUsd: materialInCustodyUsd.toFixed(2),
    materialInTransitUsd: materialInTransitUsd.toFixed(2),
    processedCatalystValueUsd: processedCatalystValueUsd.toFixed(2),
    wholeConverterValueUsd: wholeConverterValueUsd.toFixed(2),
    pendingSettlementValueUsd: pendingSettlementValue.toFixed(2),
    pendingAssayValueUsd: pendingAssayValue.toFixed(2),
    unprovenExposureUsd: unprovenExposure.toFixed(2),
    unprovenCapitalExposureUsd: unprovenExposure.toFixed(2),
    lowConfidenceExposureUsd: lowConfidenceExposure.toFixed(2),
    openDivergenceImpactUsd: openDivergenceImpact.toFixed(2),
    queuesAwaitingAssay: assayQueues.length,
    openDivergences: unresolvedDivergence.length,
    evidenceGaps,
    chainCompleteness: {
      complete: completeSum,
      total: totalSum,
      percent: totalSum === 0 ? 0 : Math.round((completeSum / totalSum) * 100),
    },
    activeSites: siteRows.length,
    materialInTransit,
    processingBacklog,
    estimatedVsFinalVarianceUsd: varianceTotal.toFixed(2),
    settlementVarianceUsd: varianceTotal.toFixed(2),
    hedgeCoveragePercent,
    agingRisk: {
      oldestCaptureDays,
      avgAssayWaitDays,
      oldestOpenDivergenceDays,
    },
  };
}
