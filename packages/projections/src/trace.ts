import { desc, eq, inArray } from "drizzle-orm";
import type { DcsDb } from "@dcs/db";
import {
  boxConverters,
  boxes,
  correctionMatrices,
  converters,
  devices,
  evidenceArtifacts,
  evidenceBundles,
  hedgePositions,
  invoiceLines,
  invoices,
  ledgerEntries,
  pricingDecisions,
  queueBoxes,
  queues,
  reconciliationCases,
  samples,
  settlementSteps,
  settlements,
  shipmentBoxes,
  shipments,
  transactionDependencies,
  transactionEnvelopes,
  users,
} from "@dcs/db";

type TruthStatus = "estimated" | "provisional" | "validated" | "finalized";
type ConfidenceLevel = "high" | "medium" | "low" | "unknown";
type DependencyState = "complete" | "incomplete";
type LedgerPurpose = typeof ledgerEntries.$inferSelect.purposeCode;

export type TraceEntityType =
  | "converter"
  | "box"
  | "queue"
  | "shipment"
  | "sample"
  | "reconciliation_case"
  | "settlement"
  | "ledger_entry";

interface OriginContext {
  readonly sourceSystem: string;
  readonly originUserId: string;
  readonly originDeviceId: string;
  readonly originUserDisplay: string | null;
  readonly originDeviceRef: string | null;
  readonly capturedAt: string;
}

interface TraceDependency {
  readonly entityType: string;
  readonly entityId: string;
  readonly requiredState: string;
}

interface EvidenceArtifactPreview {
  readonly artifactId: string;
  readonly evidenceType: string;
  readonly uri: string;
  readonly capturedAt: string;
}

interface EvidenceSnapshot {
  readonly evidenceBundleId: string;
  readonly requiredTypes: readonly string[];
  readonly presentTypes: readonly string[];
  readonly missingTypes: readonly string[];
  readonly artifacts: readonly EvidenceArtifactPreview[];
  readonly capturedAt: string;
  readonly capturedByUser: string | null;
  readonly capturedByDevice: string | null;
  readonly location: {
    readonly lat: string;
    readonly lon: string;
    readonly accuracyM: string;
  };
}

export interface TraceStepProjection {
  readonly stepOrder: number;
  readonly stepKey: string;
  readonly title: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly occurredAt: string | null;
  readonly lifecycleState: string;
  readonly truthStatus: TruthStatus;
  readonly confidence: ConfidenceLevel;
  readonly validationStatus: string;
  readonly dependencyState: DependencyState;
  readonly dependencies: readonly TraceDependency[];
  readonly origin: OriginContext | null;
  readonly evidence: EvidenceSnapshot | null;
  readonly summary: string;
}

export interface TraceViewProjection {
  readonly traceRef: {
    readonly entityType: TraceEntityType;
    readonly entityId: string;
    readonly resolvedAt: string;
  };
  readonly chain: {
    readonly converterId: string | null;
    readonly boxId: string | null;
    readonly boxCode: string | null;
    readonly queueId: string | null;
    readonly queueCode: string | null;
    readonly shipmentIds: readonly string[];
    readonly sampleIds: readonly string[];
    readonly pricingDecisionId: string | null;
    readonly hedgePositionIds: readonly string[];
    readonly ledgerEntryIds: readonly string[];
    readonly reconciliationCaseIds: readonly string[];
    readonly settlementId: string | null;
  };
  readonly certaintySummary: {
    readonly overallTrust: ConfidenceLevel;
    readonly finalizationState: string;
    readonly openGaps: readonly string[];
  };
  readonly steps: readonly TraceStepProjection[];
}

export interface SettlementReconstructionProjection {
  readonly settlementId: string;
  readonly beforeAfter: {
    readonly estimatedValueUsd: string | null;
    readonly finalValueUsd: string | null;
    readonly varianceUsd: string | null;
    readonly explanation: string;
  };
  readonly replay: readonly {
    readonly order: number;
    readonly stage: string;
    readonly truthStatus: TruthStatus;
    readonly confidence: ConfidenceLevel;
    readonly validationStatus: string;
    readonly uncertainty: string[];
    readonly origin: OriginContext | null;
    readonly dependencies: readonly TraceDependency[];
    readonly evidenceBundleId: string | null;
    readonly evidenceMissingTypes: readonly string[];
    readonly summary: string;
  }[];
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

function rankConfidence(value: ConfidenceLevel): number {
  if (value === "high") return 4;
  if (value === "medium") return 3;
  if (value === "low") return 2;
  return 1;
}

function minConfidence(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
  return rankConfidence(a) <= rankConfidence(b) ? a : b;
}

function truthStatusFromSettlement(settlementStatus: string): TruthStatus {
  if (settlementStatus === "finalized") return "finalized";
  if (settlementStatus === "validated") return "validated";
  return "provisional";
}

async function loadTransactionContext(
  db: DcsDb,
  transactionId: string | null,
): Promise<{
  origin: OriginContext | null;
  dependencyState: DependencyState;
  dependencies: readonly TraceDependency[];
}> {
  if (!transactionId) {
    return {
      origin: null,
      dependencyState: "incomplete",
      dependencies: [],
    };
  }

  const envelopeRows = await db
    .select({
      transactionId: transactionEnvelopes.transactionId,
      sourceSystem: transactionEnvelopes.sourceSystem,
      originUserId: transactionEnvelopes.originUserId,
      originDeviceId: transactionEnvelopes.originDeviceId,
      validationState: transactionEnvelopes.validationState,
      createdAt: transactionEnvelopes.createdAt,
      originUserDisplay: users.displayName,
      originDeviceRef: devices.externalRef,
    })
    .from(transactionEnvelopes)
    .leftJoin(users, eq(users.userId, transactionEnvelopes.originUserId))
    .leftJoin(devices, eq(devices.deviceId, transactionEnvelopes.originDeviceId))
    .where(eq(transactionEnvelopes.transactionId, transactionId))
    .limit(1);

  if (envelopeRows.length === 0) {
    return {
      origin: null,
      dependencyState: "incomplete",
      dependencies: [],
    };
  }

  const deps = await db
    .select({
      entityType: transactionDependencies.dependencyEntityType,
      entityId: transactionDependencies.dependencyEntityId,
      requiredState: transactionDependencies.requiredState,
    })
    .from(transactionDependencies)
    .where(eq(transactionDependencies.transactionId, transactionId));

  const envelope = envelopeRows[0];
  const dependencyState: DependencyState =
    envelope.validationState === "applied" || envelope.validationState === "confirmed"
      ? "complete"
      : "incomplete";

  return {
    origin: {
      sourceSystem: envelope.sourceSystem,
      originUserId: envelope.originUserId,
      originDeviceId: envelope.originDeviceId,
      originUserDisplay: envelope.originUserDisplay,
      originDeviceRef: envelope.originDeviceRef,
      capturedAt: envelope.createdAt.toISOString(),
    },
    dependencyState,
    dependencies: deps.map((dependency) => ({
      entityType: dependency.entityType,
      entityId: dependency.entityId,
      requiredState: dependency.requiredState,
    })),
  };
}

async function loadEvidenceSnapshot(
  db: DcsDb,
  evidenceBundleId: string | null,
  requiredTypes: readonly string[],
): Promise<EvidenceSnapshot | null> {
  if (!evidenceBundleId) {
    return null;
  }

  const bundleRows = await db
    .select({
      evidenceBundleId: evidenceBundles.evidenceBundleId,
      capturedAt: evidenceBundles.capturedAt,
      gpsLat: evidenceBundles.gpsLat,
      gpsLon: evidenceBundles.gpsLon,
      gpsAccuracyM: evidenceBundles.gpsAccuracyM,
      capturedByUser: users.displayName,
      capturedByDevice: devices.externalRef,
    })
    .from(evidenceBundles)
    .leftJoin(users, eq(users.userId, evidenceBundles.createdByUserId))
    .leftJoin(devices, eq(devices.deviceId, evidenceBundles.createdByDeviceId))
    .where(eq(evidenceBundles.evidenceBundleId, evidenceBundleId))
    .limit(1);

  if (bundleRows.length === 0) {
    return null;
  }

  const artifacts = await db
    .select({
      artifactId: evidenceArtifacts.artifactId,
      evidenceType: evidenceArtifacts.evidenceType,
      uri: evidenceArtifacts.uri,
      capturedAt: evidenceArtifacts.capturedAt,
    })
    .from(evidenceArtifacts)
    .where(eq(evidenceArtifacts.evidenceBundleId, evidenceBundleId))
    .orderBy(desc(evidenceArtifacts.capturedAt));

  const presentTypes = [...new Set(artifacts.map((artifact) => artifact.evidenceType))];
  const missingTypes = requiredTypes.filter((requiredType) => !(presentTypes as string[]).includes(requiredType));
  const bundle = bundleRows[0];

  return {
    evidenceBundleId: bundle.evidenceBundleId,
    requiredTypes,
    presentTypes,
    missingTypes,
    artifacts: artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      evidenceType: artifact.evidenceType,
      uri: artifact.uri,
      capturedAt: artifact.capturedAt.toISOString(),
    })),
    capturedAt: bundle.capturedAt.toISOString(),
    capturedByUser: bundle.capturedByUser,
    capturedByDevice: bundle.capturedByDevice,
    location: {
      lat: bundle.gpsLat,
      lon: bundle.gpsLon,
      accuracyM: bundle.gpsAccuracyM,
    },
  };
}

function inferConfidenceFromEvidence(evidence: EvidenceSnapshot | null): ConfidenceLevel {
  if (!evidence) return "unknown";
  if (evidence.missingTypes.length === 0 && evidence.artifacts.length >= evidence.requiredTypes.length) {
    return "high";
  }
  if (evidence.artifacts.length > 0) {
    return "medium";
  }
  return "low";
}

async function findQueueByRef(
  db: DcsDb,
  queueRef: string | null,
): Promise<{
  queueId: string;
  queueCode: string;
  state: string;
  lockedForProcessing: boolean;
  estimatedValueUsd: string | null;
  createdAt: Date;
} | null> {
  if (!queueRef) return null;

  if (isUuid(queueRef)) {
    const byId = await db.select().from(queues).where(eq(queues.queueId, queueRef)).limit(1);
    if (byId.length > 0) {
      return byId[0];
    }
  }

  const byCode = await db.select().from(queues).where(eq(queues.queueCode, queueRef)).limit(1);
  if (byCode.length > 0) {
    return byCode[0];
  }

  return null;
}

async function findSettlementForQueue(
  db: DcsDb,
  queueId: string | null,
  queueCode: string | null,
): Promise<{
  settlementId: string;
  status: string;
  estimatedValueUsd: string;
  finalValueUsd: string | null;
  varianceUsd: string | null;
  finalizedAt: Date | null;
  createdAt: Date;
  scopeId: string;
} | null> {
  const refs = [queueId, queueCode].filter((value): value is string => Boolean(value));
  if (refs.length === 0) return null;

  const rows = await db
    .select()
    .from(settlements)
    .where(inArray(settlements.scopeId, refs))
    .orderBy(desc(settlements.createdAt))
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0];
}

async function resolveTraceChain(
  db: DcsDb,
  entityType: TraceEntityType,
  entityId: string,
): Promise<{
  converter: {
    converterId: string;
    state: string;
    evidenceBundleId: string;
    capturedAt: Date;
    originTransactionId: string;
    currentBoxId: string | null;
  } | null;
  box: {
    boxId: string;
    externalCode: string;
    state: string;
    createdByTransactionId: string;
    createdAt: Date;
  } | null;
  queue: {
    queueId: string;
    queueCode: string;
    state: string;
    lockedForProcessing: boolean;
    estimatedValueUsd: string | null;
    createdAt: Date;
  } | null;
  shipments: Array<{
    shipmentId: string;
    shipmentCode: string;
    state: string;
    departedAt: Date | null;
    receivedAt: Date | null;
  }>;
  samples: Array<{
    sampleId: string;
    source: string;
    matrixId: string | null;
    queueId: string;
    capturedAt: Date;
  }>;
  pricingDecision: {
    pricingDecisionId: string;
    estimateUsd: string;
    confidenceBand: string;
    sourceMethod: string;
    decidedAt: Date;
  } | null;
  hedges: Array<{
    hedgePositionId: string;
    status: string;
    openedAt: Date;
    closedAt: Date | null;
  }>;
  settlement: {
    settlementId: string;
    status: string;
    estimatedValueUsd: string;
    finalValueUsd: string | null;
    varianceUsd: string | null;
    finalizedAt: Date | null;
    createdAt: Date;
    scopeId: string;
  } | null;
  ledgerEntries: Array<{
    ledgerEntryId: string;
    purposeCode: string;
    amountUsd: string;
    sourceOperationalRef: string;
    evidenceBundleId: string;
    transactionId: string;
    createdAt: Date;
  }>;
  reconciliationCases: Array<{
    reconciliationCaseId: string;
    triggerType: string;
    severity: string;
    status: string;
    scopeType: string;
    scopeId: string;
    openedAt: Date;
    closedAt: Date | null;
  }>;
}> {
  let converter: {
    converterId: string;
    state: string;
    evidenceBundleId: string;
    capturedAt: Date;
    originTransactionId: string;
    currentBoxId: string | null;
  } | null = null;
  let box: {
    boxId: string;
    externalCode: string;
    state: string;
    createdByTransactionId: string;
    createdAt: Date;
  } | null = null;
  let queue: {
    queueId: string;
    queueCode: string;
    state: string;
    lockedForProcessing: boolean;
    estimatedValueUsd: string | null;
    createdAt: Date;
  } | null = null;
  let explicitShipment: {
    shipmentId: string;
    shipmentCode: string;
    state: string;
    originSiteId: string;
    destinationSiteId: string;
    departedAt: Date | null;
    receivedAt: Date | null;
  } | null = null;
  let explicitLedger: {
    ledgerEntryId: string;
    purposeCode: LedgerPurpose;
    amountUsd: string;
    sourceOperationalRef: string;
    evidenceBundleId: string;
    transactionId: string;
    createdAt: Date;
  } | null = null;
  let explicitReconciliationCase: {
    reconciliationCaseId: string;
    triggerType: string;
    severity: typeof reconciliationCases.$inferSelect.severity;
    status: typeof reconciliationCases.$inferSelect.status;
    scopeType: typeof reconciliationCases.$inferSelect.scopeType;
    scopeId: string;
    openedAt: Date;
    closedAt: Date | null;
  } | null = null;

  if (entityType === "converter") {
    const rows = await db.select().from(converters).where(eq(converters.converterId, entityId)).limit(1);
    converter = rows[0] ?? null;
    if (converter?.currentBoxId) {
      const boxRows = await db.select().from(boxes).where(eq(boxes.boxId, converter.currentBoxId)).limit(1);
      box = boxRows[0] ?? null;
    }
  }

  if (entityType === "box") {
    const boxRows = isUuid(entityId)
      ? await db.select().from(boxes).where(eq(boxes.boxId, entityId)).limit(1)
      : await db.select().from(boxes).where(eq(boxes.externalCode, entityId)).limit(1);
    box = boxRows[0] ?? null;
    if (box) {
      const converterRows = await db
        .select({
          converterId: converters.converterId,
          state: converters.state,
          evidenceBundleId: converters.evidenceBundleId,
          capturedAt: converters.capturedAt,
          originTransactionId: converters.originTransactionId,
          currentBoxId: converters.currentBoxId,
          assignedAt: boxConverters.assignedAt,
        })
        .from(boxConverters)
        .leftJoin(converters, eq(converters.converterId, boxConverters.converterId))
        .where(eq(boxConverters.boxId, box.boxId))
        .orderBy(desc(boxConverters.assignedAt))
        .limit(1);
      const linked = converterRows[0];
      if (
        linked?.converterId &&
        linked.state &&
        linked.evidenceBundleId &&
        linked.capturedAt &&
        linked.originTransactionId
      ) {
        converter = {
          converterId: linked.converterId,
          state: linked.state,
          evidenceBundleId: linked.evidenceBundleId,
          capturedAt: linked.capturedAt,
          originTransactionId: linked.originTransactionId,
          currentBoxId: linked.currentBoxId,
        };
      }
    }
  }

  if (entityType === "queue") {
    queue = await findQueueByRef(db, entityId);
    if (queue) {
      const boxRows = await db
        .select({
          boxId: boxes.boxId,
          externalCode: boxes.externalCode,
          state: boxes.state,
          createdByTransactionId: boxes.createdByTransactionId,
          createdAt: boxes.createdAt,
          assignedAt: queueBoxes.assignedAt,
        })
        .from(queueBoxes)
        .leftJoin(boxes, eq(boxes.boxId, queueBoxes.boxId))
        .where(eq(queueBoxes.queueId, queue.queueId))
        .orderBy(desc(queueBoxes.assignedAt))
        .limit(1);
      const linkedBox = boxRows[0];
      if (
        linkedBox?.boxId &&
        linkedBox.externalCode &&
        linkedBox.state &&
        linkedBox.createdByTransactionId &&
        linkedBox.createdAt
      ) {
        box = {
          boxId: linkedBox.boxId,
          externalCode: linkedBox.externalCode,
          state: linkedBox.state,
          createdByTransactionId: linkedBox.createdByTransactionId,
          createdAt: linkedBox.createdAt,
        };
      }
    }
  }

  if (entityType === "shipment") {
    const shipmentRows = isUuid(entityId)
      ? await db.select().from(shipments).where(eq(shipments.shipmentId, entityId)).limit(1)
      : await db.select().from(shipments).where(eq(shipments.shipmentCode, entityId)).limit(1);
    explicitShipment = shipmentRows[0] ?? null;
    if (explicitShipment) {
      const shipmentBoxRows = await db
        .select({ boxId: shipmentBoxes.boxId, assignedAt: shipmentBoxes.assignedAt })
        .from(shipmentBoxes)
        .where(eq(shipmentBoxes.shipmentId, explicitShipment.shipmentId))
        .orderBy(desc(shipmentBoxes.assignedAt));
      const boxIds = shipmentBoxRows.map((row) => row.boxId);
      if (boxIds.length > 0) {
        const queueRows = await db
          .select({
            queueId: queues.queueId,
            queueCode: queues.queueCode,
            state: queues.state,
            lockedForProcessing: queues.lockedForProcessing,
            estimatedValueUsd: queues.estimatedValueUsd,
            createdAt: queues.createdAt,
            assignedAt: queueBoxes.assignedAt,
          })
          .from(queueBoxes)
          .leftJoin(queues, eq(queues.queueId, queueBoxes.queueId))
          .where(inArray(queueBoxes.boxId, boxIds))
          .orderBy(desc(queueBoxes.assignedAt))
          .limit(1);
        const linkedQueue = queueRows[0];
        if (
          linkedQueue?.queueId &&
          linkedQueue.queueCode &&
          linkedQueue.state &&
          linkedQueue.lockedForProcessing !== null &&
          linkedQueue.createdAt
        ) {
          queue = {
            queueId: linkedQueue.queueId,
            queueCode: linkedQueue.queueCode,
            state: linkedQueue.state,
            lockedForProcessing: linkedQueue.lockedForProcessing,
            estimatedValueUsd: linkedQueue.estimatedValueUsd,
            createdAt: linkedQueue.createdAt,
          };
        }
      }
    }
  }

  if (entityType === "sample") {
    const sampleRows = await db.select().from(samples).where(eq(samples.sampleId, entityId)).limit(1);
    const sample = sampleRows[0] ?? null;
    if (sample) {
      queue = await findQueueByRef(db, sample.queueId);
    }
  }

  if (entityType === "settlement") {
    const settlementRows = await db
      .select()
      .from(settlements)
      .where(eq(settlements.settlementId, entityId))
      .limit(1);
    const settlementRow = settlementRows[0] ?? null;
    if (settlementRow) {
      queue = await findQueueByRef(db, settlementRow.scopeId);
    }
  }

  if (entityType === "ledger_entry") {
    const ledgerRows = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.ledgerEntryId, entityId))
      .limit(1);
    explicitLedger = ledgerRows[0] ?? null;
    if (explicitLedger) {
      queue = await findQueueByRef(db, explicitLedger.sourceOperationalRef);
    }
  }

  if (entityType === "reconciliation_case") {
    const caseRows = await db
      .select({
        reconciliationCaseId: reconciliationCases.reconciliationCaseId,
        triggerType: reconciliationCases.triggerType,
        severity: reconciliationCases.severity,
        status: reconciliationCases.status,
        scopeType: reconciliationCases.scopeType,
        scopeId: reconciliationCases.scopeId,
        openedAt: reconciliationCases.openedAt,
        closedAt: reconciliationCases.closedAt,
      })
      .from(reconciliationCases)
      .where(eq(reconciliationCases.reconciliationCaseId, entityId))
      .limit(1);
    explicitReconciliationCase = caseRows[0] ?? null;
    if (explicitReconciliationCase) {
      if (explicitReconciliationCase.scopeType === "queue") {
        queue = await findQueueByRef(db, explicitReconciliationCase.scopeId);
      } else if (explicitReconciliationCase.scopeType === "ledger") {
        const ledgerRows = await db
          .select()
          .from(ledgerEntries)
          .where(eq(ledgerEntries.ledgerEntryId, explicitReconciliationCase.scopeId))
          .limit(1);
        explicitLedger = ledgerRows[0] ?? null;
        if (explicitLedger) {
          queue = await findQueueByRef(db, explicitLedger.sourceOperationalRef);
        }
      } else if (explicitReconciliationCase.scopeType === "lot") {
        const scopedSettlement = await db
          .select()
          .from(settlements)
          .where(eq(settlements.scopeId, explicitReconciliationCase.scopeId))
          .orderBy(desc(settlements.createdAt))
          .limit(1);
        if (scopedSettlement.length > 0) {
          queue = await findQueueByRef(db, scopedSettlement[0].scopeId);
        }
      }
    }
  }

  if (!box && converter?.currentBoxId) {
    const boxRows = await db.select().from(boxes).where(eq(boxes.boxId, converter.currentBoxId)).limit(1);
    box = boxRows[0] ?? null;
  }

  if (!queue && box) {
    const queueRows = await db
      .select({
        queueId: queues.queueId,
        queueCode: queues.queueCode,
        state: queues.state,
        lockedForProcessing: queues.lockedForProcessing,
        estimatedValueUsd: queues.estimatedValueUsd,
        createdAt: queues.createdAt,
        assignedAt: queueBoxes.assignedAt,
      })
      .from(queueBoxes)
      .leftJoin(queues, eq(queues.queueId, queueBoxes.queueId))
      .where(eq(queueBoxes.boxId, box.boxId))
      .orderBy(desc(queueBoxes.assignedAt))
      .limit(1);
    const linkedQueue = queueRows[0];
    if (
      linkedQueue?.queueId &&
      linkedQueue.queueCode &&
      linkedQueue.state &&
      linkedQueue.lockedForProcessing !== null &&
      linkedQueue.createdAt
    ) {
      queue = {
        queueId: linkedQueue.queueId,
        queueCode: linkedQueue.queueCode,
        state: linkedQueue.state,
        lockedForProcessing: linkedQueue.lockedForProcessing,
        estimatedValueUsd: linkedQueue.estimatedValueUsd,
        createdAt: linkedQueue.createdAt,
      };
    }
  }

  if (!converter && box) {
    const converterRows = await db
      .select({
        converterId: converters.converterId,
        state: converters.state,
        evidenceBundleId: converters.evidenceBundleId,
        capturedAt: converters.capturedAt,
        originTransactionId: converters.originTransactionId,
        currentBoxId: converters.currentBoxId,
      })
      .from(boxConverters)
      .leftJoin(converters, eq(converters.converterId, boxConverters.converterId))
      .where(eq(boxConverters.boxId, box.boxId))
      .orderBy(desc(boxConverters.assignedAt))
      .limit(1);
    const linked = converterRows[0];
    if (linked?.converterId && linked.state && linked.evidenceBundleId && linked.capturedAt && linked.originTransactionId) {
      converter = {
        converterId: linked.converterId,
        state: linked.state,
        evidenceBundleId: linked.evidenceBundleId,
        capturedAt: linked.capturedAt,
        originTransactionId: linked.originTransactionId,
        currentBoxId: linked.currentBoxId,
      };
    }
  }

  const sampleRows = queue
    ? await db
        .select({
          sampleId: samples.sampleId,
          source: samples.source,
          matrixId: samples.matrixId,
          queueId: samples.queueId,
          capturedAt: samples.capturedAt,
        })
        .from(samples)
        .where(eq(samples.queueId, queue.queueId))
        .orderBy(desc(samples.capturedAt))
    : [];

  const pricingRows = queue
    ? await db
        .select({
          pricingDecisionId: pricingDecisions.pricingDecisionId,
          estimateUsd: pricingDecisions.estimateUsd,
          confidenceBand: pricingDecisions.confidenceBand,
          sourceMethod: pricingDecisions.sourceMethod,
          decidedAt: pricingDecisions.decidedAt,
        })
        .from(pricingDecisions)
        .where(eq(pricingDecisions.queueId, queue.queueId))
        .orderBy(desc(pricingDecisions.decidedAt))
        .limit(1)
    : [];
  const pricingDecision = pricingRows[0] ?? null;

  const hedgeRefs = [queue?.queueId, queue?.queueCode].filter((value): value is string => Boolean(value));
  const hedgeRows =
    hedgeRefs.length === 0
      ? []
      : await db
          .select({
            hedgePositionId: hedgePositions.hedgePositionId,
            status: hedgePositions.status,
            openedAt: hedgePositions.openedAt,
            closedAt: hedgePositions.closedAt,
          })
          .from(hedgePositions)
          .where(inArray(hedgePositions.scopeId, hedgeRefs))
          .orderBy(desc(hedgePositions.openedAt));

  let settlementRow: {
    settlementId: string;
    status: string;
    estimatedValueUsd: string;
    finalValueUsd: string | null;
    varianceUsd: string | null;
    finalizedAt: Date | null;
    createdAt: Date;
    scopeId: string;
  } | null = null;

  if (entityType === "settlement") {
    const explicit = await db
      .select()
      .from(settlements)
      .where(eq(settlements.settlementId, entityId))
      .limit(1);
    settlementRow = explicit[0] ?? null;
  }

  if (!settlementRow) {
    settlementRow = await findSettlementForQueue(db, queue?.queueId ?? null, queue?.queueCode ?? null);
  }

  const ledgerRefs = [
    explicitLedger?.ledgerEntryId,
    queue?.queueId,
    queue?.queueCode,
    settlementRow?.settlementId,
    settlementRow?.scopeId,
  ].filter((value): value is string => Boolean(value));
  const ledgerRows =
    ledgerRefs.length === 0
      ? []
      : await db
          .select({
            ledgerEntryId: ledgerEntries.ledgerEntryId,
            purposeCode: ledgerEntries.purposeCode,
            amountUsd: ledgerEntries.amountUsd,
            sourceOperationalRef: ledgerEntries.sourceOperationalRef,
            evidenceBundleId: ledgerEntries.evidenceBundleId,
            transactionId: ledgerEntries.transactionId,
            createdAt: ledgerEntries.createdAt,
          })
          .from(ledgerEntries)
          .where(inArray(ledgerEntries.sourceOperationalRef, ledgerRefs))
          .orderBy(desc(ledgerEntries.createdAt));
  if (explicitLedger && !ledgerRows.some((row) => row.ledgerEntryId === explicitLedger.ledgerEntryId)) {
    ledgerRows.push(explicitLedger);
  }

  const shipmentRows = (() => {
    if (explicitShipment) {
      return [
        {
          shipmentId: explicitShipment.shipmentId,
          shipmentCode: explicitShipment.shipmentCode,
          state: explicitShipment.state,
          departedAt: explicitShipment.departedAt,
          receivedAt: explicitShipment.receivedAt,
        },
      ];
    }
    return [] as Array<{
      shipmentId: string;
      shipmentCode: string;
      state: string;
      departedAt: Date | null;
      receivedAt: Date | null;
    }>;
  })();
  if (shipmentRows.length === 0 && queue) {
    const queueBoxRows = await db
      .select({ boxId: queueBoxes.boxId })
      .from(queueBoxes)
      .where(eq(queueBoxes.queueId, queue.queueId));
    const queueBoxIds = queueBoxRows.map((row) => row.boxId);
    if (queueBoxIds.length > 0) {
      const linkedShipmentRows = await db
        .select({
          shipmentId: shipments.shipmentId,
          shipmentCode: shipments.shipmentCode,
          state: shipments.state,
          departedAt: shipments.departedAt,
          receivedAt: shipments.receivedAt,
          assignedAt: shipmentBoxes.assignedAt,
        })
        .from(shipmentBoxes)
        .leftJoin(shipments, eq(shipments.shipmentId, shipmentBoxes.shipmentId))
        .where(inArray(shipmentBoxes.boxId, queueBoxIds))
        .orderBy(desc(shipmentBoxes.assignedAt));
      const seenShipmentIds = new Set<string>();
      for (const row of linkedShipmentRows) {
        if (!row.shipmentId || !row.shipmentCode || !row.state || seenShipmentIds.has(row.shipmentId)) {
          continue;
        }
        seenShipmentIds.add(row.shipmentId);
        shipmentRows.push({
          shipmentId: row.shipmentId,
          shipmentCode: row.shipmentCode,
          state: row.state,
          departedAt: row.departedAt,
          receivedAt: row.receivedAt,
        });
      }
    }
  }

  const reconciliationRefs = [
    queue?.queueId,
    queue?.queueCode,
    settlementRow?.settlementId,
    settlementRow?.scopeId,
    ...ledgerRows.map((row) => row.ledgerEntryId),
  ].filter((value): value is string => Boolean(value));
  const reconciliationRows =
    reconciliationRefs.length === 0
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
          })
          .from(reconciliationCases)
          .where(inArray(reconciliationCases.scopeId, reconciliationRefs))
          .orderBy(desc(reconciliationCases.openedAt));
  if (
    explicitReconciliationCase &&
    !reconciliationRows.some(
      (row) => row.reconciliationCaseId === explicitReconciliationCase?.reconciliationCaseId,
    )
  ) {
    reconciliationRows.push(explicitReconciliationCase);
  }

  return {
    converter,
    box,
    queue,
    shipments: shipmentRows,
    samples: sampleRows,
    pricingDecision,
    hedges: hedgeRows,
    settlement: settlementRow,
    ledgerEntries: ledgerRows,
    reconciliationCases: reconciliationRows,
  };
}

export async function buildTraceViewProjection(
  db: DcsDb,
  entityType: TraceEntityType,
  entityId: string,
): Promise<TraceViewProjection> {
  const chain = await resolveTraceChain(db, entityType, entityId);
  const steps: TraceStepProjection[] = [];
  let nextOrder = 1;
  const pushStep = (step: Omit<TraceStepProjection, "stepOrder">) => {
    steps.push({
      stepOrder: nextOrder,
      ...step,
    });
    nextOrder += 1;
  };

  if (chain.converter) {
    const tx = await loadTransactionContext(db, chain.converter.originTransactionId);
    const evidence = await loadEvidenceSnapshot(db, chain.converter.evidenceBundleId, ["image", "gps"]);
    const confidence = inferConfidenceFromEvidence(evidence);
    const truthStatus: TruthStatus = chain.converter.state === "settled" ? "finalized" : "validated";
    const validationStatus =
      evidence && evidence.missingTypes.length === 0 ? "origin_evidence_complete" : "origin_evidence_gap";
    pushStep({
      stepKey: "converter",
      title: "Converter Origin Capture",
      entityType: "converter",
      entityId: chain.converter.converterId,
      occurredAt: toIso(chain.converter.capturedAt),
      lifecycleState: chain.converter.state,
      truthStatus,
      confidence,
      validationStatus,
      dependencyState: tx.dependencyState,
      dependencies: tx.dependencies,
      origin: tx.origin,
      evidence,
      summary:
        evidence && evidence.missingTypes.length === 0
          ? "Origin capture has required image and GPS evidence."
          : "Origin capture is present but evidence requirements are incomplete.",
    });
  }

  if (chain.box) {
    const tx = await loadTransactionContext(db, chain.box.createdByTransactionId);
    const truthStatus: TruthStatus =
      chain.box.state === "received" || chain.box.state === "closed" ? "validated" : "provisional";
    const confidence: ConfidenceLevel = chain.box.state === "empty" ? "low" : "medium";
    pushStep({
      stepKey: "box",
      title: "Custody Boundary (Box)",
      entityType: "box",
      entityId: chain.box.boxId,
      occurredAt: toIso(chain.box.createdAt),
      lifecycleState: chain.box.state,
      truthStatus,
      confidence,
      validationStatus: chain.box.state === "empty" ? "awaiting_assignment" : "custody_recorded",
      dependencyState: tx.dependencyState,
      dependencies: tx.dependencies,
      origin: tx.origin,
      evidence: null,
      summary: `Box ${chain.box.externalCode} defines custody continuity before queue processing.`,
    });
  }

  if (chain.queue) {
    const truthStatus: TruthStatus =
      chain.queue.state === "settled"
        ? "finalized"
        : chain.queue.state === "valued"
          ? "validated"
          : chain.queue.state === "sampled" || chain.queue.state === "assay_pending"
            ? "provisional"
            : "estimated";
      const confidence: ConfidenceLevel =
      chain.queue.estimatedValueUsd && Number(chain.queue.estimatedValueUsd) > 0 ? "medium" : "low";
    pushStep({
      stepKey: "queue",
      title: "Queue Continuity and Processing Control",
      entityType: "queue",
      entityId: chain.queue.queueId,
      occurredAt: toIso(chain.queue.createdAt),
      lifecycleState: chain.queue.state,
      truthStatus,
      confidence,
      validationStatus: chain.queue.lockedForProcessing ? "processing_locked" : "processing_unlocked",
      dependencyState: chain.queue.lockedForProcessing ? "complete" : "incomplete",
      dependencies: [],
      origin: null,
      evidence: null,
      summary: chain.queue.lockedForProcessing
        ? "Queue lock is active; process continuity is controlled."
        : "Queue lock is not active; process continuity is not fully controlled.",
    });
  }

  if (chain.shipments.length > 0) {
    const latestShipment = chain.shipments[0];
    const shipmentState = latestShipment.state.toLowerCase();
    const truthStatus: TruthStatus =
      shipmentState === "closed"
        ? "finalized"
        : shipmentState === "received"
          ? "validated"
          : "provisional";
    const confidence: ConfidenceLevel =
      shipmentState === "received" || shipmentState === "closed" ? "high" : "medium";
    pushStep({
      stepKey: "shipment",
      title: "Shipment and Receipt Continuity",
      entityType: "shipment",
      entityId: latestShipment.shipmentId,
      occurredAt: toIso(latestShipment.receivedAt ?? latestShipment.departedAt),
      lifecycleState: latestShipment.state,
      truthStatus,
      confidence,
      validationStatus:
        shipmentState === "received" || shipmentState === "closed"
          ? "receipt_confirmed"
          : "material_in_transit",
      dependencyState: shipmentState === "discrepant" ? "incomplete" : "complete",
      dependencies: [],
      origin: null,
      evidence: null,
      summary:
        shipmentState === "received" || shipmentState === "closed"
          ? `${chain.shipments.length} shipment(s) linked; latest has receipt confirmation.`
          : `${chain.shipments.length} shipment(s) linked; latest remains ${latestShipment.state}.`,
    });
  }

  if (chain.samples.length > 0) {
    const sampleIds = chain.samples.map((sample) => sample.sampleId);
    const matrixIds = chain.samples
      .map((sample) => sample.matrixId)
      .filter((matrixId): matrixId is string => Boolean(matrixId));
    const matrixRows =
      matrixIds.length === 0
        ? []
        : await db
            .select({
              matrixId: correctionMatrices.matrixId,
              qualificationStatus: correctionMatrices.qualificationStatus,
            })
            .from(correctionMatrices)
            .where(inArray(correctionMatrices.matrixId, matrixIds));
    const allQualified =
      matrixRows.length > 0 && matrixRows.every((matrix) => matrix.qualificationStatus === "qualified");
    const hasIcp = chain.samples.some((sample) => sample.source === "icp_final");
    const latestSample = chain.samples[0];
    pushStep({
      stepKey: "samples",
      title: "Analytical Samples",
      entityType: "sample",
      entityId: sampleIds[0],
      occurredAt: toIso(latestSample?.capturedAt),
      lifecycleState: `${chain.samples.length} sampled`,
      truthStatus: hasIcp ? "finalized" : "provisional",
      confidence: hasIcp ? "high" : allQualified ? "medium" : "low",
      validationStatus: hasIcp ? "external_assay_available" : allQualified ? "matrix_qualified" : "awaiting_assay",
      dependencyState: "complete",
      dependencies: [],
      origin: null,
      evidence: null,
      summary: `Samples captured: ${sampleIds.join(", ")}.`,
    });
  }

  if (chain.pricingDecision) {
    const confidence =
      chain.pricingDecision.confidenceBand === "high"
        ? "high"
        : chain.pricingDecision.confidenceBand === "medium"
          ? "medium"
          : "low";
    const isFinalized = chain.settlement?.status === "finalized";
    pushStep({
      stepKey: "pricing",
      title: "Estimated Value Resolution",
      entityType: "queue",
      entityId: chain.queue?.queueId ?? chain.pricingDecision.pricingDecisionId,
      occurredAt: toIso(chain.pricingDecision.decidedAt),
      lifecycleState: chain.pricingDecision.sourceMethod,
      truthStatus: isFinalized ? "validated" : "estimated",
      confidence,
      validationStatus: isFinalized ? "estimate_backtested_against_final" : "awaiting_assay_confirmation",
      dependencyState: chain.samples.length > 0 ? "complete" : "incomplete",
      dependencies: [],
      origin: null,
      evidence: null,
      summary: `Pricing estimate ${chain.pricingDecision.estimateUsd} USD derived from ${chain.pricingDecision.sourceMethod}.`,
    });
  }

  if (chain.hedges.length > 0) {
    const latestHedge = chain.hedges[0];
    pushStep({
      stepKey: "hedge",
      title: "Hedge Association",
      entityType: "queue",
      entityId: chain.queue?.queueId ?? latestHedge.hedgePositionId,
      occurredAt: toIso(latestHedge.openedAt),
      lifecycleState: latestHedge.status,
      truthStatus: latestHedge.status === "closed" ? "validated" : "provisional",
      confidence: latestHedge.status === "closed" ? "high" : "medium",
      validationStatus: latestHedge.status === "closed" ? "hedge_closed" : "hedge_open",
      dependencyState: "complete",
      dependencies: [],
      origin: null,
      evidence: null,
      summary: `${chain.hedges.length} hedge position(s) linked to queue scope.`,
    });
  }

  for (const ledgerEntry of chain.ledgerEntries) {
    const tx = await loadTransactionContext(db, ledgerEntry.transactionId);
    const evidence = await loadEvidenceSnapshot(db, ledgerEntry.evidenceBundleId, ["note"]);
    pushStep({
      stepKey: `ledger:${ledgerEntry.ledgerEntryId}`,
      title: "Financial Movement",
      entityType: "ledger_entry",
      entityId: ledgerEntry.ledgerEntryId,
      occurredAt: toIso(ledgerEntry.createdAt),
      lifecycleState: ledgerEntry.purposeCode,
      truthStatus:
        chain.settlement?.status === "finalized" && ledgerEntry.purposeCode === "settlement_payout"
          ? "finalized"
          : "provisional",
      confidence: inferConfidenceFromEvidence(evidence),
      validationStatus:
        evidence && evidence.missingTypes.length === 0 ? "documented_financial_move" : "underdocumented_financial_move",
      dependencyState: tx.dependencyState,
      dependencies: tx.dependencies,
      origin: tx.origin,
      evidence,
      summary: `${ledgerEntry.purposeCode} ${ledgerEntry.amountUsd} USD linked to ${ledgerEntry.sourceOperationalRef}.`,
    });
  }

  if (chain.reconciliationCases.length > 0) {
    const latestCase = chain.reconciliationCases[0];
    pushStep({
      stepKey: "reconciliation",
      title: "Reconciliation Challenge",
      entityType: "reconciliation_case",
      entityId: latestCase.reconciliationCaseId,
      occurredAt: toIso(latestCase.closedAt ?? latestCase.openedAt),
      lifecycleState: latestCase.status,
      truthStatus:
        latestCase.status === "resolved" || latestCase.status === "accepted_variance"
          ? "validated"
          : "provisional",
      confidence:
        latestCase.status === "resolved" || latestCase.status === "accepted_variance"
          ? "high"
          : latestCase.severity === "critical" || latestCase.severity === "high"
            ? "low"
            : "medium",
      validationStatus:
        latestCase.status === "resolved" || latestCase.status === "accepted_variance"
          ? "disagreement_closed"
          : "disagreement_open",
      dependencyState:
        latestCase.status === "resolved" || latestCase.status === "accepted_variance"
          ? "complete"
          : "incomplete",
      dependencies: [],
      origin: null,
      evidence: null,
      summary: `${chain.reconciliationCases.length} reconciliation case(s); latest is ${latestCase.triggerType} (${latestCase.severity}).`,
    });
  }

  if (chain.settlement) {
    const settlementStatus = truthStatusFromSettlement(chain.settlement.status);
    const confidence: ConfidenceLevel =
      settlementStatus === "finalized" ? "high" : settlementStatus === "validated" ? "medium" : "low";
    pushStep({
      stepKey: "settlement",
      title: "Settlement and Final Proof",
      entityType: "settlement",
      entityId: chain.settlement.settlementId,
      occurredAt: toIso(chain.settlement.finalizedAt ?? chain.settlement.createdAt),
      lifecycleState: chain.settlement.status,
      truthStatus: settlementStatus,
      confidence,
      validationStatus:
        chain.settlement.status === "finalized"
          ? "assay_proven"
          : chain.settlement.status === "validated"
            ? "awaiting_final_invoice"
            : "awaiting_assay",
      dependencyState:
        chain.settlement.status === "finalized" && chain.settlement.finalValueUsd ? "complete" : "incomplete",
      dependencies: [],
      origin: null,
      evidence: null,
      summary:
        chain.settlement.finalValueUsd && chain.settlement.varianceUsd
          ? `Estimated ${chain.settlement.estimatedValueUsd}, final ${chain.settlement.finalValueUsd}, variance ${chain.settlement.varianceUsd}.`
          : "Settlement exists but final proof is incomplete.",
    });
  }

  const openGaps: string[] = [];
  let overallTrust: ConfidenceLevel = "high";
  const settlementIsFinalized = chain.settlement?.status === "finalized";

  for (const step of steps) {
    overallTrust = minConfidence(overallTrust, step.confidence);
    if (!settlementIsFinalized && step.truthStatus !== "finalized" && step.stepKey !== "pricing") {
      openGaps.push(`${step.title}: truth is ${step.truthStatus}`);
    }
    if (step.dependencyState === "incomplete") {
      openGaps.push(`${step.title}: dependency chain incomplete`);
      overallTrust = minConfidence(overallTrust, "low");
    }
    if (step.evidence && step.evidence.missingTypes.length > 0) {
      openGaps.push(`${step.title}: missing evidence ${step.evidence.missingTypes.join(", ")}`);
      overallTrust = minConfidence(overallTrust, "low");
    }
  }

  if (steps.length === 0) {
    overallTrust = "unknown";
    openGaps.push(`No trace steps resolved for ${entityType}:${entityId}.`);
  }

  const finalizationState =
    chain.settlement?.status === "finalized"
      ? "finalized"
      : chain.settlement
        ? "pending_finalization"
        : "no_settlement_linked";

  return {
    traceRef: {
      entityType,
      entityId,
      resolvedAt: new Date().toISOString(),
    },
    chain: {
      converterId: chain.converter?.converterId ?? null,
      boxId: chain.box?.boxId ?? null,
      boxCode: chain.box?.externalCode ?? null,
      queueId: chain.queue?.queueId ?? null,
      queueCode: chain.queue?.queueCode ?? null,
      shipmentIds: chain.shipments.map((shipment) => shipment.shipmentId),
      sampleIds: chain.samples.map((sample) => sample.sampleId),
      pricingDecisionId: chain.pricingDecision?.pricingDecisionId ?? null,
      hedgePositionIds: chain.hedges.map((hedge) => hedge.hedgePositionId),
      ledgerEntryIds: chain.ledgerEntries.map((entry) => entry.ledgerEntryId),
      reconciliationCaseIds: chain.reconciliationCases.map((reconCase) => reconCase.reconciliationCaseId),
      settlementId: chain.settlement?.settlementId ?? null,
    },
    certaintySummary: {
      overallTrust,
      finalizationState,
      openGaps,
    },
    steps: steps.sort((left, right) => left.stepOrder - right.stepOrder),
  };
}

export async function buildSettlementReconstructionProjection(
  db: DcsDb,
  settlementId: string,
): Promise<SettlementReconstructionProjection | null> {
  const settlementRows = await db
    .select({
      settlementId: settlements.settlementId,
      status: settlements.status,
      estimatedValueUsd: settlements.estimatedValueUsd,
      finalValueUsd: settlements.finalValueUsd,
      varianceUsd: settlements.varianceUsd,
    })
    .from(settlements)
    .where(eq(settlements.settlementId, settlementId))
    .limit(1);

  if (settlementRows.length === 0) {
    return null;
  }

  const trace = await buildTraceViewProjection(db, "settlement", settlementId);
  const settlement = settlementRows[0];

  const replay = trace.steps.map((step, index) => ({
    order: index + 1,
    stage: step.title,
    truthStatus: step.truthStatus,
    confidence: step.confidence,
    validationStatus: step.validationStatus,
    uncertainty: [
      ...(step.dependencyState === "incomplete" ? ["dependency_incomplete"] : []),
      ...(step.evidence?.missingTypes.map((missingType) => `missing_evidence:${missingType}`) ?? []),
      ...(step.truthStatus !== "finalized" ? [`truth_status:${step.truthStatus}`] : []),
    ],
    origin: step.origin,
    dependencies: step.dependencies,
    evidenceBundleId: step.evidence?.evidenceBundleId ?? null,
    evidenceMissingTypes: step.evidence?.missingTypes ?? [],
    summary: step.summary,
  }));

  const variance = settlement.varianceUsd ? Number(settlement.varianceUsd) : null;
  const explanation =
    settlement.status !== "finalized" || !settlement.finalValueUsd
      ? "Settlement remains unproven: final assay/value not fully closed."
      : variance === null
        ? "Settlement finalized without variance computation metadata."
        : Math.abs(variance) < 1
          ? "Estimated and final values align within nominal tolerance."
          : variance > 0
            ? "Final value exceeded estimate after assay validation."
            : "Final value was below estimate after assay validation.";

  return {
    settlementId: settlement.settlementId,
    beforeAfter: {
      estimatedValueUsd: settlement.estimatedValueUsd,
      finalValueUsd: settlement.finalValueUsd,
      varianceUsd: settlement.varianceUsd,
      explanation,
    },
    replay,
  };
}

export async function buildSettlementValueComparisonProjection(
  db: DcsDb,
  settlementId: string,
): Promise<{
  estimatedValueUsd: string | null;
  finalValueUsd: string | null;
  varianceUsd: string | null;
  stepCount: number;
  invoiceLineCount: number;
}> {
  const settlementRows = await db
    .select({
      estimatedValueUsd: settlements.estimatedValueUsd,
      finalValueUsd: settlements.finalValueUsd,
      varianceUsd: settlements.varianceUsd,
    })
    .from(settlements)
    .where(eq(settlements.settlementId, settlementId))
    .limit(1);
  if (settlementRows.length === 0) {
    return {
      estimatedValueUsd: null,
      finalValueUsd: null,
      varianceUsd: null,
      stepCount: 0,
      invoiceLineCount: 0,
    };
  }

  const stepRows = await db
    .select({ settlementStepId: settlementSteps.settlementStepId })
    .from(settlementSteps)
    .where(eq(settlementSteps.settlementId, settlementId));
  const invoiceRows = await db
    .select({ invoiceId: invoices.invoiceId })
    .from(invoices)
    .where(eq(invoices.settlementId, settlementId));
  const invoiceIds = invoiceRows.map((invoice) => invoice.invoiceId);
  const lineRows =
    invoiceIds.length === 0
      ? []
      : await db
          .select({ invoiceLineId: invoiceLines.invoiceLineId })
          .from(invoiceLines)
          .where(inArray(invoiceLines.invoiceId, invoiceIds));

  return {
    estimatedValueUsd: settlementRows[0].estimatedValueUsd,
    finalValueUsd: settlementRows[0].finalValueUsd,
    varianceUsd: settlementRows[0].varianceUsd,
    stepCount: stepRows.length,
    invoiceLineCount: lineRows.length,
  };
}
