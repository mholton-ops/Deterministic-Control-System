import { desc, eq, inArray, sql } from "drizzle-orm";
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
  queueBoxes,
  queues,
  samples,
  settlements,
  sites,
  transactionDependencies,
  transactionEnvelopes,
  users,
} from "@dcs/db";

type ReplicationLegState = "confirmed" | "failed" | "retrying" | "dependency_blocked";

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
  readonly projectionReplay: readonly {
    readonly projectionName: string;
    readonly sourceTransactionCount: number;
    readonly replayStatus: string;
    readonly rebuildStatus: string;
    readonly lastReplayAt: string;
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

function statusForReplicationLeg(
  row: {
    validationState: string;
    dependencyCount: number;
  },
  index: number,
): ReplicationLegState {
  if (row.validationState === "awaiting_validation") return "dependency_blocked";
  if (row.validationState === "failed") return "failed";
  if ((row.dependencyCount > 0 && index % 13 === 5) || index % 17 === 9) return "dependency_blocked";
  if (index % 19 === 7) return "failed";
  if (index % 11 === 3) return "retrying";
  return "confirmed";
}

function streamTypeForEvent(eventType: string): "record_stream" | "image_stream" {
  return eventType === "field.capture_converter" ? "image_stream" : "record_stream";
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60_000).toISOString();
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
      originUserDisplay: users.displayName,
      originDeviceRef: devices.externalRef,
      dependencyCount: sql<number>`count(${transactionDependencies.dependencyEntityType})::int`,
      createdAt: transactionEnvelopes.createdAt,
      appliedAt: transactionEnvelopes.appliedAt,
      confirmedAt: transactionEnvelopes.confirmedAt,
    })
    .from(transactionEnvelopes)
    .leftJoin(users, eq(users.userId, transactionEnvelopes.originUserId))
    .leftJoin(devices, eq(devices.deviceId, transactionEnvelopes.originDeviceId))
    .leftJoin(transactionDependencies, eq(transactionDependencies.transactionId, transactionEnvelopes.transactionId))
    .groupBy(
      transactionEnvelopes.transactionId,
      transactionEnvelopes.idempotencyKey,
      transactionEnvelopes.eventType,
      transactionEnvelopes.sourceSystem,
      transactionEnvelopes.validationState,
      users.displayName,
      devices.externalRef,
      transactionEnvelopes.createdAt,
      transactionEnvelopes.appliedAt,
      transactionEnvelopes.confirmedAt,
    )
    .orderBy(desc(transactionEnvelopes.createdAt))
    .limit(120);

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
  ]);
  const totalTransactions = counts[0][0]?.count ?? rows.length;
  const latestCreatedAt = rows[0]?.createdAt.toISOString() ?? new Date("2026-01-01T00:00:00.000Z").toISOString();

  const movement = rows.map((row, index) => {
    const transmissionStatus = statusForReplicationLeg(row, index);
    const dependencyBlocked = transmissionStatus === "dependency_blocked";
    const failed = transmissionStatus === "failed";
    const retrying = transmissionStatus === "retrying";
    const streamType = streamTypeForEvent(row.eventType);

    return {
      transactionId: row.transactionId,
      eventType: row.eventType,
      sourceSystem: row.sourceSystem,
      localCreation: "created",
      localPersistence: row.createdAt ? "persisted locally" : "missing local write",
      outboundQueue: transmissionStatus === "confirmed" ? "drained" : "held for control",
      transmissionStatus,
      receiverValidation: dependencyBlocked
        ? "dependency blocked"
        : failed
          ? "receiver rejected demo leg"
          : "receiver validated",
      dependencyCheck: dependencyBlocked
        ? "required state not yet present"
        : row.dependencyCount > 0
          ? `${row.dependencyCount} dependency checks passed`
          : "no dependency required",
      idempotentApply: transmissionStatus === "confirmed" ? "applied once" : "safe to replay",
      acknowledgement: transmissionStatus === "confirmed" ? "acknowledged" : retrying ? "pending ack" : "not acknowledged",
      streamType,
      origin: `${row.originUserDisplay ?? "unknown user"} / ${row.originDeviceRef ?? "unknown device"}`,
      createdAt: row.createdAt.toISOString(),
    };
  });

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
      outboundQueued: movement.filter((row) => row.outboundQueue !== "drained").length,
      transmitting: byStatus("retrying"),
      receiverValidated: movement.filter((row) => row.receiverValidation === "receiver validated").length,
      idempotentApplied: movement.filter((row) => row.idempotentApply === "applied once").length,
      acknowledged: movement.filter((row) => row.acknowledgement === "acknowledged").length,
      confirmed: byStatus("confirmed"),
      failed: byStatus("failed"),
      retrying: byStatus("retrying"),
      dependencyBlocked: byStatus("dependency_blocked"),
      recordStreamCount: recordRows.length,
      imageStreamCount: imageRows.length,
    },
    siteSync: siteRows.map((site, index) => ({
      siteCode: site.siteCode,
      siteType: site.siteType,
      lastSyncAt: addMinutes(latestCreatedAt, -index * 7),
      recordStreamStatus: index % 5 === 4 ? "retrying" : "confirmed",
      imageStreamStatus: index % 7 === 3 ? "failed" : index % 4 === 2 ? "retrying" : "confirmed",
      outboundQueueDepth: index % 5,
      dependencyBlockedTransactions: index % 6 === 3 ? 1 : 0,
    })),
    movement,
    streamSeparation: [
      {
        streamType: "record_stream",
        queued: recordRows.filter((row) => row.outboundQueue !== "drained").length,
        confirmed: recordRows.filter((row) => row.transmissionStatus === "confirmed").length,
        retrying: recordRows.filter((row) => row.transmissionStatus === "retrying").length,
        failed: recordRows.filter((row) => row.transmissionStatus === "failed").length,
        controlNote: "Operational records replay in dependency order.",
      },
      {
        streamType: "image_stream",
        queued: imageRows.filter((row) => row.outboundQueue !== "drained").length,
        confirmed: imageRows.filter((row) => row.transmissionStatus === "confirmed").length,
        retrying: imageRows.filter((row) => row.transmissionStatus === "retrying").length,
        failed: imageRows.filter((row) => row.transmissionStatus === "failed").length,
        controlNote: "Evidence artifacts move as proof references separate from record state.",
      },
    ],
    projectionReplay: [
      {
        projectionName: "truth graph",
        sourceTransactionCount: totalTransactions,
        replayStatus: "dependency ordered replay available",
        rebuildStatus: "current",
        lastReplayAt: addMinutes(latestCreatedAt, 3),
      },
      {
        projectionName: "custody and queue projection",
        sourceTransactionCount: counts[2][0]?.count ?? 0,
        replayStatus: "queue state rebuilt from events",
        rebuildStatus: "current",
        lastReplayAt: addMinutes(latestCreatedAt, 4),
      },
      {
        projectionName: "finance ledger projection",
        sourceTransactionCount: counts[3][0]?.count ?? 0,
        replayStatus: "ledger movements tied to source refs",
        rebuildStatus: "current",
        lastReplayAt: addMinutes(latestCreatedAt, 5),
      },
      {
        projectionName: "settlement projection",
        sourceTransactionCount: counts[4][0]?.count ?? 0,
        replayStatus: "estimate to final chain replayable",
        rebuildStatus: "current",
        lastReplayAt: addMinutes(latestCreatedAt, 6),
      },
      {
        projectionName: "evidence artifact index",
        sourceTransactionCount: counts[5][0]?.count ?? 0,
        replayStatus: "artifact references retained",
        rebuildStatus: "current",
        lastReplayAt: addMinutes(latestCreatedAt, 7),
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
      createdAt: ledgerEntries.createdAt,
    })
    .from(ledgerEntries)
    .orderBy(desc(ledgerEntries.createdAt))
    .limit(80);

  const accountRows = await db.select().from(accounts);
  const accountById = new Map(accountRows.map((row) => [row.accountId, row] as const));
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
    const isFinalized = row.purposeCode === "settlement_payout" || queue?.settlementStatus === "finalized";
    const isProvisional =
      row.purposeCode === "funding_advance" || row.purposeCode === "field_purchase" || queue?.settlementStatus !== "finalized";

    return {
      ledgerEntryId: row.ledgerEntryId,
      transactionId: row.transactionId,
      purposeCode: row.purposeCode,
      fundingAdvanceUsd: row.purposeCode === "funding_advance" ? row.amountUsd : "0.00",
      approvingActor:
        row.purposeCode === "settlement_payout"
          ? "Settlement lead"
          : row.purposeCode === "wire"
            ? "Treasury reviewer"
            : "Finance controller",
      executingActor: `${origin?.userDisplay ?? "system operator"} via ${origin?.deviceRef ?? origin?.sourceSystem ?? "control API"}`,
      buyerOrSiteBalanceUsd: controllingAccount ? formatUsd(balances.get(controllingAccount.accountId) ?? 0) : "0.00",
      linkedPurchases: purchase
        ? `${purchase.count} purchases, ${formatUsd(purchase.amount)}`
        : row.purposeCode === "field_purchase"
          ? `1 purchase, ${row.amountUsd}`
          : "none linked yet",
      linkedBoxesQueues: queue
        ? `${queue.queueCode}; ${queue.boxCount} boxes; ${queue.converterCount} converters; ${queue.state}`
        : `${row.sourceOperationalRef}; material link pending`,
      provisionalFinalState: isFinalized ? "finalized against settlement truth" : isProvisional ? "provisional until material truth finalizes" : "validated",
      offsettingCorrections: corrections.length > 0 ? corrections.join(", ") : "none",
      separationOfDutyTrail: `approved by ${row.purposeCode === "wire" ? "treasury" : "finance"}; executed by ${
        origin?.userDisplay ?? "operator"
      }; final value requires separate settlement control`,
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
