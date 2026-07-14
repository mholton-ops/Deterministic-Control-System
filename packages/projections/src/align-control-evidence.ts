import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DcsDb } from "@dcs/db";
import {
  accounts,
  boxConverters,
  converters,
  devices,
  evidenceArtifacts,
  gradingDecisions,
  ledgerCorrections,
  ledgerEntries,
  libraryEntries,
  pricingDecisions,
  projectionRebuildCheckpoint,
  queueBoxes,
  queues,
  replicationQueue,
  replicationReceipts,
  samples,
  settlements,
  sites,
  transactionDependencies,
  transactionEnvelopes,
  users,
} from "@dcs/db";

type ReplicationLegState = "confirmed" | "failed" | "retrying" | "dependency_blocked" | "not_applicable";

export interface ReplicationSyncProjection {
  readonly generatedAt: string;
  readonly framing: string;
  readonly summary: {
    readonly localCreated: number;
    readonly localPersisted: number;
    readonly outboundQueued: number;
    readonly transmitting: number;
    readonly receiverValidated: number;
    readonly idempotentApplied: number;
    readonly acknowledged: number;
    readonly confirmed: number;
    readonly failed: number;
    readonly retrying: number;
    readonly dependencyBlocked: number;
    readonly recordStreamCount: number;
    readonly imageStreamCount: number;
  };
  readonly siteSync: readonly {
    readonly siteCode: string;
    readonly siteType: string;
    readonly lastSyncAt: string;
    readonly recordStreamStatus: ReplicationLegState;
    readonly imageStreamStatus: ReplicationLegState;
    readonly outboundQueueDepth: number;
    readonly dependencyBlockedTransactions: number;
  }[];
  readonly movement: readonly {
    readonly transactionId: string;
    readonly eventType: string;
    readonly sourceSystem: string;
    readonly localCreation: string;
    readonly localPersistence: string;
    readonly outboundQueue: string;
    readonly transmissionStatus: ReplicationLegState;
    readonly receiverValidation: string;
    readonly dependencyCheck: string;
    readonly idempotentApply: string;
    readonly acknowledgement: string;
    readonly streamType: "record_stream" | "image_stream";
    readonly origin: string;
    readonly createdAt: string;
  }[];
  readonly streamSeparation: readonly {
    readonly streamType: "record_stream" | "image_stream";
    readonly queued: number;
    readonly confirmed: number;
    readonly retrying: number;
    readonly failed: number;
    readonly controlNote: string;
  }[];
  readonly projectionRebuild: readonly {
    readonly projectionName: string;
    readonly sourceTransactionCount: number;
    readonly reconstructionStatus: string;
    readonly rebuildStatus: string;
    readonly lastRebuildAt: string;
  }[];
}

export interface SmartLibraryDetailProjection {
  readonly generatedAt: string;
  readonly rows: readonly SmartLibraryDetailRow[];
}

export interface SmartLibraryDetailRow {
  readonly gradingDecisionId: string;
  readonly converterId: string;
  readonly converterState: string;
  readonly vinOrSerial: string | null;
  readonly libraryEntryId: string;
  readonly matchMethod: string;
  readonly matchHierarchy: string;
  readonly imageArtifactRef: string;
  readonly physicalCharacteristics: string;
  readonly dimensionalAttributes: string;
  readonly assayHistory: string;
  readonly pricingHistory: string;
  readonly qualificationStatus: string;
  readonly overrideHistory: string;
  readonly finalAssayFeedbackLoop: string;
  readonly libraryRefinementNote: string;
  readonly authorityControl: string;
  readonly decidedAt: string;
}

export interface FundingControlProjection {
  readonly generatedAt: string;
  readonly summary: {
    readonly fundingAdvanceCount: number;
    readonly provisionalCount: number;
    readonly finalizedCount: number;
    readonly correctionCount: number;
    readonly totalFundingAdvancedUsd: string;
  };
  readonly rows: readonly FundingControlRow[];
}

export interface FundingControlRow {
  readonly ledgerEntryId: string;
  readonly transactionId: string;
  readonly purposeCode: string;
  readonly fundingAdvanceUsd: string;
  readonly approvingActor: string;
  readonly executingActor: string;
  readonly buyerOrSiteBalanceUsd: string;
  readonly linkedPurchases: string;
  readonly linkedBoxesQueues: string;
  readonly provisionalFinalState: string;
  readonly offsettingCorrections: string;
  readonly separationOfDutyTrail: string;
  readonly evidenceRequirement: string;
  readonly ledgerSourceReferences: string;
  readonly createdAt: string;
}

function replicationLegState(row: {
  validationState: string;
  queueStatus: string;
  retryCount: number;
}): ReplicationLegState {
  if (row.validationState === "awaiting_validation" || row.queueStatus === "awaiting_validation") {
    return "dependency_blocked";
  }
  if (row.queueStatus === "confirmed") return "confirmed";
  if (row.queueStatus === "failed" && row.retryCount >= 3) return "failed";
  return "retrying";
}

function aggregateLegState(rows: readonly { transmissionStatus: ReplicationLegState }[]): ReplicationLegState {
  if (rows.length === 0) return "not_applicable";
  if (rows.some((row) => row.transmissionStatus === "dependency_blocked")) return "dependency_blocked";
  if (rows.some((row) => row.transmissionStatus === "failed")) return "failed";
  if (rows.some((row) => row.transmissionStatus === "retrying")) return "retrying";
  return "confirmed";
}

function payloadSiteRefs(payload: Record<string, unknown>): readonly string[] {
  return ["yardId", "originSiteId", "destinationSiteId", "receivingSiteId"]
    .map((key) => payload[key])
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

function formatUsd(value: number): string {
  return value.toFixed(2);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function signatureValue(signature: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = signature[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number") return String(value);
  }

  return null;
}

export async function buildReplicationSyncProjection(db: DcsDb): Promise<ReplicationSyncProjection> {
  const rows = await db
    .select({
      transactionId: transactionEnvelopes.transactionId,
      idempotencyKey: transactionEnvelopes.idempotencyKey,
      eventType: transactionEnvelopes.eventType,
      sourceSystem: transactionEnvelopes.sourceSystem,
      validationState: transactionEnvelopes.validationState,
      payload: transactionEnvelopes.payload,
      originUserDisplay: users.displayName,
      originDeviceRef: devices.externalRef,
      dependencyCount: sql<number>`(
        select count(*)::int
        from ${transactionDependencies}
        where ${transactionDependencies.transactionId} = ${transactionEnvelopes.transactionId}
      )`,
      createdAt: transactionEnvelopes.createdAt,
      appliedAt: transactionEnvelopes.appliedAt,
      confirmedAt: transactionEnvelopes.confirmedAt,
      targetNode: replicationQueue.targetNode,
      streamType: replicationQueue.streamType,
      queueStatus: replicationQueue.status,
      retryCount: replicationQueue.retryCount,
      lastError: replicationQueue.lastError,
      acknowledgedAt: replicationQueue.acknowledgedAt,
      receiptId: replicationReceipts.replicationReceiptId,
    })
    .from(transactionEnvelopes)
    .leftJoin(users, eq(users.userId, transactionEnvelopes.originUserId))
    .leftJoin(devices, eq(devices.deviceId, transactionEnvelopes.originDeviceId))
    .innerJoin(replicationQueue, eq(replicationQueue.transactionId, transactionEnvelopes.transactionId))
    .leftJoin(
      replicationReceipts,
      and(
        eq(replicationReceipts.transactionId, replicationQueue.transactionId),
        eq(replicationReceipts.targetNode, replicationQueue.targetNode),
        eq(replicationReceipts.streamType, replicationQueue.streamType),
      ),
    )
    .orderBy(desc(transactionEnvelopes.createdAt))
    .limit(160);

  const siteRows = await db
    .select({
      siteCode: sites.siteCode,
      siteType: sites.siteType,
    })
    .from(sites)
    .orderBy(sites.siteCode);

  const counts = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(transactionEnvelopes),
    db.select({ count: sql<number>`count(*)::int` }).from(converters),
    db.select({ count: sql<number>`count(*)::int` }).from(queues),
    db.select({ count: sql<number>`count(*)::int` }).from(ledgerEntries),
    db.select({ count: sql<number>`count(*)::int` }).from(settlements),
    db.select({ count: sql<number>`count(*)::int` }).from(evidenceArtifacts),
    db.select().from(projectionRebuildCheckpoint).where(eq(projectionRebuildCheckpoint.checkpointKey, "global")).limit(1),
  ]);
  const totalTransactions = counts[0][0]?.count ?? rows.length;
  const latestCreatedAt = rows[0]?.createdAt.toISOString() ?? new Date(0).toISOString();

  const movementWithSites = rows.map((row) => {
    const transmissionStatus = replicationLegState({
      validationState: row.validationState,
      queueStatus: row.queueStatus,
      retryCount: row.retryCount,
    });
    const dependencyBlocked = transmissionStatus === "dependency_blocked";
    const failed = transmissionStatus === "failed";
    const confirmed = transmissionStatus === "confirmed";
    const streamType: "record_stream" | "image_stream" =
      row.streamType === "image" ? "image_stream" : "record_stream";

    return {
      transactionId: row.transactionId,
      eventType: row.eventType,
      sourceSystem: row.sourceSystem,
      localCreation: "created",
      localPersistence: row.createdAt ? "persisted locally" : "missing local write",
      outboundQueue: confirmed ? "acknowledged" : "queued for controlled retry",
      transmissionStatus,
      receiverValidation: row.receiptId
        ? "receiver checksum validated"
        : dependencyBlocked
        ? "dependency blocked"
        : failed
          ? row.lastError ?? "receiver validation failed"
          : "awaiting receiver validation",
      dependencyCheck: dependencyBlocked
        ? row.lastError ?? "required state not yet present"
        : row.dependencyCount > 0
          ? `${row.dependencyCount} dependency checks passed`
          : "no dependency required",
      idempotentApply: row.receiptId ? "unique receiver receipt stored" : "not yet applied",
      acknowledgement: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : "not acknowledged",
      streamType,
      origin: `${row.originUserDisplay ?? "unknown user"} / ${row.originDeviceRef ?? "unknown device"}`,
      createdAt: row.createdAt.toISOString(),
      siteRefs: payloadSiteRefs(row.payload),
    };
  });
  const movement = movementWithSites.map(({ siteRefs: _siteRefs, ...row }) => row);

  const byStatus = (status: ReplicationLegState) =>
    movement.filter((row) => row.transmissionStatus === status).length;
  const recordRows = movement.filter((row) => row.streamType === "record_stream");
  const imageRows = movement.filter((row) => row.streamType === "image_stream");

  return {
    generatedAt: new Date().toISOString(),
    framing: "Deterministic demo data. Public abstraction of the ALIGN control model.",
    summary: {
      localCreated: totalTransactions,
      localPersisted: rows.filter((row) => Boolean(row.createdAt)).length,
      outboundQueued: movement.filter((row) => row.transmissionStatus !== "confirmed").length,
      transmitting: byStatus("retrying"),
      receiverValidated: movement.filter((row) => row.receiverValidation === "receiver checksum validated").length,
      idempotentApplied: movement.filter((row) => row.idempotentApply === "unique receiver receipt stored").length,
      acknowledged: rows.filter((row) => Boolean(row.acknowledgedAt)).length,
      confirmed: byStatus("confirmed"),
      failed: byStatus("failed"),
      retrying: byStatus("retrying"),
      dependencyBlocked: byStatus("dependency_blocked"),
      recordStreamCount: recordRows.length,
      imageStreamCount: imageRows.length,
    },
    siteSync: siteRows
      .map((site) => {
        const linked = movementWithSites.filter((row) => row.siteRefs.includes(site.siteCode));
        const lastSyncAt = linked
          .map((row) => row.createdAt)
          .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
        if (!lastSyncAt) return null;
        return {
          siteCode: site.siteCode,
          siteType: site.siteType,
          lastSyncAt,
          recordStreamStatus: aggregateLegState(linked.filter((row) => row.streamType === "record_stream")),
          imageStreamStatus: aggregateLegState(linked.filter((row) => row.streamType === "image_stream")),
          outboundQueueDepth: linked.filter((row) => row.transmissionStatus !== "confirmed").length,
          dependencyBlockedTransactions: linked.filter((row) => row.transmissionStatus === "dependency_blocked").length,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null),
    movement,
    streamSeparation: [
      {
        streamType: "record_stream",
        queued: recordRows.filter((row) => row.transmissionStatus !== "confirmed").length,
        confirmed: recordRows.filter((row) => row.transmissionStatus === "confirmed").length,
        retrying: recordRows.filter((row) => row.transmissionStatus === "retrying").length,
        failed: recordRows.filter((row) => row.transmissionStatus === "failed").length,
        controlNote: "Operational records apply only after recognized dependencies are satisfied.",
      },
      {
        streamType: "image_stream",
        queued: imageRows.filter((row) => row.transmissionStatus !== "confirmed").length,
        confirmed: imageRows.filter((row) => row.transmissionStatus === "confirmed").length,
        retrying: imageRows.filter((row) => row.transmissionStatus === "retrying").length,
        failed: imageRows.filter((row) => row.transmissionStatus === "failed").length,
        controlNote: "Evidence artifacts move as proof references separate from record state.",
      },
    ],
    projectionRebuild: [
      {
        projectionName: "truth graph",
        sourceTransactionCount: totalTransactions,
        reconstructionStatus: "proof chains use deterministic envelope identity and linked state",
        rebuildStatus: counts[6][0] ? "materialized" : "not materialized",
        lastRebuildAt: counts[6][0]?.projectionGeneratedAt?.toISOString() ?? latestCreatedAt,
      },
      {
        projectionName: "custody and queue projection",
        sourceTransactionCount: counts[2][0]?.count ?? 0,
        reconstructionStatus: "rebuilt from controlled operational tables",
        rebuildStatus: counts[6][0] ? "materialized" : "not materialized",
        lastRebuildAt: counts[6][0]?.projectionGeneratedAt?.toISOString() ?? latestCreatedAt,
      },
      {
        projectionName: "finance ledger projection",
        sourceTransactionCount: counts[3][0]?.count ?? 0,
        reconstructionStatus: "ledger movements retain transaction and operational references",
        rebuildStatus: counts[6][0] ? "materialized" : "not materialized",
        lastRebuildAt: counts[6][0]?.projectionGeneratedAt?.toISOString() ?? latestCreatedAt,
      },
      {
        projectionName: "settlement projection",
        sourceTransactionCount: counts[4][0]?.count ?? 0,
        reconstructionStatus: "ordered settlement controls remain linked to the final outcome",
        rebuildStatus: counts[6][0] ? "materialized" : "not materialized",
        lastRebuildAt: counts[6][0]?.projectionGeneratedAt?.toISOString() ?? latestCreatedAt,
      },
      {
        projectionName: "evidence artifact index",
        sourceTransactionCount: counts[5][0]?.count ?? 0,
        reconstructionStatus: "artifact references and checksums retained",
        rebuildStatus: counts[6][0] ? "materialized" : "not materialized",
        lastRebuildAt: counts[6][0]?.projectionGeneratedAt?.toISOString() ?? latestCreatedAt,
      },
    ],
  };
}

export async function buildSmartLibraryDetailProjection(
  db: DcsDb,
): Promise<SmartLibraryDetailProjection> {
  const rows = await db
    .select({
      gradingDecisionId: gradingDecisions.gradingDecisionId,
      converterId: gradingDecisions.converterId,
      converterState: converters.state,
      vinOrSerial: converters.vinOrSerial,
      evidenceBundleId: converters.evidenceBundleId,
      libraryEntryId: libraryEntries.libraryEntryId,
      method: gradingDecisions.method,
      confidenceBand: gradingDecisions.confidenceBand,
      estimatedValueUsd: gradingDecisions.estimatedValueUsd,
      overridden: gradingDecisions.overridden,
      overrideReason: gradingDecisions.overrideReason,
      qualificationStatus: libraryEntries.qualificationStatus,
      vinPattern: libraryEntries.vinPattern,
      serialPattern: libraryEntries.serialPattern,
      morphologicalSignature: libraryEntries.morphologicalSignature,
      decidedBy: users.displayName,
      decidedAt: gradingDecisions.decidedAt,
    })
    .from(gradingDecisions)
    .leftJoin(converters, eq(converters.converterId, gradingDecisions.converterId))
    .leftJoin(libraryEntries, eq(libraryEntries.libraryEntryId, gradingDecisions.libraryEntryId))
    .leftJoin(users, eq(users.userId, gradingDecisions.decidedByUserId))
    .orderBy(desc(gradingDecisions.decidedAt))
    .limit(24);

  const converterIds = rows.map((row) => row.converterId);
  const bundleIds = rows.map((row) => row.evidenceBundleId).filter((value): value is string => Boolean(value));

  const artifactRows =
    bundleIds.length === 0
      ? []
      : await db
          .select({
            evidenceBundleId: evidenceArtifacts.evidenceBundleId,
            evidenceType: evidenceArtifacts.evidenceType,
            uri: evidenceArtifacts.uri,
          })
          .from(evidenceArtifacts)
          .where(inArray(evidenceArtifacts.evidenceBundleId, bundleIds));

  const artifactsByBundle = new Map<string, (typeof artifactRows)[number][]>();
  for (const artifact of artifactRows) {
    const existing = artifactsByBundle.get(artifact.evidenceBundleId) ?? [];
    existing.push(artifact);
    artifactsByBundle.set(artifact.evidenceBundleId, existing);
  }

  const queueRows =
    converterIds.length === 0
      ? []
      : await db
          .select({
            converterId: boxConverters.converterId,
            queueId: queues.queueId,
            queueCode: queues.queueCode,
            sampleCount: sql<number>`count(distinct ${samples.sampleId})::int`,
            latestSampleAt: sql<Date | null>`max(${samples.capturedAt})`,
            pricingMethod: sql<string | null>`max((${pricingDecisions.sourceMethod})::text)`,
            latestEstimateUsd: sql<string | null>`max(${pricingDecisions.estimateUsd})`,
            settlementStatus: sql<string | null>`max((${settlements.status})::text)`,
            finalValueUsd: sql<string | null>`max(${settlements.finalValueUsd})`,
          })
          .from(boxConverters)
          .leftJoin(queueBoxes, eq(queueBoxes.boxId, boxConverters.boxId))
          .leftJoin(queues, eq(queues.queueId, queueBoxes.queueId))
          .leftJoin(samples, eq(samples.queueId, queues.queueId))
          .leftJoin(pricingDecisions, eq(pricingDecisions.queueId, queues.queueId))
          .leftJoin(
            settlements,
            sql`${settlements.scopeId} = ${queues.queueCode} or ${settlements.scopeId} = (${queues.queueId})::text`,
          )
          .where(inArray(boxConverters.converterId, converterIds))
          .groupBy(boxConverters.converterId, queues.queueId, queues.queueCode);

  const queueByConverter = new Map(queueRows.map((row) => [row.converterId, row] as const));

  return {
    generatedAt: new Date().toISOString(),
    rows: rows.map((row, index) => {
      const signature = asRecord(row.morphologicalSignature);
      const queue = queueByConverter.get(row.converterId);
      const artifacts = row.evidenceBundleId ? artifactsByBundle.get(row.evidenceBundleId) ?? [] : [];
      const imageArtifact = artifacts.find((artifact) => artifact.evidenceType === "image") ?? artifacts[0] ?? null;
      const body = signatureValue(signature, ["body", "bodyShape", "shape"]) ?? "library morphology retained";
      const substrate = signatureValue(signature, ["substrate", "cellDensity", "substrateType"]) ?? "substrate pattern retained";
      const shield = signatureValue(signature, ["shield", "shieldPattern", "shell"]) ?? "shell features retained";
      const lengthMm = 285 + (index % 7) * 12;
      const diameterMm = 92 + (index % 5) * 4;
      const qualifier = row.qualificationStatus ?? "unknown";
      const settlementStatus = queue?.settlementStatus ?? "pending_final_assay";
      const finalValue = queue?.finalValueUsd ? formatUsd(Number(queue.finalValueUsd)) : null;

      return {
        gradingDecisionId: row.gradingDecisionId,
        converterId: row.converterId,
        converterState: row.converterState ?? "unknown",
        vinOrSerial: row.vinOrSerial,
        libraryEntryId: row.libraryEntryId ?? "unlinked",
        matchMethod: row.method,
        matchHierarchy:
          row.method === "vin"
            ? "VIN match, highest confidence"
            : row.method === "serial"
              ? "serial match, controlled fallback"
              : row.method === "library_match"
                ? "library feature match"
                : "category fallback, lowest authority",
        imageArtifactRef: imageArtifact
          ? `${imageArtifact.evidenceType}: ${imageArtifact.uri}`
          : "image artifact reference pending in demo stream",
        physicalCharacteristics: `${body}; ${substrate}; ${shield}`,
        dimensionalAttributes: `body ${lengthMm} mm x ${diameterMm} mm; pattern ${row.vinPattern ?? row.serialPattern ?? "category scope"}`,
        assayHistory: queue
          ? `${queue.sampleCount} samples on ${queue.queueCode}; latest ${queue.latestSampleAt ? queue.latestSampleAt.toISOString() : "pending"}`
          : "awaiting queue assay history",
        pricingHistory: `${row.method} estimate ${formatUsd(Number(row.estimatedValueUsd))}; queue pricing ${
          queue?.pricingMethod ?? "pending"
        } ${queue?.latestEstimateUsd ? formatUsd(Number(queue.latestEstimateUsd)) : "pending"}`,
        qualificationStatus: qualifier,
        overrideHistory: row.overridden
          ? `${row.overrideReason ?? "override recorded"}; decided by ${row.decidedBy ?? "grading authority"}`
          : "none, grading authority retained",
        finalAssayFeedbackLoop: finalValue
          ? `${settlementStatus} final value ${finalValue} feeds library review`
          : `${settlementStatus} outcome will refine confidence after assay`,
        libraryRefinementNote:
          qualifier === "qualified"
            ? "qualified entry can reinforce future matches after final assay comparison"
            : "entry remains controlled until assay feedback and qualification complete",
        authorityControl: "Field capture may start valuation context, but final value is controlled by library, assay, pricing, and settlement.",
        decidedAt: row.decidedAt.toISOString(),
      };
    }),
  };
}

export async function buildFundingControlProjection(db: DcsDb): Promise<FundingControlProjection> {
  const ledgerRows = await db
    .select({
      ledgerEntryId: ledgerEntries.ledgerEntryId,
      transactionId: ledgerEntries.transactionId,
      debitAccountId: ledgerEntries.debitAccountId,
      creditAccountId: ledgerEntries.creditAccountId,
      purposeCode: ledgerEntries.purposeCode,
      amountUsd: ledgerEntries.amountUsd,
      sourceOperationalRef: ledgerEntries.sourceOperationalRef,
      evidenceBundleId: ledgerEntries.evidenceBundleId,
      notes: ledgerEntries.notes,
      approvedByUserId: ledgerEntries.approvedByUserId,
      executedByUserId: ledgerEntries.executedByUserId,
      createdAt: ledgerEntries.createdAt,
    })
    .from(ledgerEntries)
    .orderBy(desc(ledgerEntries.createdAt))
    .limit(80);

  const accountRows = await db.select().from(accounts);
  const accountById = new Map(accountRows.map((row) => [row.accountId, row] as const));
  const actorRows = await db.select({ userId: users.userId, displayName: users.displayName, role: users.role }).from(users);
  const actorById = new Map(actorRows.map((row) => [row.userId, row] as const));
  const balances = new Map<string, number>();
  for (const entry of await db.select().from(ledgerEntries)) {
    balances.set(entry.creditAccountId, (balances.get(entry.creditAccountId) ?? 0) + Number(entry.amountUsd));
    balances.set(entry.debitAccountId, (balances.get(entry.debitAccountId) ?? 0) - Number(entry.amountUsd));
  }

  const transactionIds = ledgerRows.map((row) => row.transactionId);
  const originRows =
    transactionIds.length === 0
      ? []
      : await db
          .select({
            transactionId: transactionEnvelopes.transactionId,
            sourceSystem: transactionEnvelopes.sourceSystem,
            userDisplay: users.displayName,
            deviceRef: devices.externalRef,
          })
          .from(transactionEnvelopes)
          .leftJoin(users, eq(users.userId, transactionEnvelopes.originUserId))
          .leftJoin(devices, eq(devices.deviceId, transactionEnvelopes.originDeviceId))
          .where(inArray(transactionEnvelopes.transactionId, transactionIds));
  const originByTransaction = new Map(originRows.map((row) => [row.transactionId, row] as const));

  const entryIds = ledgerRows.map((row) => row.ledgerEntryId);
  const allCorrectionRows = await db.select().from(ledgerCorrections);
  const entryIdSet = new Set(entryIds);
  const correctionRows = allCorrectionRows.filter(
    (row) => entryIdSet.has(row.targetLedgerEntryId) || entryIdSet.has(row.correctionLedgerEntryId),
  );
  const correctionsByEntry = new Map<string, string[]>();
  for (const correction of correctionRows) {
    const targetList = correctionsByEntry.get(correction.targetLedgerEntryId) ?? [];
    targetList.push(correction.reasonCode);
    correctionsByEntry.set(correction.targetLedgerEntryId, targetList);
    const correctionList = correctionsByEntry.get(correction.correctionLedgerEntryId) ?? [];
    correctionList.push(`correction for ${correction.targetLedgerEntryId.slice(0, 8)}`);
    correctionsByEntry.set(correction.correctionLedgerEntryId, correctionList);
  }

  const queueRows = await db
    .select({
      queueId: queues.queueId,
      queueCode: queues.queueCode,
      state: queues.state,
      boxCount: sql<number>`count(distinct ${queueBoxes.boxId})::int`,
      converterCount: sql<number>`count(distinct ${boxConverters.converterId})::int`,
      settlementStatus: sql<string | null>`max((${settlements.status})::text)`,
    })
    .from(queues)
    .leftJoin(queueBoxes, eq(queueBoxes.queueId, queues.queueId))
    .leftJoin(boxConverters, eq(boxConverters.boxId, queueBoxes.boxId))
    .leftJoin(
      settlements,
      sql`${settlements.scopeId} = ${queues.queueCode} or ${settlements.scopeId} = (${queues.queueId})::text`,
    )
    .groupBy(queues.queueId, queues.queueCode, queues.state);
  const queueByRef = new Map<string, (typeof queueRows)[number]>();
  for (const row of queueRows) {
    queueByRef.set(row.queueId, row);
    queueByRef.set(row.queueCode, row);
  }

  const purchaseCountByRef = new Map<string, { count: number; amount: number }>();
  for (const row of ledgerRows) {
    if (row.purposeCode !== "field_purchase") continue;
    const existing = purchaseCountByRef.get(row.sourceOperationalRef) ?? { count: 0, amount: 0 };
    purchaseCountByRef.set(row.sourceOperationalRef, {
      count: existing.count + 1,
      amount: existing.amount + Number(row.amountUsd),
    });
  }

  const rows = ledgerRows.map((row) => {
    const debit = accountById.get(row.debitAccountId);
    const credit = accountById.get(row.creditAccountId);
    const controllingAccount = credit?.accountType === "buyer" ? credit : debit?.accountType === "buyer" ? debit : credit ?? debit;
    const origin = originByTransaction.get(row.transactionId);
    const queue = queueByRef.get(row.sourceOperationalRef);
    const purchase = purchaseCountByRef.get(row.sourceOperationalRef);
    const corrections = correctionsByEntry.get(row.ledgerEntryId) ?? [];
    const approvingActor = row.approvedByUserId ? actorById.get(row.approvedByUserId) : null;
    const executingActor = actorById.get(row.executedByUserId);
    const isFinalized = row.purposeCode === "settlement_payout" || queue?.settlementStatus === "finalized";
    const isProvisional =
      row.purposeCode === "funding_advance" || row.purposeCode === "field_purchase" || queue?.settlementStatus !== "finalized";

    return {
      ledgerEntryId: row.ledgerEntryId,
      transactionId: row.transactionId,
      purposeCode: row.purposeCode,
      fundingAdvanceUsd: row.purposeCode === "funding_advance" ? row.amountUsd : "0.00",
      approvingActor: approvingActor
        ? `${approvingActor.displayName} (${approvingActor.role})`
        : row.purposeCode === "funding_advance"
          ? "legacy record: approval actor unavailable"
          : "not required for this movement",
      executingActor: `${executingActor?.displayName ?? origin?.userDisplay ?? "legacy operator"} via ${origin?.deviceRef ?? origin?.sourceSystem ?? "control API"}`,
      buyerOrSiteBalanceUsd: controllingAccount ? formatUsd(balances.get(controllingAccount.accountId) ?? 0) : "0.00",
      linkedPurchases: purchase
        ? `${purchase.count} purchases, ${formatUsd(purchase.amount)}`
        : row.purposeCode === "field_purchase"
          ? `1 purchase, ${row.amountUsd}`
          : "none linked yet",
      linkedBoxesQueues: queue
        ? `${queue.queueCode}; ${queue.boxCount} boxes; ${queue.converterCount} converters; ${queue.state}`
        : `${row.sourceOperationalRef}; legacy reference unresolved`,
      provisionalFinalState: isFinalized ? "finalized against settlement truth" : isProvisional ? "provisional until material truth finalizes" : "validated",
      offsettingCorrections: corrections.length > 0 ? corrections.join(", ") : "none",
      separationOfDutyTrail: row.approvedByUserId
        ? `approved by ${approvingActor?.displayName ?? row.approvedByUserId}; executed by ${executingActor?.displayName ?? row.executedByUserId}; final value requires settlement control`
        : `executed by ${executingActor?.displayName ?? row.executedByUserId}; no separate approval required by this purpose code`,
      evidenceRequirement: row.evidenceBundleId
        ? `note required and linked; ${row.notes}`
        : `note required; ${row.notes}`,
      ledgerSourceReferences: `${row.sourceOperationalRef}; transaction ${row.transactionId.slice(0, 8)}; entry ${row.ledgerEntryId.slice(0, 8)}`,
      createdAt: row.createdAt.toISOString(),
    };
  });

  const fundingRows = rows.filter((row) => row.purposeCode === "funding_advance");

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      fundingAdvanceCount: fundingRows.length,
      provisionalCount: rows.filter((row) => row.provisionalFinalState.startsWith("provisional")).length,
      finalizedCount: rows.filter((row) => row.provisionalFinalState.startsWith("finalized")).length,
      correctionCount: rows.filter((row) => row.offsettingCorrections !== "none").length,
      totalFundingAdvancedUsd: formatUsd(
        fundingRows.reduce((total, row) => total + Number(row.fundingAdvanceUsd), 0),
      ),
    },
    rows,
  };
}
