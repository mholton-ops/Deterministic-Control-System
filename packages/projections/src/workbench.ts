import { desc, eq, inArray, sql } from "drizzle-orm";
import type { DcsDb } from "@dcs/db";
import {
  boxConverters,
  boxes,
  converters,
  correctionMatrices,
  custodyEvents,
  devices,
  evidenceArtifacts,
  evidenceBundles,
  gradingDecisions,
  hedgePositions,
  invoices,
  ledgerEntries,
  libraryEntries,
  massMeasurements,
  pricingDecisions,
  queueBoxes,
  queues,
  reconciliationActions,
  reconciliationCases,
  samples,
  settlements,
  shipmentBoxes,
  shipments,
  sites,
  transactionEnvelopes,
  users,
} from "@dcs/db";

import { buildQueueExposureProjection } from "./projections";

export interface FieldIntakeProjectionRow {
  readonly converterId: string;
  readonly state: string;
  readonly vinOrSerial: string | null;
  readonly capturedAt: string;
  readonly siteCode: string | null;
  readonly boxCode: string | null;
  readonly evidenceBundleId: string;
  readonly evidenceArtifactCount: number;
  readonly originUserDisplay: string | null;
  readonly originDeviceRef: string | null;
}

export async function buildFieldIntakeProjection(
  db: DcsDb,
): Promise<readonly FieldIntakeProjectionRow[]> {
  const rows = await db
    .select({
      converterId: converters.converterId,
      state: converters.state,
      vinOrSerial: converters.vinOrSerial,
      capturedAt: converters.capturedAt,
      siteCode: sites.siteCode,
      boxCode: boxes.externalCode,
      evidenceBundleId: converters.evidenceBundleId,
      evidenceArtifactCount: sql<number>`count(${evidenceArtifacts.artifactId})::int`,
      originUserDisplay: users.displayName,
      originDeviceRef: devices.externalRef,
    })
    .from(converters)
    .leftJoin(sites, eq(sites.siteId, converters.capturedSiteId))
    .leftJoin(boxes, eq(boxes.boxId, converters.currentBoxId))
    .leftJoin(evidenceBundles, eq(evidenceBundles.evidenceBundleId, converters.evidenceBundleId))
    .leftJoin(evidenceArtifacts, eq(evidenceArtifacts.evidenceBundleId, converters.evidenceBundleId))
    .leftJoin(users, eq(users.userId, evidenceBundles.createdByUserId))
    .leftJoin(devices, eq(devices.deviceId, evidenceBundles.createdByDeviceId))
    .groupBy(
      converters.converterId,
      converters.state,
      converters.vinOrSerial,
      converters.capturedAt,
      sites.siteCode,
      boxes.externalCode,
      converters.evidenceBundleId,
      users.displayName,
      devices.externalRef,
    )
    .orderBy(desc(converters.capturedAt));

  return rows.map((row) => ({
    converterId: row.converterId,
    state: row.state,
    vinOrSerial: row.vinOrSerial,
    capturedAt: row.capturedAt.toISOString(),
    siteCode: row.siteCode,
    boxCode: row.boxCode,
    evidenceBundleId: row.evidenceBundleId,
    evidenceArtifactCount: row.evidenceArtifactCount,
    originUserDisplay: row.originUserDisplay,
    originDeviceRef: row.originDeviceRef,
  }));
}

export interface CustodyBoxProjectionRow {
  readonly boxId: string;
  readonly boxCode: string;
  readonly state: string;
  readonly materialType: string;
  readonly converterCount: number;
  readonly evidenceArtifactCount: number;
  readonly representativeEvidence: readonly {
    artifactId: string;
    evidenceType: string;
    uri: string;
  }[];
  readonly createdAt: string;
}

export interface CustodyQueueProjectionRow {
  readonly queueId: string;
  readonly queueCode: string;
  readonly state: string;
  readonly lockedForProcessing: boolean;
  readonly materialMix: string;
  readonly catalystWeightKg: string | null;
  readonly estimatedValueUsd: string | null;
  readonly exposedValueUsd: string | null;
  readonly possibleVarianceUsd: string | null;
  readonly boxCount: number;
  readonly converterCount: number;
  readonly evidenceArtifactCount: number;
  readonly sampleCount: number;
  readonly ledgerEntryCount: number;
  readonly linkedLedgerAmountUsd: string;
  readonly openReconciliationCount: number;
  readonly settlementStatus: string | null;
  readonly chainCompleteness: {
    complete: number;
    total: number;
    missing: readonly string[];
  };
  readonly createdAt: string;
}

export interface CustodyShipmentProjectionRow {
  readonly shipmentId: string;
  readonly shipmentCode: string;
  readonly state: string;
  readonly originSiteId: string;
  readonly destinationSiteId: string;
  readonly boxCount: number;
  readonly departedAt: string | null;
  readonly receivedAt: string | null;
}

export interface CustodyProjection {
  readonly boxes: readonly CustodyBoxProjectionRow[];
  readonly queues: readonly CustodyQueueProjectionRow[];
  readonly shipments: readonly CustodyShipmentProjectionRow[];
}

interface QueueContinuityStats {
  readonly boxCount: number;
  readonly converterCount: number;
  readonly evidenceArtifactCount: number;
  readonly sampleCount: number;
  readonly ledgerEntryCount: number;
  readonly linkedLedgerAmountUsd: string;
  readonly openReconciliationCount: number;
  readonly settlementStatus: string | null;
  readonly hedgeCount: number;
  readonly catalystWeightKg: string | null;
  readonly materialMix: string;
}

function queueChainCompleteness(input: {
  readonly lockedForProcessing: boolean;
  readonly estimatedValueUsd: string | null;
  readonly sampleCount: number;
  readonly settlementStatus: string | null;
  readonly hedgeCount: number;
  readonly boxCount: number;
  readonly converterCount: number;
  readonly ledgerEntryCount: number;
  readonly evidenceArtifactCount: number;
}): {
  complete: number;
  total: number;
  missing: string[];
} {
  const missing: string[] = [];
  if (input.converterCount === 0) missing.push("capture");
  if (input.boxCount === 0) missing.push("box_assignment");
  if (!input.lockedForProcessing) missing.push("queue_lock");
  if (input.evidenceArtifactCount === 0) missing.push("evidence");
  if (input.sampleCount === 0) missing.push("sample");
  if (input.estimatedValueUsd === null) missing.push("pricing_estimate");
  if (input.hedgeCount === 0) missing.push("hedge");
  if (input.ledgerEntryCount === 0) missing.push("ledger");
  if (input.settlementStatus === null) missing.push("settlement_started");
  if (input.settlementStatus !== "finalized") missing.push("finalization");
  if (input.sampleCount > 0 && input.settlementStatus !== "finalized") missing.push("assay_proof");

  const total = 11;
  return {
    complete: total - missing.length,
    total,
    missing,
  };
}

async function buildQueueContinuityStats(
  db: DcsDb,
  queueRows: readonly {
    queueId: string;
    queueCode: string;
  }[],
): Promise<Map<string, QueueContinuityStats>> {
  const queueIds = queueRows.map((row) => row.queueId);
  const queueCodes = queueRows.map((row) => row.queueCode);
  const queueByCode = new Map(queueRows.map((row) => [row.queueCode, row.queueId] as const));
  const queueById = new Map(queueRows.map((row) => [row.queueId, row.queueId] as const));
  const allQueueScopeRefs = [...queueIds, ...queueCodes];
  const stats = new Map<string, QueueContinuityStats>();
  for (const row of queueRows) {
    stats.set(row.queueId, {
      boxCount: 0,
      converterCount: 0,
      evidenceArtifactCount: 0,
      sampleCount: 0,
      ledgerEntryCount: 0,
      linkedLedgerAmountUsd: "0.00",
      openReconciliationCount: 0,
      settlementStatus: null,
      hedgeCount: 0,
      catalystWeightKg: null,
      materialMix: "mixed_unknown",
    });
  }

  const queueBoxCounts =
    queueIds.length === 0
      ? []
      : await db
          .select({
            queueId: queueBoxes.queueId,
            count: sql<number>`count(*)::int`,
          })
          .from(queueBoxes)
          .where(inArray(queueBoxes.queueId, queueIds))
          .groupBy(queueBoxes.queueId);
  for (const row of queueBoxCounts) {
    const existing = stats.get(row.queueId);
    if (!existing) continue;
    stats.set(row.queueId, { ...existing, boxCount: row.count });
  }

  const queueConverterCounts =
    queueIds.length === 0
      ? []
      : await db
          .select({
            queueId: queueBoxes.queueId,
            count: sql<number>`count(distinct ${boxConverters.converterId})::int`,
          })
          .from(queueBoxes)
          .leftJoin(boxConverters, eq(boxConverters.boxId, queueBoxes.boxId))
          .where(inArray(queueBoxes.queueId, queueIds))
          .groupBy(queueBoxes.queueId);
  for (const row of queueConverterCounts) {
    const existing = stats.get(row.queueId);
    if (!existing) continue;
    stats.set(row.queueId, { ...existing, converterCount: row.count });
  }

  const queueEvidenceCounts =
    queueIds.length === 0
      ? []
      : await db
          .select({
            queueId: queueBoxes.queueId,
            count: sql<number>`count(distinct ${evidenceArtifacts.artifactId})::int`,
          })
          .from(queueBoxes)
          .leftJoin(boxConverters, eq(boxConverters.boxId, queueBoxes.boxId))
          .leftJoin(converters, eq(converters.converterId, boxConverters.converterId))
          .leftJoin(evidenceArtifacts, eq(evidenceArtifacts.evidenceBundleId, converters.evidenceBundleId))
          .where(inArray(queueBoxes.queueId, queueIds))
          .groupBy(queueBoxes.queueId);
  for (const row of queueEvidenceCounts) {
    const existing = stats.get(row.queueId);
    if (!existing) continue;
    stats.set(row.queueId, { ...existing, evidenceArtifactCount: row.count });
  }

  const queueSampleCounts =
    queueIds.length === 0
      ? []
      : await db
          .select({
            queueId: samples.queueId,
            count: sql<number>`count(*)::int`,
          })
          .from(samples)
          .where(inArray(samples.queueId, queueIds))
          .groupBy(samples.queueId);
  for (const row of queueSampleCounts) {
    const existing = stats.get(row.queueId);
    if (!existing) continue;
    stats.set(row.queueId, { ...existing, sampleCount: row.count });
  }

  const queueMaterialRows =
    queueIds.length === 0
      ? []
      : await db
          .select({
            queueId: queueBoxes.queueId,
            materialType: boxes.materialType,
            count: sql<number>`count(*)::int`,
          })
          .from(queueBoxes)
          .leftJoin(boxes, eq(boxes.boxId, queueBoxes.boxId))
          .where(inArray(queueBoxes.queueId, queueIds))
          .groupBy(queueBoxes.queueId, boxes.materialType);
  const materialMixByQueue = new Map<string, string>();
  const materialPriority = new Map<string, number>([
    ["processed_catalyst", 4],
    ["catalyst_processed", 4],
    ["whole_converter", 3],
    ["converter_whole", 3],
    ["dust_recovery", 2],
    ["baghouse_dust", 2],
  ]);
  for (const row of queueMaterialRows) {
    if (!row.materialType) continue;
    const normalized = row.materialType.toLowerCase();
    const score = materialPriority.get(normalized) ?? 1;
    const existing = materialMixByQueue.get(row.queueId);
    if (!existing) {
      materialMixByQueue.set(row.queueId, normalized);
      continue;
    }
    const existingScore = materialPriority.get(existing) ?? 1;
    if (score > existingScore) {
      materialMixByQueue.set(row.queueId, normalized);
    }
  }
  for (const [queueId, materialMix] of materialMixByQueue.entries()) {
    const existing = stats.get(queueId);
    if (!existing) continue;
    stats.set(queueId, { ...existing, materialMix });
  }

  const queueMassRows =
    queueIds.length === 0
      ? []
      : await db
          .select({
            queueId: massMeasurements.queueId,
            postWeightKg: sql<string>`coalesce(sum(case when ${massMeasurements.stage} = 'post-process' then ${massMeasurements.outputWeightKg} else 0 end), 0)`,
            inputWeightKg: sql<string>`coalesce(sum(${massMeasurements.inputWeightKg}), 0)`,
          })
          .from(massMeasurements)
          .where(inArray(massMeasurements.queueId, queueIds))
          .groupBy(massMeasurements.queueId);
  for (const row of queueMassRows) {
    const existing = stats.get(row.queueId);
    if (!existing) continue;
    const postWeight = Number(row.postWeightKg);
    const inputWeight = Number(row.inputWeightKg);
    const catalystWeight = postWeight > 0 ? postWeight : inputWeight > 0 ? inputWeight : 0;
    stats.set(row.queueId, {
      ...existing,
      catalystWeightKg: catalystWeight > 0 ? catalystWeight.toFixed(3) : null,
    });
  }

  const queueHedgeCounts =
    allQueueScopeRefs.length === 0
      ? []
      : await db
          .select({
            scopeId: hedgePositions.scopeId,
            count: sql<number>`count(*)::int`,
          })
          .from(hedgePositions)
          .where(inArray(hedgePositions.scopeId, allQueueScopeRefs))
          .groupBy(hedgePositions.scopeId);
  for (const row of queueHedgeCounts) {
    const queueId = queueByCode.get(row.scopeId) ?? queueById.get(row.scopeId);
    if (!queueId) continue;
    const existing = stats.get(queueId);
    if (!existing) continue;
    stats.set(queueId, { ...existing, hedgeCount: existing.hedgeCount + row.count });
  }

  const queueLedgerRows =
    allQueueScopeRefs.length === 0
      ? []
      : await db
          .select({
            sourceOperationalRef: ledgerEntries.sourceOperationalRef,
            count: sql<number>`count(*)::int`,
            amountUsd: sql<string>`coalesce(sum(${ledgerEntries.amountUsd}), 0)`,
          })
          .from(ledgerEntries)
          .where(inArray(ledgerEntries.sourceOperationalRef, allQueueScopeRefs))
          .groupBy(ledgerEntries.sourceOperationalRef);
  for (const row of queueLedgerRows) {
    const queueId = queueByCode.get(row.sourceOperationalRef) ?? queueById.get(row.sourceOperationalRef);
    if (!queueId) continue;
    const existing = stats.get(queueId);
    if (!existing) continue;
    const nextAmount = Number(existing.linkedLedgerAmountUsd) + Number(row.amountUsd);
    stats.set(queueId, {
      ...existing,
      ledgerEntryCount: existing.ledgerEntryCount + row.count,
      linkedLedgerAmountUsd: nextAmount.toFixed(2),
    });
  }

  const queueReconRows =
    allQueueScopeRefs.length === 0
      ? []
      : await db
          .select({
            scopeId: reconciliationCases.scopeId,
            status: reconciliationCases.status,
            count: sql<number>`count(*)::int`,
          })
          .from(reconciliationCases)
          .where(inArray(reconciliationCases.scopeId, allQueueScopeRefs))
          .groupBy(reconciliationCases.scopeId, reconciliationCases.status);
  for (const row of queueReconRows) {
    if (row.status !== "open" && row.status !== "investigating") continue;
    const queueId = queueByCode.get(row.scopeId) ?? queueById.get(row.scopeId);
    if (!queueId) continue;
    const existing = stats.get(queueId);
    if (!existing) continue;
    stats.set(queueId, {
      ...existing,
      openReconciliationCount: existing.openReconciliationCount + row.count,
    });
  }

  const queueSettlementRows =
    allQueueScopeRefs.length === 0
      ? []
      : await db
          .select({
            scopeId: settlements.scopeId,
            status: settlements.status,
          })
          .from(settlements)
          .where(inArray(settlements.scopeId, allQueueScopeRefs))
          .orderBy(desc(settlements.createdAt));
  for (const row of queueSettlementRows) {
    const queueId = queueByCode.get(row.scopeId) ?? queueById.get(row.scopeId);
    if (!queueId) continue;
    const existing = stats.get(queueId);
    if (!existing || existing.settlementStatus) continue;
    stats.set(queueId, { ...existing, settlementStatus: row.status });
  }

  return stats;
}

export async function buildCustodyProjection(db: DcsDb): Promise<CustodyProjection> {
  const boxRows = await db
    .select({
      boxId: boxes.boxId,
      boxCode: boxes.externalCode,
      state: boxes.state,
      materialType: boxes.materialType,
      converterCount: sql<number>`count(${boxConverters.converterId})::int`,
      evidenceArtifactCount: sql<number>`count(distinct ${evidenceArtifacts.artifactId})::int`,
      createdAt: boxes.createdAt,
    })
    .from(boxes)
    .leftJoin(boxConverters, eq(boxConverters.boxId, boxes.boxId))
    .leftJoin(converters, eq(converters.converterId, boxConverters.converterId))
    .leftJoin(evidenceArtifacts, eq(evidenceArtifacts.evidenceBundleId, converters.evidenceBundleId))
    .groupBy(
      boxes.boxId,
      boxes.externalCode,
      boxes.state,
      boxes.materialType,
      boxes.createdAt,
    )
    .orderBy(desc(boxes.createdAt));

  const boxIds = boxRows.map((row) => row.boxId);
  const representativeEvidenceRows =
    boxIds.length === 0
      ? []
      : await db
          .select({
            boxId: boxConverters.boxId,
            artifactId: evidenceArtifacts.artifactId,
            evidenceType: evidenceArtifacts.evidenceType,
            uri: evidenceArtifacts.uri,
            capturedAt: evidenceArtifacts.capturedAt,
          })
          .from(boxConverters)
          .leftJoin(converters, eq(converters.converterId, boxConverters.converterId))
          .leftJoin(evidenceArtifacts, eq(evidenceArtifacts.evidenceBundleId, converters.evidenceBundleId))
          .where(inArray(boxConverters.boxId, boxIds))
          .orderBy(desc(evidenceArtifacts.capturedAt));
  const representativeEvidenceByBox = new Map<
    string,
    Array<{
      artifactId: string;
      evidenceType: string;
      uri: string;
    }>
  >();
  for (const evidenceRow of representativeEvidenceRows) {
    if (!evidenceRow.artifactId || !evidenceRow.evidenceType || !evidenceRow.uri) continue;
    const existing = representativeEvidenceByBox.get(evidenceRow.boxId) ?? [];
    if (existing.length >= 3) continue;
    existing.push({
      artifactId: evidenceRow.artifactId,
      evidenceType: evidenceRow.evidenceType,
      uri: evidenceRow.uri,
    });
    representativeEvidenceByBox.set(evidenceRow.boxId, existing);
  }

  const queueRows = await db
    .select({
      queueId: queues.queueId,
      queueCode: queues.queueCode,
      state: queues.state,
      lockedForProcessing: queues.lockedForProcessing,
      estimatedValueUsd: queues.estimatedValueUsd,
      createdAt: queues.createdAt,
    })
    .from(queues)
    .groupBy(
      queues.queueId,
      queues.queueCode,
      queues.state,
      queues.lockedForProcessing,
      queues.estimatedValueUsd,
      queues.createdAt,
    )
    .orderBy(desc(queues.createdAt));
  const queueStats = await buildQueueContinuityStats(db, queueRows);

  const shipmentRows = await db
    .select({
      shipmentId: shipments.shipmentId,
      shipmentCode: shipments.shipmentCode,
      state: shipments.state,
      originSiteId: shipments.originSiteId,
      destinationSiteId: shipments.destinationSiteId,
      boxCount: sql<number>`count(${shipmentBoxes.boxId})::int`,
      departedAt: shipments.departedAt,
      receivedAt: shipments.receivedAt,
    })
    .from(shipments)
    .leftJoin(shipmentBoxes, eq(shipmentBoxes.shipmentId, shipments.shipmentId))
    .groupBy(
      shipments.shipmentId,
      shipments.shipmentCode,
      shipments.state,
      shipments.originSiteId,
      shipments.destinationSiteId,
      shipments.departedAt,
      shipments.receivedAt,
    )
    .orderBy(desc(shipments.departedAt));

  return {
    boxes: boxRows.map((row) => ({
      boxId: row.boxId,
      boxCode: row.boxCode,
      state: row.state,
      materialType: row.materialType,
      converterCount: row.converterCount,
      evidenceArtifactCount: row.evidenceArtifactCount,
      representativeEvidence: representativeEvidenceByBox.get(row.boxId) ?? [],
      createdAt: row.createdAt.toISOString(),
    })),
    queues: queueRows.map((row) => ({
      ...((): {
        materialMix: string;
        catalystWeightKg: string | null;
        boxCount: number;
        converterCount: number;
        evidenceArtifactCount: number;
        sampleCount: number;
        ledgerEntryCount: number;
        linkedLedgerAmountUsd: string;
        openReconciliationCount: number;
        settlementStatus: string | null;
        exposedValueUsd: string | null;
        possibleVarianceUsd: string | null;
        chainCompleteness: {
          complete: number;
          total: number;
          missing: readonly string[];
        };
      } => {
        const stats = queueStats.get(row.queueId) ?? {
          boxCount: 0,
          converterCount: 0,
          evidenceArtifactCount: 0,
          sampleCount: 0,
          ledgerEntryCount: 0,
          linkedLedgerAmountUsd: "0.00",
          openReconciliationCount: 0,
          settlementStatus: null,
          hedgeCount: 0,
          catalystWeightKg: null,
          materialMix: "mixed_unknown",
        };
        const estimated = row.estimatedValueUsd ? Number(row.estimatedValueUsd) : 0;
        const isFinalized = stats.settlementStatus === "finalized";
        const baseVarianceRatio =
          stats.materialMix === "processed_catalyst" || stats.materialMix === "catalyst_processed"
            ? 0.22
            : stats.materialMix === "whole_converter" || stats.materialMix === "converter_whole"
              ? 0.16
              : stats.materialMix === "dust_recovery" || stats.materialMix === "baghouse_dust"
                ? 0.28
                : 0.2;
        const pressureRatio =
          baseVarianceRatio +
          (stats.openReconciliationCount > 0 ? 0.18 : 0) +
          (stats.sampleCount === 0 ? 0.1 : 0);
        const possibleVarianceUsd =
          row.estimatedValueUsd && !isFinalized ? (estimated * pressureRatio).toFixed(2) : null;
        return {
          materialMix: stats.materialMix,
          catalystWeightKg: stats.catalystWeightKg,
          boxCount: stats.boxCount,
          converterCount: stats.converterCount,
          evidenceArtifactCount: stats.evidenceArtifactCount,
          sampleCount: stats.sampleCount,
          ledgerEntryCount: stats.ledgerEntryCount,
          linkedLedgerAmountUsd: stats.linkedLedgerAmountUsd,
          openReconciliationCount: stats.openReconciliationCount,
          settlementStatus: stats.settlementStatus,
          exposedValueUsd: row.estimatedValueUsd && !isFinalized ? row.estimatedValueUsd : "0.00",
          possibleVarianceUsd,
          chainCompleteness: queueChainCompleteness({
            lockedForProcessing: row.lockedForProcessing,
            estimatedValueUsd: row.estimatedValueUsd,
            sampleCount: stats.sampleCount,
            settlementStatus: stats.settlementStatus,
            hedgeCount: stats.hedgeCount,
            boxCount: stats.boxCount,
            converterCount: stats.converterCount,
            ledgerEntryCount: stats.ledgerEntryCount,
            evidenceArtifactCount: stats.evidenceArtifactCount,
          }),
        };
      })(),
      queueId: row.queueId,
      queueCode: row.queueCode,
      state: row.state,
      lockedForProcessing: row.lockedForProcessing,
      estimatedValueUsd: row.estimatedValueUsd,
      createdAt: row.createdAt.toISOString(),
    })),
    shipments: shipmentRows.map((row) => ({
      shipmentId: row.shipmentId,
      shipmentCode: row.shipmentCode,
      state: row.state,
      originSiteId: row.originSiteId,
      destinationSiteId: row.destinationSiteId,
      boxCount: row.boxCount,
      departedAt: row.departedAt ? row.departedAt.toISOString() : null,
      receivedAt: row.receivedAt ? row.receivedAt.toISOString() : null,
    })),
  };
}

export interface GradingWorkbenchProjectionRow {
  readonly gradingDecisionId: string;
  readonly converterId: string;
  readonly converterState: string;
  readonly method: string;
  readonly confidenceBand: string;
  readonly estimatedValueUsd: string;
  readonly overridden: boolean;
  readonly overrideReason: string | null;
  readonly libraryEntryId: string;
  readonly qualificationStatus: string;
  readonly decidedBy: string | null;
  readonly decidedAt: string;
}

export async function buildGradingWorkbenchProjection(
  db: DcsDb,
): Promise<readonly GradingWorkbenchProjectionRow[]> {
  const rows = await db
    .select({
      gradingDecisionId: gradingDecisions.gradingDecisionId,
      converterId: gradingDecisions.converterId,
      converterState: converters.state,
      method: gradingDecisions.method,
      confidenceBand: gradingDecisions.confidenceBand,
      estimatedValueUsd: gradingDecisions.estimatedValueUsd,
      overridden: gradingDecisions.overridden,
      overrideReason: gradingDecisions.overrideReason,
      libraryEntryId: libraryEntries.libraryEntryId,
      qualificationStatus: libraryEntries.qualificationStatus,
      decidedBy: users.displayName,
      decidedAt: gradingDecisions.decidedAt,
    })
    .from(gradingDecisions)
    .leftJoin(converters, eq(converters.converterId, gradingDecisions.converterId))
    .leftJoin(libraryEntries, eq(libraryEntries.libraryEntryId, gradingDecisions.libraryEntryId))
    .leftJoin(users, eq(users.userId, gradingDecisions.decidedByUserId))
    .orderBy(desc(gradingDecisions.decidedAt));

  return rows.map((row) => ({
    gradingDecisionId: row.gradingDecisionId,
    converterId: row.converterId,
    converterState: row.converterState ?? "unknown",
    method: row.method,
    confidenceBand: row.confidenceBand,
    estimatedValueUsd: row.estimatedValueUsd,
    overridden: row.overridden,
    overrideReason: row.overrideReason,
    libraryEntryId: row.libraryEntryId ?? "unlinked",
    qualificationStatus: row.qualificationStatus ?? "unknown",
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt.toISOString(),
  }));
}

export interface AnalyticsWorkbenchProjectionRow {
  readonly sampleId: string;
  readonly queueCode: string;
  readonly source: string;
  readonly ptPpmRaw: string;
  readonly pdPpmRaw: string;
  readonly rhPpmRaw: string;
  readonly ptPpmCorrected: string | null;
  readonly pdPpmCorrected: string | null;
  readonly rhPpmCorrected: string | null;
  readonly matrixId: string | null;
  readonly matrixQualificationStatus: string | null;
  readonly capturedAt: string;
}

export async function buildAnalyticsWorkbenchProjection(
  db: DcsDb,
): Promise<readonly AnalyticsWorkbenchProjectionRow[]> {
  const rows = await db
    .select({
      sampleId: samples.sampleId,
      queueCode: queues.queueCode,
      source: samples.source,
      ptPpmRaw: samples.ptPpmRaw,
      pdPpmRaw: samples.pdPpmRaw,
      rhPpmRaw: samples.rhPpmRaw,
      ptPpmCorrected: samples.ptPpmCorrected,
      pdPpmCorrected: samples.pdPpmCorrected,
      rhPpmCorrected: samples.rhPpmCorrected,
      matrixId: samples.matrixId,
      matrixQualificationStatus: correctionMatrices.qualificationStatus,
      capturedAt: samples.capturedAt,
    })
    .from(samples)
    .leftJoin(queues, eq(queues.queueId, samples.queueId))
    .leftJoin(correctionMatrices, eq(correctionMatrices.matrixId, samples.matrixId))
    .orderBy(desc(samples.capturedAt));

  return rows.map((row) => ({
    sampleId: row.sampleId,
    queueCode: row.queueCode ?? "unknown",
    source: row.source,
    ptPpmRaw: row.ptPpmRaw,
    pdPpmRaw: row.pdPpmRaw,
    rhPpmRaw: row.rhPpmRaw,
    ptPpmCorrected: row.ptPpmCorrected,
    pdPpmCorrected: row.pdPpmCorrected,
    rhPpmCorrected: row.rhPpmCorrected,
    matrixId: row.matrixId,
    matrixQualificationStatus: row.matrixQualificationStatus,
    capturedAt: row.capturedAt.toISOString(),
  }));
}

export interface PricingExposureWorkbenchProjectionRow {
  readonly queueId: string;
  readonly queueCode: string;
  readonly queueState: string;
  readonly materialForm: string;
  readonly estimatedValueUsd: string | null;
  readonly exposedValueUsd: string | null;
  readonly possibleVarianceUsd: string | null;
  readonly linkedLedgerAmountUsd: string;
  readonly openDivergenceCount: number;
  readonly sourceMethod: string | null;
  readonly confidenceBand: string | null;
  readonly avgPtPpmCorrected: string;
  readonly avgPdPpmCorrected: string;
  readonly avgRhPpmCorrected: string;
  readonly hedgedPtOz: string;
  readonly hedgedPdOz: string;
  readonly hedgedRhOz: string;
  readonly openHedgeCount: number;
  readonly settlementStatus: string | null;
  readonly needsHedgeAttention: boolean;
}

export async function buildPricingExposureWorkbenchProjection(
  db: DcsDb,
): Promise<readonly PricingExposureWorkbenchProjectionRow[]> {
  const exposureRows = await buildQueueExposureProjection(db);
  const continuityStatsByQueue = await buildQueueContinuityStats(
    db,
    exposureRows.map((row) => ({ queueId: row.queueId, queueCode: row.queueCode })),
  );

  const pricingRows = await db
    .select({
      queueId: pricingDecisions.queueId,
      sourceMethod: pricingDecisions.sourceMethod,
      confidenceBand: pricingDecisions.confidenceBand,
      decidedAt: pricingDecisions.decidedAt,
    })
    .from(pricingDecisions)
    .orderBy(desc(pricingDecisions.decidedAt));

  const latestPricingByQueue = new Map<
    string,
    { sourceMethod: string; confidenceBand: string }
  >();
  for (const row of pricingRows) {
    if (!latestPricingByQueue.has(row.queueId)) {
      latestPricingByQueue.set(row.queueId, {
        sourceMethod: row.sourceMethod,
        confidenceBand: row.confidenceBand,
      });
    }
  }

  const hedgeRows = await db
    .select({
      scopeId: hedgePositions.scopeId,
      openHedgeCount: sql<number>`count(*)::int`,
    })
    .from(hedgePositions)
    .where(eq(hedgePositions.status, "open"))
    .groupBy(hedgePositions.scopeId);
  const openHedgesByQueueScope = new Map<string, number>();
  for (const row of hedgeRows) {
    openHedgesByQueueScope.set(row.scopeId, row.openHedgeCount);
  }

  const settlementRows = await db
    .select({
      scopeId: settlements.scopeId,
      status: settlements.status,
    })
    .from(settlements)
    .where(eq(settlements.scopeType, "queue"));
  const settlementByScopeId = new Map<string, string>();
  for (const row of settlementRows) {
    if (!settlementByScopeId.has(row.scopeId)) {
      settlementByScopeId.set(row.scopeId, row.status);
    }
  }

  return exposureRows.map((row) => {
    const pricing = latestPricingByQueue.get(row.queueId);
    const continuity = continuityStatsByQueue.get(row.queueId);
    const openHedgeCount =
      openHedgesByQueueScope.get(row.queueId) ??
      openHedgesByQueueScope.get(row.queueCode) ??
      continuity?.hedgeCount ??
      0;
    const settlementStatus =
      settlementByScopeId.get(row.queueId) ?? settlementByScopeId.get(row.queueCode) ?? null;
    const hedgedTotal =
      Number(row.hedgedPtOz) + Number(row.hedgedPdOz) + Number(row.hedgedRhOz);
    const needsHedgeAttention = Number(row.estimatedValueUsd ?? "0") > 0 && hedgedTotal <= 0;
    const estimatedValue = Number(row.estimatedValueUsd ?? "0");
    const isFinalized = settlementStatus === "finalized";
    const baseVarianceRatio =
      continuity?.materialMix === "processed_catalyst" || continuity?.materialMix === "catalyst_processed"
        ? 0.22
        : continuity?.materialMix === "whole_converter" || continuity?.materialMix === "converter_whole"
          ? 0.16
          : continuity?.materialMix === "dust_recovery" || continuity?.materialMix === "baghouse_dust"
            ? 0.28
            : 0.2;
    const uncertaintyRatio =
      baseVarianceRatio +
      (continuity && continuity.sampleCount === 0 ? 0.1 : 0) +
      (pricing?.confidenceBand === "low" ? 0.07 : pricing?.confidenceBand === "medium" ? 0.03 : 0);
    const openDivergenceCount = continuity?.openReconciliationCount ?? 0;
    const possibleVarianceUsd =
      row.estimatedValueUsd && !isFinalized
        ? (estimatedValue * (uncertaintyRatio + openDivergenceCount * 0.06)).toFixed(2)
        : null;

    return {
      queueId: row.queueId,
      queueCode: row.queueCode,
      queueState: row.queueState,
      materialForm: continuity?.materialMix ?? "mixed_unknown",
      estimatedValueUsd: row.estimatedValueUsd,
      exposedValueUsd: row.estimatedValueUsd && !isFinalized ? row.estimatedValueUsd : "0.00",
      possibleVarianceUsd,
      linkedLedgerAmountUsd: continuity?.linkedLedgerAmountUsd ?? "0.00",
      openDivergenceCount,
      sourceMethod: pricing?.sourceMethod ?? null,
      confidenceBand: pricing?.confidenceBand ?? null,
      avgPtPpmCorrected: row.avgPtPpmCorrected,
      avgPdPpmCorrected: row.avgPdPpmCorrected,
      avgRhPpmCorrected: row.avgRhPpmCorrected,
      hedgedPtOz: row.hedgedPtOz,
      hedgedPdOz: row.hedgedPdOz,
      hedgedRhOz: row.hedgedRhOz,
      openHedgeCount,
      settlementStatus,
      needsHedgeAttention,
    };
  });
}

export interface ReconciliationWorkbenchProjectionRow {
  readonly reconciliationCaseId: string;
  readonly triggerType: string;
  readonly severity: string;
  readonly status: string;
  readonly scopeType: string;
  readonly scopeId: string;
  readonly actionCount: number;
  readonly expectedValueUsd: string | null;
  readonly observedValueUsd: string | null;
  readonly varianceUsd: string | null;
  readonly financialImpactUsd: string | null;
  readonly confidenceImpact: string;
  readonly currentResolutionStep: string;
  readonly relatedEvidenceBundles: number;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly closureRationale: string | null;
}

export async function buildReconciliationWorkbenchProjection(
  db: DcsDb,
): Promise<readonly ReconciliationWorkbenchProjectionRow[]> {
  const rows = await db
    .select({
      reconciliationCaseId: reconciliationCases.reconciliationCaseId,
      triggerType: reconciliationCases.triggerType,
      severity: reconciliationCases.severity,
      status: reconciliationCases.status,
      scopeType: reconciliationCases.scopeType,
      scopeId: reconciliationCases.scopeId,
      actionCount: sql<number>`count(${reconciliationActions.reconciliationActionId})::int`,
      openedAt: reconciliationCases.openedAt,
      closedAt: reconciliationCases.closedAt,
      closureRationale: reconciliationCases.closureRationale,
    })
    .from(reconciliationCases)
    .leftJoin(
      reconciliationActions,
      eq(reconciliationActions.reconciliationCaseId, reconciliationCases.reconciliationCaseId),
    )
    .groupBy(
      reconciliationCases.reconciliationCaseId,
      reconciliationCases.triggerType,
      reconciliationCases.severity,
      reconciliationCases.status,
      reconciliationCases.scopeType,
      reconciliationCases.scopeId,
      reconciliationCases.openedAt,
      reconciliationCases.closedAt,
      reconciliationCases.closureRationale,
    )
    .orderBy(desc(reconciliationCases.openedAt));

  const queueValueRows = await db
    .select({
      queueId: queues.queueId,
      queueCode: queues.queueCode,
      estimatedValueUsd: queues.estimatedValueUsd,
    })
    .from(queues);
  const queueEstimateByScope = new Map<string, string | null>();
  for (const row of queueValueRows) {
    queueEstimateByScope.set(row.queueId, row.estimatedValueUsd);
    queueEstimateByScope.set(row.queueCode, row.estimatedValueUsd);
  }

  const settlementRows = await db
    .select({
      scopeId: settlements.scopeId,
      finalValueUsd: settlements.finalValueUsd,
      status: settlements.status,
      estimatedValueUsd: settlements.estimatedValueUsd,
      createdAt: settlements.createdAt,
    })
    .from(settlements)
    .orderBy(desc(settlements.createdAt));
  const latestSettlementByScope = new Map<
    string,
    { finalValueUsd: string | null; status: string; estimatedValueUsd: string }
  >();
  for (const row of settlementRows) {
    if (!latestSettlementByScope.has(row.scopeId)) {
      latestSettlementByScope.set(row.scopeId, {
        finalValueUsd: row.finalValueUsd,
        status: row.status,
        estimatedValueUsd: row.estimatedValueUsd,
      });
      const queue = queueValueRows.find(
        (candidate) => candidate.queueCode === row.scopeId || candidate.queueId === row.scopeId,
      );
      if (queue && !latestSettlementByScope.has(queue.queueId)) {
        latestSettlementByScope.set(queue.queueId, {
          finalValueUsd: row.finalValueUsd,
          status: row.status,
          estimatedValueUsd: row.estimatedValueUsd,
        });
      }
      if (queue && !latestSettlementByScope.has(queue.queueCode)) {
        latestSettlementByScope.set(queue.queueCode, {
          finalValueUsd: row.finalValueUsd,
          status: row.status,
          estimatedValueUsd: row.estimatedValueUsd,
        });
      }
    }
  }

  const ledgerByScopeRows = await db
    .select({
      sourceOperationalRef: ledgerEntries.sourceOperationalRef,
      amountUsd: sql<string>`coalesce(sum(${ledgerEntries.amountUsd}), 0)`,
    })
    .from(ledgerEntries)
    .groupBy(ledgerEntries.sourceOperationalRef);
  const ledgerByScope = new Map<string, string>();
  for (const row of ledgerByScopeRows) {
    ledgerByScope.set(row.sourceOperationalRef, row.amountUsd);
  }

  return Promise.all(
    rows.map(async (row) => {
      let expectedValueUsd: string | null = null;
      let observedValueUsd: string | null = null;
      let varianceUsd: string | null = null;
      let financialImpactUsd: string | null = null;
      let relatedEvidenceBundles = 0;

      if (row.scopeType === "queue") {
        expectedValueUsd = queueEstimateByScope.get(row.scopeId) ?? null;
        const settlement = latestSettlementByScope.get(row.scopeId);
        observedValueUsd = settlement?.finalValueUsd ?? null;
        if (!expectedValueUsd && settlement) {
          expectedValueUsd = settlement.estimatedValueUsd;
        }
        financialImpactUsd = ledgerByScope.get(row.scopeId) ?? expectedValueUsd;
        const queueRecord = queueValueRows.find(
          (candidate) => candidate.queueCode === row.scopeId || candidate.queueId === row.scopeId,
        );
        if (queueRecord) {
          const evidenceRows = await db
            .select({
              count: sql<number>`count(distinct ${converters.evidenceBundleId})::int`,
            })
            .from(queueBoxes)
            .leftJoin(boxConverters, eq(boxConverters.boxId, queueBoxes.boxId))
            .leftJoin(converters, eq(converters.converterId, boxConverters.converterId))
            .where(eq(queueBoxes.queueId, queueRecord.queueId));
          relatedEvidenceBundles = evidenceRows[0]?.count ?? 0;
        }
      } else if (row.scopeType === "ledger") {
        const ledgerRows = await db
          .select({
            ledgerEntryId: ledgerEntries.ledgerEntryId,
            amountUsd: ledgerEntries.amountUsd,
            sourceOperationalRef: ledgerEntries.sourceOperationalRef,
            evidenceBundleId: ledgerEntries.evidenceBundleId,
          })
          .from(ledgerEntries)
          .where(eq(ledgerEntries.ledgerEntryId, row.scopeId))
          .limit(1);
        const target = ledgerRows[0] ?? null;
        if (target) {
          expectedValueUsd = target.amountUsd;
          observedValueUsd = ledgerByScope.get(target.sourceOperationalRef) ?? target.amountUsd;
          financialImpactUsd = observedValueUsd;
          relatedEvidenceBundles = target.evidenceBundleId ? 1 : 0;
        }
      } else if (row.scopeType === "shipment") {
        financialImpactUsd = ledgerByScope.get(row.scopeId) ?? null;
        const evidenceRows = await db
          .select({
            count: sql<number>`count(distinct ${converters.evidenceBundleId})::int`,
          })
          .from(shipments)
          .leftJoin(shipmentBoxes, eq(shipmentBoxes.shipmentId, shipments.shipmentId))
          .leftJoin(boxConverters, eq(boxConverters.boxId, shipmentBoxes.boxId))
          .leftJoin(converters, eq(converters.converterId, boxConverters.converterId))
          .where(eq(shipments.shipmentCode, row.scopeId));
        relatedEvidenceBundles = evidenceRows[0]?.count ?? 0;
      }

      if (expectedValueUsd !== null && observedValueUsd !== null) {
        varianceUsd = (Number(observedValueUsd) - Number(expectedValueUsd)).toFixed(2);
      }
      if (financialImpactUsd === null && varianceUsd !== null) {
        financialImpactUsd = varianceUsd;
      }

      const confidenceImpact =
        row.status === "resolved" || row.status === "accepted_variance"
          ? "contained"
          : row.severity === "critical" || row.severity === "high"
            ? "reduced_to_low"
            : row.severity === "medium"
              ? "reduced_to_medium"
              : "localized";
      const currentResolutionStep =
        row.status === "open"
          ? "triage_and_scope"
          : row.status === "investigating"
            ? "collecting_counter_evidence"
            : row.status === "accepted_variance"
              ? "variance_accepted_with_controls"
              : "closed_with_additive_correction";

      return {
        reconciliationCaseId: row.reconciliationCaseId,
        triggerType: row.triggerType,
        severity: row.severity,
        status: row.status,
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        actionCount: row.actionCount,
        expectedValueUsd,
        observedValueUsd,
        varianceUsd,
        financialImpactUsd,
        confidenceImpact,
        currentResolutionStep,
        relatedEvidenceBundles,
        openedAt: row.openedAt.toISOString(),
        closedAt: row.closedAt ? row.closedAt.toISOString() : null,
        closureRationale: row.closureRationale,
      };
    }),
  );
}

export interface SettlementListProjectionRow {
  readonly settlementId: string;
  readonly scopeType: string;
  readonly scopeId: string;
  readonly status: string;
  readonly estimatedValueUsd: string;
  readonly finalValueUsd: string | null;
  readonly varianceUsd: string | null;
  readonly invoiceCount: number;
  readonly chainCompleteness: {
    complete: number;
    total: number;
    missing: readonly string[];
  };
  readonly createdAt: string;
  readonly finalizedAt: string | null;
}

export async function buildSettlementListProjection(
  db: DcsDb,
): Promise<readonly SettlementListProjectionRow[]> {
  const rows = await db
    .select({
      settlementId: settlements.settlementId,
      scopeType: settlements.scopeType,
      scopeId: settlements.scopeId,
      status: settlements.status,
      estimatedValueUsd: settlements.estimatedValueUsd,
      finalValueUsd: settlements.finalValueUsd,
      varianceUsd: settlements.varianceUsd,
      invoiceCount: sql<number>`count(${invoices.invoiceId})::int`,
      createdAt: settlements.createdAt,
      finalizedAt: settlements.finalizedAt,
    })
    .from(settlements)
    .leftJoin(invoices, eq(invoices.settlementId, settlements.settlementId))
    .groupBy(
      settlements.settlementId,
      settlements.scopeType,
      settlements.scopeId,
      settlements.status,
      settlements.estimatedValueUsd,
      settlements.finalValueUsd,
      settlements.varianceUsd,
      settlements.createdAt,
      settlements.finalizedAt,
    )
    .orderBy(desc(settlements.createdAt));

  const queueRows = await db
    .select({ queueId: queues.queueId, queueCode: queues.queueCode })
    .from(queues);
  const queueStats = await buildQueueContinuityStats(db, queueRows);
  const queueByScopeRef = new Map<string, (typeof queueRows)[number]>();
  for (const row of queueRows) {
    queueByScopeRef.set(row.queueCode, row);
    queueByScopeRef.set(row.queueId, row);
  }

  const operationalRows = rows.filter(
    (row) => row.scopeType === "queue" && queueByScopeRef.has(row.scopeId),
  );

  return operationalRows.map((row) => ({
    ...((): {
      chainCompleteness: {
        complete: number;
        total: number;
        missing: readonly string[];
      };
    } => {
      const queue = queueByScopeRef.get(row.scopeId);
      if (!queue) {
        return {
          chainCompleteness: {
            complete: 0,
            total: 11,
            missing: ["queue_link", "custody_chain", "assay_chain"],
          },
        };
      }
      const stats = queueStats.get(queue.queueId) ?? {
        boxCount: 0,
        converterCount: 0,
        evidenceArtifactCount: 0,
        sampleCount: 0,
        ledgerEntryCount: 0,
        linkedLedgerAmountUsd: "0.00",
        openReconciliationCount: 0,
        settlementStatus: null,
        hedgeCount: 0,
        catalystWeightKg: null,
        materialMix: "mixed_unknown",
      };
      return {
        chainCompleteness: queueChainCompleteness({
          lockedForProcessing: true,
          estimatedValueUsd: row.estimatedValueUsd,
          sampleCount: stats.sampleCount,
          settlementStatus: row.status,
          hedgeCount: stats.hedgeCount,
          boxCount: stats.boxCount,
          converterCount: stats.converterCount,
          ledgerEntryCount: stats.ledgerEntryCount,
          evidenceArtifactCount: stats.evidenceArtifactCount,
        }),
      };
    })(),
    settlementId: row.settlementId,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    status: row.status,
    estimatedValueUsd: row.estimatedValueUsd,
    finalValueUsd: row.finalValueUsd,
    varianceUsd: row.varianceUsd,
    invoiceCount: row.invoiceCount,
    createdAt: row.createdAt.toISOString(),
    finalizedAt: row.finalizedAt ? row.finalizedAt.toISOString() : null,
  }));
}

export interface EvidenceExplorerProjectionRow {
  readonly evidenceBundleId: string;
  readonly capturedAt: string;
  readonly gpsLat: string;
  readonly gpsLon: string;
  readonly gpsAccuracyM: string;
  readonly artifactCount: number;
  readonly converterLinks: number;
  readonly custodyEventLinks: number;
  readonly ledgerLinks: number;
  readonly capturedByUser: string | null;
  readonly capturedByDevice: string | null;
  readonly artifacts: readonly {
    artifactId: string;
    evidenceType: string;
    uri: string;
    capturedAt: string;
  }[];
}

export async function buildEvidenceExplorerProjection(
  db: DcsDb,
): Promise<readonly EvidenceExplorerProjectionRow[]> {
  const rows = await db
    .select({
      evidenceBundleId: evidenceBundles.evidenceBundleId,
      capturedAt: evidenceBundles.capturedAt,
      gpsLat: evidenceBundles.gpsLat,
      gpsLon: evidenceBundles.gpsLon,
      gpsAccuracyM: evidenceBundles.gpsAccuracyM,
      artifactCount: sql<number>`count(distinct ${evidenceArtifacts.artifactId})::int`,
      converterLinks: sql<number>`count(distinct ${converters.converterId})::int`,
      custodyEventLinks: sql<number>`count(distinct ${custodyEvents.custodyEventId})::int`,
      ledgerLinks: sql<number>`count(distinct ${ledgerEntries.ledgerEntryId})::int`,
      capturedByUser: users.displayName,
      capturedByDevice: devices.externalRef,
    })
    .from(evidenceBundles)
    .leftJoin(evidenceArtifacts, eq(evidenceArtifacts.evidenceBundleId, evidenceBundles.evidenceBundleId))
    .leftJoin(converters, eq(converters.evidenceBundleId, evidenceBundles.evidenceBundleId))
    .leftJoin(custodyEvents, eq(custodyEvents.evidenceBundleId, evidenceBundles.evidenceBundleId))
    .leftJoin(ledgerEntries, eq(ledgerEntries.evidenceBundleId, evidenceBundles.evidenceBundleId))
    .leftJoin(users, eq(users.userId, evidenceBundles.createdByUserId))
    .leftJoin(devices, eq(devices.deviceId, evidenceBundles.createdByDeviceId))
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

  const bundleIds = rows.map((row) => row.evidenceBundleId);
  const artifactRows =
    bundleIds.length === 0
      ? []
      : await db
          .select({
            evidenceBundleId: evidenceArtifacts.evidenceBundleId,
            artifactId: evidenceArtifacts.artifactId,
            evidenceType: evidenceArtifacts.evidenceType,
            uri: evidenceArtifacts.uri,
            capturedAt: evidenceArtifacts.capturedAt,
          })
          .from(evidenceArtifacts)
          .where(inArray(evidenceArtifacts.evidenceBundleId, bundleIds))
          .orderBy(desc(evidenceArtifacts.capturedAt));
  const artifactsByBundle = new Map<
    string,
    Array<{
      artifactId: string;
      evidenceType: string;
      uri: string;
      capturedAt: string;
    }>
  >();
  for (const artifact of artifactRows) {
    const existing = artifactsByBundle.get(artifact.evidenceBundleId) ?? [];
    existing.push({
      artifactId: artifact.artifactId,
      evidenceType: artifact.evidenceType,
      uri: artifact.uri,
      capturedAt: artifact.capturedAt.toISOString(),
    });
    artifactsByBundle.set(artifact.evidenceBundleId, existing);
  }

  return rows.map((row) => ({
    evidenceBundleId: row.evidenceBundleId,
    capturedAt: row.capturedAt.toISOString(),
    gpsLat: row.gpsLat,
    gpsLon: row.gpsLon,
    gpsAccuracyM: row.gpsAccuracyM,
    artifactCount: row.artifactCount,
    converterLinks: row.converterLinks,
    custodyEventLinks: row.custodyEventLinks,
    ledgerLinks: row.ledgerLinks,
    capturedByUser: row.capturedByUser,
    capturedByDevice: row.capturedByDevice,
    artifacts: artifactsByBundle.get(row.evidenceBundleId) ?? [],
  }));
}

export interface TransactionHistoryProjectionRow {
  readonly transactionId: string;
  readonly idempotencyKey: string;
  readonly eventType: string;
  readonly sourceSystem: string;
  readonly validationState: string;
  readonly originUserDisplay: string | null;
  readonly originDeviceRef: string | null;
  readonly createdAt: string;
  readonly appliedAt: string | null;
}

export async function buildTransactionHistoryProjection(
  db: DcsDb,
  limit = 100,
): Promise<readonly TransactionHistoryProjectionRow[]> {
  const normalizedLimit = Math.min(Math.max(limit, 1), 500);

  const rows = await db
    .select({
      transactionId: transactionEnvelopes.transactionId,
      idempotencyKey: transactionEnvelopes.idempotencyKey,
      eventType: transactionEnvelopes.eventType,
      sourceSystem: transactionEnvelopes.sourceSystem,
      validationState: transactionEnvelopes.validationState,
      originUserDisplay: users.displayName,
      originDeviceRef: devices.externalRef,
      createdAt: transactionEnvelopes.createdAt,
      appliedAt: transactionEnvelopes.appliedAt,
    })
    .from(transactionEnvelopes)
    .leftJoin(users, eq(users.userId, transactionEnvelopes.originUserId))
    .leftJoin(devices, eq(devices.deviceId, transactionEnvelopes.originDeviceId))
    .orderBy(desc(transactionEnvelopes.createdAt))
    .limit(normalizedLimit);

  return rows.map((row) => ({
    transactionId: row.transactionId,
    idempotencyKey: row.idempotencyKey,
    eventType: row.eventType,
    sourceSystem: row.sourceSystem,
    validationState: row.validationState,
    originUserDisplay: row.originUserDisplay,
    originDeviceRef: row.originDeviceRef,
    createdAt: row.createdAt.toISOString(),
    appliedAt: row.appliedAt ? row.appliedAt.toISOString() : null,
  }));
}
