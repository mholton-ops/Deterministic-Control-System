import { randomUUID } from "node:crypto";

import { eq, inArray, or, sql } from "drizzle-orm";
import { commandSchema, type CommandDto, type TransactionEnvelopeDto } from "@dcs/contracts";
import type { DcsDb } from "@dcs/db";
import {
  accounts,
  boxes,
  boxConverters,
  converters,
  correctionMatrices,
  evidenceArtifacts,
  evidenceBundles,
  gradingDecisions,
  hedgePositions,
  invoices,
  invoiceLines,
  ledgerCorrections,
  ledgerEntries,
  libraryEntries,
  massMeasurements,
  marketSnapshots,
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
  termsProfiles,
} from "@dcs/db";
import {
  analytics,
  custody,
  finance,
  grading,
  origination,
  pricing,
  reconciliation,
  settlement,
  type DeviceId,
  type DependencyRef,
  type EvidenceBundleId,
  type UserId,
} from "@dcs/domain";
import { EventLogRepository } from "@dcs/event-log";

export interface CommandSubmission {
  readonly idempotencyKey: string;
  readonly origin: TransactionEnvelopeDto["origin"];
  readonly createdAt: string;
  readonly dependencies: readonly DependencyRef[];
  readonly command: CommandDto;
}

export interface CommandProcessResult {
  readonly transactionId: string;
  readonly status: "duplicate" | "awaiting_validation" | "applied";
  readonly eventType: string;
  readonly effects: Record<string, unknown>;
}

export class CommandProcessor {
  private readonly eventLog: EventLogRepository;

  public constructor(private readonly db: DcsDb) {
    this.eventLog = new EventLogRepository(db);
  }

  public async process(submission: CommandSubmission): Promise<CommandProcessResult> {
    const command = commandSchema.parse(submission.command);

    const existing = await this.eventLog.findByIdempotencyKey(submission.idempotencyKey);
    if (existing) {
      return {
        transactionId: existing.transactionId,
        status: "duplicate",
        eventType: existing.eventType,
        effects: {},
      };
    }

    const envelope = await this.eventLog.appendEnvelope({
      idempotencyKey: submission.idempotencyKey,
      eventType: command.commandType,
      sourceSystem: submission.origin.sourceSystem,
      originUserId: submission.origin.userId,
      originDeviceId: submission.origin.deviceId,
      payload: command,
      createdAt: submission.createdAt,
      dependencies: submission.dependencies.map((dependency) => ({
        entityType: dependency.entityType,
        entityId: dependency.entityId,
        requiredState: dependency.requiredState,
      })),
    });

    const dependencyError = await this.firstDependencyViolation(submission.dependencies);
    if (dependencyError) {
      await this.eventLog.markAwaitingValidation(envelope.transactionId);
      return {
        transactionId: envelope.transactionId,
        status: "awaiting_validation",
        eventType: command.commandType,
        effects: { reason: dependencyError },
      };
    }

    const effects = await this.applyCommand(command, submission.origin, envelope.transactionId);
    await this.eventLog.markApplied(envelope.transactionId);

    return {
      transactionId: envelope.transactionId,
      status: "applied",
      eventType: command.commandType,
      effects,
    };
  }

  private async firstDependencyViolation(
    dependencies: readonly DependencyRef[],
  ): Promise<string | null> {
    for (const dependency of dependencies) {
      const reason = await this.checkDependency(dependency);
      if (reason) {
        return reason;
      }
    }

    return null;
  }

  private async checkDependency(dependency: DependencyRef): Promise<string | null> {
    if (dependency.entityType === "converter") {
      const rows = await this.db
        .select({ state: converters.state })
        .from(converters)
        .where(eq(converters.converterId, dependency.entityId))
        .limit(1);
      if (rows.length === 0) return `converter ${dependency.entityId} not found`;
      if (rows[0].state !== dependency.requiredState) {
        return `converter ${dependency.entityId} expected ${dependency.requiredState} got ${rows[0].state}`;
      }

      return null;
    }

    if (dependency.entityType === "box") {
      const rows = await this.db
        .select({ state: boxes.state })
        .from(boxes)
        .where(eq(boxes.boxId, dependency.entityId))
        .limit(1);
      if (rows.length === 0) return `box ${dependency.entityId} not found`;
      if (rows[0].state !== dependency.requiredState) {
        return `box ${dependency.entityId} expected ${dependency.requiredState} got ${rows[0].state}`;
      }

      return null;
    }

    if (dependency.entityType === "queue") {
      const rows = await this.db
        .select({ state: queues.state })
        .from(queues)
        .where(eq(queues.queueId, dependency.entityId))
        .limit(1);
      if (rows.length === 0) return `queue ${dependency.entityId} not found`;
      if (rows[0].state !== dependency.requiredState) {
        return `queue ${dependency.entityId} expected ${dependency.requiredState} got ${rows[0].state}`;
      }

      return null;
    }

    if (dependency.entityType === "settlement") {
      const rows = await this.db
        .select({ state: settlements.status })
        .from(settlements)
        .where(eq(settlements.settlementId, dependency.entityId))
        .limit(1);
      if (rows.length === 0) return `settlement ${dependency.entityId} not found`;
      if (rows[0].state !== dependency.requiredState) {
        return `settlement ${dependency.entityId} expected ${dependency.requiredState} got ${rows[0].state}`;
      }

      return null;
    }

    return dependency.requiredState === "exists" ? null : `unknown dependency type ${dependency.entityType}`;
  }

  private async applyCommand(
    command: CommandDto,
    origin: CommandSubmission["origin"],
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    switch (command.commandType) {
      case "field.capture_converter":
        return this.applyFieldCapture(command, origin, transactionId);
      case "custody.assign_converter_to_box":
        return this.applyAssignConverterToBox(command, transactionId);
      case "custody.lock_queue_for_processing":
        return this.applyLockQueue(command);
      case "custody.assign_box_to_queue":
        return this.applyAssignBoxToQueue(command, transactionId);
      case "custody.create_shipment":
        return this.applyCreateShipment(command);
      case "custody.receive_shipment":
        return this.applyReceiveShipment(command);
      case "grading.issue_decision":
        return this.applyGradingDecision(command, origin);
      case "analytics.record_sample":
        return this.applyRecordSample(command);
      case "pricing.resolve_estimate":
        return this.applyResolvePricing(command);
      case "finance.post_ledger_entry":
        return this.applyPostLedgerEntry(command, origin, transactionId);
      case "finance.post_additive_correction":
        return this.applyPostAdditiveCorrection(command, origin, transactionId);
      case "hedge.open_position":
        return this.applyOpenHedge(command);
      case "settlement.append_step":
        return this.applySettlementStep(command, origin);
      case "settlement.finalize_from_assay":
        return this.applyFinalizeSettlementFromAssay(command, origin);
      case "reconciliation.open_case":
        return this.applyOpenReconciliation(command);
      case "reconciliation.record_action":
        return this.applyRecordReconciliationAction(command, origin);
      case "reconciliation.close_case":
        return this.applyCloseReconciliation(command);
      default:
        return {};
    }
  }

  private async applyFieldCapture(
    command: Extract<CommandDto, { commandType: "field.capture_converter" }>,
    origin: CommandSubmission["origin"],
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    const validation = origination.validateFieldCapture({
      yardId: command.yardId,
      boxId: command.boxId,
      vinOrSerial: command.vinOrSerial,
      capturedAt: command.capturedAt,
      location: command.location,
      origin: {
        sourceSystem: origin.sourceSystem,
        userId: origin.userId as UserId,
        deviceId: origin.deviceId as DeviceId,
        capturedAt: origin.capturedAt,
      },
      evidence: {
        evidenceBundleId: command.evidence.evidenceBundleId as EvidenceBundleId,
        requiredTypesPresent: command.evidence.requiredTypesPresent,
      },
    });
    if (!validation.ok) throw new Error(validation.error.message);

    const site = await this.getOrCreateSite(command.yardId);
    const box = await this.getOrCreateBoxByCode(command.boxId, transactionId);
    const evidenceBundleId = await this.createEvidenceBundle(
      origin,
      command.capturedAt,
      command.location,
      command.evidence.requiredTypesPresent,
    );

    const converterId = randomUUID();
    await this.db.insert(converters).values({
      converterId,
      state: "boxed",
      originTransactionId: transactionId,
      evidenceBundleId,
      currentBoxId: box.boxId,
      vinOrSerial: command.vinOrSerial,
      capturedAt: new Date(command.capturedAt),
      capturedSiteId: site.siteId,
    });

    await this.db.insert(boxConverters).values({
      boxId: box.boxId,
      converterId,
      assignedAt: new Date(),
      assignedByTransactionId: transactionId,
    });

    return { converterId, boxId: box.boxId };
  }

  private async applyAssignConverterToBox(
    command: Extract<CommandDto, { commandType: "custody.assign_converter_to_box" }>,
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    const converterRows = await this.db
      .select()
      .from(converters)
      .where(eq(converters.converterId, command.converterId))
      .limit(1);
    if (converterRows.length === 0) throw new Error(`Converter ${command.converterId} not found.`);

    const box = await this.getOrCreateBoxByCode(command.boxId, transactionId);
    const assignment = custody.assignConverterToBox(converterRows[0].state, {
      boxId: box.boxId,
      state: box.state,
      converterCount: 0,
    });
    if (!assignment.ok) throw new Error(assignment.error.message);

    await this.db
      .update(converters)
      .set({ currentBoxId: box.boxId, state: "boxed" })
      .where(eq(converters.converterId, command.converterId));

    await this.db.insert(boxConverters).values({
      boxId: box.boxId,
      converterId: command.converterId,
      assignedAt: new Date(),
      assignedByTransactionId: transactionId,
    });

    return { converterId: command.converterId, boxId: box.boxId };
  }

  private async applyLockQueue(
    command: Extract<CommandDto, { commandType: "custody.lock_queue_for_processing" }>,
  ): Promise<Record<string, unknown>> {
    const queue = await this.getOrCreateQueue(command.queueId);
    const result = custody.lockQueueForProcessing({
      queueId: queue.queueId,
      state: queue.state,
      lockedForProcessing: queue.lockedForProcessing,
    });
    if (!result.ok) throw new Error(result.error.message);

    await this.db
      .update(queues)
      .set({ state: result.value.state, lockedForProcessing: true })
      .where(eq(queues.queueId, queue.queueId));

    return { queueId: queue.queueId, state: result.value.state };
  }

  private async applyAssignBoxToQueue(
    command: Extract<CommandDto, { commandType: "custody.assign_box_to_queue" }>,
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    const queue = await this.getOrCreateQueue(command.queueId);
    const box = await this.getRequiredBoxByCode(command.boxId);

    await this.db
      .insert(queueBoxes)
      .values({
        queueId: queue.queueId,
        boxId: box.boxId,
        assignedAt: new Date(),
        assignedByTransactionId: transactionId,
      })
      .onConflictDoNothing();

    return {
      queueId: queue.queueId,
      boxId: box.boxId,
      materialType: box.materialType,
    };
  }

  private async applyCreateShipment(
    command: Extract<CommandDto, { commandType: "custody.create_shipment" }>,
  ): Promise<Record<string, unknown>> {
    const originSite = await this.getOrCreateSite(command.originSiteId);
    const destinationSite = await this.getOrCreateSite(command.destinationSiteId);

    const boxRows = [] as Awaited<ReturnType<typeof this.getRequiredBoxByCode>>[];
    for (const boxCode of command.boxCodes) {
      const box = await this.getRequiredBoxByCode(boxCode);
      if (box.state !== "closed" && box.state !== "active") {
        throw new Error(`Box ${boxCode} cannot be shipped from state ${box.state}.`);
      }

      boxRows.push(box);
    }

    const shipmentId = randomUUID();
    await this.db.insert(shipments).values({
      shipmentId,
      shipmentCode: command.shipmentCode,
      state: "in_transit",
      originSiteId: originSite.siteId,
      destinationSiteId: destinationSite.siteId,
      departedAt: new Date(),
      receivedAt: null,
    });

    await this.db.insert(shipmentBoxes).values(
      boxRows.map((box) => ({
        shipmentId,
        boxId: box.boxId,
        assignedAt: new Date(),
      })),
    );

    for (const box of boxRows) {
      await this.db.update(boxes).set({ state: "shipped" }).where(eq(boxes.boxId, box.boxId));
      await this.db
        .update(converters)
        .set({ state: "in_transit" })
        .where(eq(converters.currentBoxId, box.boxId));
    }

    return {
      shipmentId,
      shipmentCode: command.shipmentCode,
      boxCount: boxRows.length,
      state: "in_transit",
    };
  }

  private async applyReceiveShipment(
    command: Extract<CommandDto, { commandType: "custody.receive_shipment" }>,
  ): Promise<Record<string, unknown>> {
    const shipment = await this.getShipmentByRef(command.shipmentRef);
    if (!shipment) {
      throw new Error(`Shipment ${command.shipmentRef} was not found.`);
    }

    const receivingSite = await this.getOrCreateSite(command.receivingSiteId);
    if (shipment.destinationSiteId !== receivingSite.siteId) {
      throw new Error(
        `Shipment destination ${shipment.destinationSiteId} does not match receiving site ${receivingSite.siteId}.`,
      );
    }

    await this.db
      .update(shipments)
      .set({ state: "received", receivedAt: new Date() })
      .where(eq(shipments.shipmentId, shipment.shipmentId));

    const linkedBoxes = await this.db
      .select({ boxId: shipmentBoxes.boxId })
      .from(shipmentBoxes)
      .where(eq(shipmentBoxes.shipmentId, shipment.shipmentId));

    for (const row of linkedBoxes) {
      await this.db.update(boxes).set({ state: "received" }).where(eq(boxes.boxId, row.boxId));
      await this.db
        .update(converters)
        .set({ state: "received" })
        .where(eq(converters.currentBoxId, row.boxId));
    }

    return {
      shipmentId: shipment.shipmentId,
      shipmentCode: shipment.shipmentCode,
      receivedBoxCount: linkedBoxes.length,
      state: "received",
    };
  }

  private async applyGradingDecision(
    command: Extract<CommandDto, { commandType: "grading.issue_decision" }>,
    origin: CommandSubmission["origin"],
  ): Promise<Record<string, unknown>> {
    const library = await this.getOrCreateLibraryEntry(
      command.candidateId,
      command.identificationMethod,
      command.confidence,
    );

    const decision = grading.createGradingDecision({
      decisionId: randomUUID(),
      converterId: command.converterId,
      candidate: {
        candidateId: library.libraryEntryId,
        method: command.identificationMethod,
        confidence: command.confidence,
        baseEstimateUsd: this.estimatedConverterValueUsd(
          command.identificationMethod,
          command.confidence,
        ),
      },
      overrideReason: command.overrideReason ?? undefined,
    });
    if (!decision.ok) throw new Error(decision.error.message);

    const gradingDecisionId = randomUUID();
    await this.db.insert(gradingDecisions).values({
      gradingDecisionId,
      converterId: command.converterId,
      libraryEntryId: library.libraryEntryId,
      method: command.identificationMethod,
      confidenceBand: command.confidence,
      estimatedValueUsd: decision.value.estimatedValueUsd,
      overridden: Boolean(command.overrideReason),
      overrideReason: command.overrideReason,
      decidedByUserId: origin.userId,
      decidedAt: new Date(),
    });

    return { gradingDecisionId };
  }

  private async applyRecordSample(
    command: Extract<CommandDto, { commandType: "analytics.record_sample" }>,
  ): Promise<Record<string, unknown>> {
    const queue = await this.getOrCreateQueue(command.queueId);
    const queueMaterialRows = await this.db
      .select({ materialType: boxes.materialType })
      .from(queueBoxes)
      .leftJoin(boxes, eq(boxes.boxId, queueBoxes.boxId))
      .where(eq(queueBoxes.queueId, queue.queueId));

    if (queueMaterialRows.length === 0) {
      throw new Error(
        `Queue ${queue.queueCode} has no custody-linked material. Sampling requires milled material in queue custody.`,
      );
    }

    const nonMilled = new Set<string>();
    for (const row of queueMaterialRows) {
      const materialType = (row.materialType ?? "unknown").toLowerCase();
      if (!this.isMilledMaterialType(materialType)) {
        nonMilled.add(materialType);
      }
    }

    if (nonMilled.size > 0) {
      throw new Error(
        `Queue ${queue.queueCode} contains non-milled material forms: ${[...nonMilled].join(", ")}. Sampling is only allowed for milled material.`,
      );
    }

    let pt = command.ptPpm;
    let pd = command.pdPpm;
    let rh = command.rhPpm;

    if (command.matrixId) {
      const matrixRows = await this.db
        .select()
        .from(correctionMatrices)
        .where(eq(correctionMatrices.matrixId, command.matrixId))
        .limit(1);

      if (matrixRows.length > 0 && matrixRows[0].qualificationStatus === "qualified") {
        const correction = analytics.applyMatrixCorrection(
          { ptPpm: pt, pdPpm: pd, rhPpm: rh },
          {
            matrixId: matrixRows[0].matrixId,
            materialFingerprint: matrixRows[0].materialFingerprint,
            ptMultiplier: Number(matrixRows[0].ptMultiplier),
            pdMultiplier: Number(matrixRows[0].pdMultiplier),
            rhMultiplier: Number(matrixRows[0].rhMultiplier),
            confidence: "qualified",
          },
        );
        if (correction.ok) {
          pt = correction.value.ptPpm;
          pd = correction.value.pdPpm;
          rh = correction.value.rhPpm;
        }
      }
    }

    const sampleId = randomUUID();
    await this.db.insert(samples).values({
      sampleId,
      queueId: queue.queueId,
      source: command.source,
      matrixId: command.matrixId,
      ptPpmRaw: command.ptPpm.toFixed(4),
      pdPpmRaw: command.pdPpm.toFixed(4),
      rhPpmRaw: command.rhPpm.toFixed(4),
      ptPpmCorrected: pt.toFixed(4),
      pdPpmCorrected: pd.toFixed(4),
      rhPpmCorrected: rh.toFixed(4),
      capturedAt: new Date(),
    });

    return { sampleId, queueId: queue.queueId };
  }

  private async applyResolvePricing(
    command: Extract<CommandDto, { commandType: "pricing.resolve_estimate" }>,
  ): Promise<Record<string, unknown>> {
    if (command.attemptedFieldOverride) {
      throw new Error("Field-origin actors cannot override centrally controlled pricing decisions.");
    }

    const queue = await this.getOrCreateQueue(command.queueId);
    const source = pricing.resolvePricingSource(command.sourceCandidates);
    if (!source.ok) throw new Error(source.error.message);

    const market = await this.getOrCreateMarketSnapshot(command.marketSnapshotId);
    const terms = await this.getOrCreateTermsProfile(command.termsProfileId);

    const assayStats = await this.db
      .select({
        avgPt: sql<string>`coalesce(avg(${samples.ptPpmCorrected}), 0)`,
        avgPd: sql<string>`coalesce(avg(${samples.pdPpmCorrected}), 0)`,
        avgRh: sql<string>`coalesce(avg(${samples.rhPpmCorrected}), 0)`,
        sampleCount: sql<number>`count(*)::int`,
        finalAssayCount: sql<number>`count(*) filter (where ${samples.source} = 'icp_final')::int`,
      })
      .from(samples)
      .where(eq(samples.queueId, queue.queueId));
    const assay = assayStats[0] ?? {
      avgPt: "0",
      avgPd: "0",
      avgRh: "0",
      sampleCount: 0,
      finalAssayCount: 0,
    };

    const queueBoxRows = await this.db
      .select({
        boxId: queueBoxes.boxId,
        materialType: boxes.materialType,
      })
      .from(queueBoxes)
      .leftJoin(boxes, eq(boxes.boxId, queueBoxes.boxId))
      .where(eq(queueBoxes.queueId, queue.queueId));
    const boxIds = queueBoxRows.map((row) => row.boxId);

    const converterCountRows =
      boxIds.length === 0
        ? [{ count: 0 }]
        : await this.db
            .select({
              count: sql<number>`count(distinct ${boxConverters.converterId})::int`,
            })
            .from(boxConverters)
            .where(inArray(boxConverters.boxId, boxIds));
    const converterCount = converterCountRows[0]?.count ?? 0;

    const massRows = await this.db
      .select({
        inputWeightKg: sql<string>`coalesce(sum(${massMeasurements.inputWeightKg}), 0)`,
        outputWeightKg: sql<string>`coalesce(sum(${massMeasurements.outputWeightKg}), 0)`,
      })
      .from(massMeasurements)
      .where(eq(massMeasurements.queueId, queue.queueId));
    const inputWeightKg = Number(massRows[0]?.inputWeightKg ?? "0");
    const outputWeightKg = Number(massRows[0]?.outputWeightKg ?? "0");

    let materialBaseUsd = 0;
    const materialCounts = new Map<string, number>();
    for (const row of queueBoxRows) {
      const materialType = (row.materialType ?? "converter_mix").toLowerCase();
      materialBaseUsd += this.estimatedBoxBaseValueUsd(materialType);
      materialCounts.set(materialType, (materialCounts.get(materialType) ?? 0) + 1);
    }
    if (materialBaseUsd <= 0 && converterCount > 0) {
      materialBaseUsd = converterCount * 1_850;
    }
    const dominantMaterial =
      [...materialCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ??
      "converter_mix";
    const queueFloorUsd =
      dominantMaterial === "processed_catalyst" || dominantMaterial === "catalyst_processed"
        ? 180_000
        : dominantMaterial === "whole_converter" || dominantMaterial === "converter_whole"
        ? 75_000
        : dominantMaterial === "dust_recovery" || dominantMaterial === "baghouse_dust"
            ? 85_000
            : 95_000;

    const marketFactor = this.clamp(
      (Number(market.ptUsdPerOz) + Number(market.pdUsdPerOz) + Number(market.rhUsdPerOz)) /
        (980 + 1105 + 4520),
      0.72,
      1.35,
    );
    const assaySignal = this.clamp(
      Number(assay.avgPt) * 0.00025 + Number(assay.avgPd) * 0.0002 + Number(assay.avgRh) * 0.0012,
      0,
      0.18,
    );
    const assaySignalMultiplier = 0.92 + assaySignal;
    const sourceMultiplier = this.sourcePricingMultiplier(source.value);
    const sampleCoverageMultiplier =
      assay.finalAssayCount > 0 ? 1.03 : assay.sampleCount >= 3 ? 0.99 : assay.sampleCount >= 1 ? 0.93 : 0.86;
    const termsMultiplier = Number(terms.payoutFactor);
    const catalystWeight = outputWeightKg > 0 ? outputWeightKg : inputWeightKg;
    const weightMultiplier =
      dominantMaterial === "processed_catalyst" || dominantMaterial === "catalyst_processed"
        ? this.clamp(catalystWeight / 420, 0.78, 1.32)
        : dominantMaterial === "dust_recovery" || dominantMaterial === "baghouse_dust"
          ? this.clamp(catalystWeight / 260, 0.72, 1.4)
          : 1;
    const grossEstimate =
      materialBaseUsd *
      marketFactor *
      assaySignalMultiplier *
      sourceMultiplier *
      sampleCoverageMultiplier *
      termsMultiplier *
      weightMultiplier;
    const chargeTotal =
      (Number(terms.processingChargeUsd) + Number(terms.treatmentChargeUsd)) *
      Math.max(queueBoxRows.length, 1);
    const finalEstimateUsd = Math.max(queueFloorUsd, grossEstimate - chargeTotal).toFixed(2);

    const confidenceBand: "high" | "medium" | "low" =
      source.value === "vin" && assay.finalAssayCount > 0
        ? "high"
        : source.value === "category_fallback" || assay.sampleCount === 0
          ? "low"
          : "medium";

    const pricingDecisionId = randomUUID();
    await this.db.insert(pricingDecisions).values({
      pricingDecisionId,
      queueId: queue.queueId,
      marketSnapshotId: market.marketSnapshotId,
      termsProfileId: terms.termsProfileId,
      sourceMethod: source.value,
      estimateUsd: finalEstimateUsd,
      confidenceBand,
      decidedAt: new Date(),
    });

    await this.db
      .update(queues)
      .set({ estimatedValueUsd: finalEstimateUsd })
      .where(eq(queues.queueId, queue.queueId));

    return {
      pricingDecisionId,
      estimateUsd: finalEstimateUsd,
      materialBaseUsd: materialBaseUsd.toFixed(2),
      dominantMaterial,
      sampleCount: assay.sampleCount,
      finalAssayCount: assay.finalAssayCount,
      queueFloorUsd: queueFloorUsd.toFixed(2),
    };
  }

  private async applyPostLedgerEntry(
    command: Extract<CommandDto, { commandType: "finance.post_ledger_entry" }>,
    origin: CommandSubmission["origin"],
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    const debit = await this.getOrCreateAccount(command.debitAccountId, "internal");
    const credit = await this.getOrCreateAccount(command.creditAccountId, "buyer");

    const evidenceBundleId = await this.createEvidenceBundle(
      origin,
      origin.capturedAt,
      { lat: 0, lon: 0, accuracyM: 1 },
      ["note"],
    );

    const validation = finance.validateLedgerPosting(
      {
        ledgerEntryId: randomUUID(),
        debitAccountId: debit.accountId,
        creditAccountId: credit.accountId,
        amountUsd: command.amount.amount,
        purposeCode: command.purposeCode,
        sourceOperationalRef: command.sourceOperationalRef,
        notes: command.notes,
        evidence: {
          evidenceBundleId: evidenceBundleId as EvidenceBundleId,
          requiredTypesPresent: command.evidence.requiredTypesPresent,
        },
      },
      new Map([
        [debit.accountId, { accountId: debit.accountId, type: debit.accountType, active: debit.active }],
        [credit.accountId, { accountId: credit.accountId, type: credit.accountType, active: credit.active }],
      ]),
    );
    if (!validation.ok) throw new Error(validation.error.message);

    const ledgerEntryId = randomUUID();
    await this.db.insert(ledgerEntries).values({
      ledgerEntryId,
      transactionId,
      debitAccountId: debit.accountId,
      creditAccountId: credit.accountId,
      purposeCode: command.purposeCode,
      amountUsd: command.amount.amount,
      sourceOperationalRef: command.sourceOperationalRef,
      evidenceBundleId,
      notes: command.notes,
      createdAt: new Date(),
    });

    return { ledgerEntryId };
  }

  private async applyPostAdditiveCorrection(
    command: Extract<CommandDto, { commandType: "finance.post_additive_correction" }>,
    origin: CommandSubmission["origin"],
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    const targetRows = await this.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.ledgerEntryId, command.targetLedgerEntryId))
      .limit(1);
    if (targetRows.length === 0) {
      throw new Error(`Target ledger entry ${command.targetLedgerEntryId} not found.`);
    }

    const correctionValidation = finance.validateAdditiveCorrection({
      correctionEntryId: randomUUID(),
      targetLedgerEntryId: command.targetLedgerEntryId,
      reasonCode: command.reasonCode,
      deltaUsd: command.deltaUsd,
    });
    if (!correctionValidation.ok) {
      throw new Error(correctionValidation.error.message);
    }

    if (command.reconciliationCaseId) {
      const caseRows = await this.db
        .select()
        .from(reconciliationCases)
        .where(eq(reconciliationCases.reconciliationCaseId, command.reconciliationCaseId))
        .limit(1);
      if (caseRows.length === 0) {
        throw new Error(`Reconciliation case ${command.reconciliationCaseId} not found.`);
      }
      if (caseRows[0].status !== "open" && caseRows[0].status !== "investigating") {
        throw new Error(
          `Reconciliation case ${command.reconciliationCaseId} does not accept corrections in status ${caseRows[0].status}.`,
        );
      }
    }

    const target = targetRows[0];
    const delta = Number(command.deltaUsd);
    const absoluteDelta = Math.abs(delta).toFixed(2);
    const correctionDebitAccountId = delta >= 0 ? target.debitAccountId : target.creditAccountId;
    const correctionCreditAccountId = delta >= 0 ? target.creditAccountId : target.debitAccountId;

    const evidenceBundleId = await this.createEvidenceBundle(
      origin,
      origin.capturedAt,
      { lat: 0, lon: 0, accuracyM: 1 },
      ["note"],
    );

    const correctionLedgerEntryId = randomUUID();
    await this.db.insert(ledgerEntries).values({
      ledgerEntryId: correctionLedgerEntryId,
      transactionId,
      debitAccountId: correctionDebitAccountId,
      creditAccountId: correctionCreditAccountId,
      purposeCode: "adjustment",
      amountUsd: absoluteDelta,
      sourceOperationalRef: target.sourceOperationalRef,
      evidenceBundleId,
      notes: command.notes,
      createdAt: new Date(),
    });

    const correctionId = randomUUID();
    await this.db.insert(ledgerCorrections).values({
      correctionId,
      targetLedgerEntryId: target.ledgerEntryId,
      correctionLedgerEntryId,
      reasonCode: command.reasonCode,
      createdAt: new Date(),
    });

    if (command.reconciliationCaseId) {
      await this.db.insert(reconciliationActions).values({
        reconciliationActionId: randomUUID(),
        reconciliationCaseId: command.reconciliationCaseId,
        actionType: "financial_correction_posted",
        actionPayload: {
          targetLedgerEntryId: target.ledgerEntryId,
          correctionLedgerEntryId,
          reasonCode: command.reasonCode,
          deltaUsd: command.deltaUsd,
        },
        createdByUserId: origin.userId,
        createdAt: new Date(),
      });
    }

    return {
      correctionId,
      correctionLedgerEntryId,
      targetLedgerEntryId: target.ledgerEntryId,
      absoluteDeltaUsd: absoluteDelta,
    };
  }

  private async applyOpenHedge(
    command: Extract<CommandDto, { commandType: "hedge.open_position" }>,
  ): Promise<Record<string, unknown>> {
    const hedgePositionId = randomUUID();
    await this.db.insert(hedgePositions).values({
      hedgePositionId,
      layer: command.layer,
      scopeType: command.scopeType,
      scopeId: command.scopeId,
      hedgedPtOz: command.hedgedPtOz.toFixed(6),
      hedgedPdOz: command.hedgedPdOz.toFixed(6),
      hedgedRhOz: command.hedgedRhOz.toFixed(6),
      status: "open",
      openedAt: new Date(),
    });

    return { hedgePositionId };
  }

  private async applySettlementStep(
    command: Extract<CommandDto, { commandType: "settlement.append_step" }>,
    origin: CommandSubmission["origin"],
  ): Promise<Record<string, unknown>> {
    const settlementRow = await this.getOrCreateSettlement(command.settlementId);
    const steps = await this.db
      .select({ stepName: settlementSteps.stepName, stepOrder: settlementSteps.stepOrder })
      .from(settlementSteps)
      .where(eq(settlementSteps.settlementId, settlementRow.settlementId))
      .orderBy(settlementSteps.stepOrder);

    const next = settlement.appendSettlementStep(
      {
        settlementId: settlementRow.settlementId,
        completedSteps: steps.map((step) => step.stepName as settlement.SettlementStep),
        estimatedValueUsd: settlementRow.estimatedValueUsd,
        finalValueUsd: settlementRow.finalValueUsd,
        finalized: settlementRow.status === "finalized",
      },
      command.step,
    );
    if (!next.ok) throw new Error(next.error.message);

    await this.db.insert(settlementSteps).values({
      settlementStepId: randomUUID(),
      settlementId: settlementRow.settlementId,
      stepOrder: steps.length + 1,
      stepName: command.step,
      recordedAt: new Date(),
      recordedByUserId: origin.userId,
    });

    if (command.step === "final_value_calculated") {
      const finalValue = (Number(settlementRow.estimatedValueUsd) * 1.04).toFixed(2);
      const variance = settlement.calculateSettlementVariance(settlementRow.estimatedValueUsd, finalValue);
      if (!variance.ok) throw new Error(variance.error.message);

      await this.db
        .update(settlements)
        .set({ status: "validated", finalValueUsd: finalValue, varianceUsd: variance.value })
        .where(eq(settlements.settlementId, settlementRow.settlementId));
    }

    if (command.step === "invoice_finalized") {
      await this.db
        .update(settlements)
        .set({ status: "finalized", finalizedAt: new Date() })
        .where(eq(settlements.settlementId, settlementRow.settlementId));

      const invoiceId = randomUUID();
      await this.db.insert(invoices).values({
        invoiceId,
        settlementId: settlementRow.settlementId,
        invoiceNumber: `INV-${settlementRow.settlementId.slice(0, 8).toUpperCase()}`,
        status: "final",
        issuedAt: new Date(),
        immutable: true,
      });

      await this.db.insert(invoiceLines).values({
        invoiceLineId: randomUUID(),
        invoiceId,
        lineType: "net_payout",
        description: "Final net payout",
        amountUsd: settlementRow.finalValueUsd ?? settlementRow.estimatedValueUsd,
        sortOrder: 1,
      });

      return { settlementId: settlementRow.settlementId, invoiceId };
    }

    return { settlementId: settlementRow.settlementId, step: command.step };
  }

  private async applyFinalizeSettlementFromAssay(
    command: Extract<CommandDto, { commandType: "settlement.finalize_from_assay" }>,
    origin: CommandSubmission["origin"],
  ): Promise<Record<string, unknown>> {
    const settlementRow = await this.getOrCreateSettlement(command.settlementId);
    const queueRows = await this.db
      .select({
        queueId: queues.queueId,
        queueCode: queues.queueCode,
      })
      .from(queues)
      .where(
        this.isUuid(settlementRow.scopeId)
          ? or(eq(queues.queueId, settlementRow.scopeId), eq(queues.queueCode, settlementRow.scopeId))
          : eq(queues.queueCode, settlementRow.scopeId),
      )
      .limit(1);
    if (queueRows.length === 0) {
      throw new Error(
        `Settlement ${settlementRow.settlementId} cannot finalize because scope ${settlementRow.scopeId} has no queue link.`,
      );
    }
    const queue = queueRows[0];

    const assayCoverageRows = await this.db
      .select({
        totalSampleCount: sql<number>`count(*)::int`,
        icpFinalCount: sql<number>`count(*) filter (where ${samples.source} = 'icp_final')::int`,
      })
      .from(samples)
      .where(eq(samples.queueId, queue.queueId));
    const assayCoverage = assayCoverageRows[0] ?? { totalSampleCount: 0, icpFinalCount: 0 };
    if (assayCoverage.totalSampleCount === 0 || assayCoverage.icpFinalCount === 0) {
      throw new Error(
        `Settlement ${settlementRow.settlementId} cannot finalize without final assay proof (queue ${queue.queueCode}).`,
      );
    }

    const estimate = Number(settlementRow.estimatedValueUsd);
    const finalValue = Number(command.finalValueUsd);
    if (!Number.isFinite(finalValue) || finalValue <= 0) {
      throw new Error(`Final value ${command.finalValueUsd} is invalid for settlement finalization.`);
    }
    if (Number.isFinite(estimate) && estimate > 0) {
      const ratio = finalValue / estimate;
      if (ratio < 0.4 || ratio > 1.8) {
        throw new Error(
          `Final value ${command.finalValueUsd} is outside controlled variance bounds for estimate ${settlementRow.estimatedValueUsd}.`,
        );
      }
    }

    const existingSteps = await this.db
      .select({ stepName: settlementSteps.stepName, stepOrder: settlementSteps.stepOrder })
      .from(settlementSteps)
      .where(eq(settlementSteps.settlementId, settlementRow.settlementId))
      .orderBy(settlementSteps.stepOrder);

    const strictSteps: settlement.SettlementStep[] = [
      "lot_selected",
      "contents_reviewed",
      "sample_data_recorded",
      "adjustments_recorded",
      "weight_basis_locked",
      "hedges_applied",
      "financial_context_applied",
      "final_value_calculated",
      "invoice_finalized",
    ];

    const existingNames = new Set(existingSteps.map((step) => step.stepName));
    let nextOrder = existingSteps.length + 1;
    for (const step of strictSteps) {
      if (!existingNames.has(step)) {
        await this.db.insert(settlementSteps).values({
          settlementStepId: randomUUID(),
          settlementId: settlementRow.settlementId,
          stepOrder: nextOrder,
          stepName: step,
          recordedAt: new Date(),
          recordedByUserId: origin.userId,
        });
        nextOrder += 1;
      }
    }

    const varianceResult = settlement.calculateSettlementVariance(
      settlementRow.estimatedValueUsd,
      command.finalValueUsd,
    );
    if (!varianceResult.ok) {
      throw new Error(varianceResult.error.message);
    }

    await this.db
      .update(settlements)
      .set({
        status: "finalized",
        finalValueUsd: command.finalValueUsd,
        varianceUsd: varianceResult.value,
        finalizedAt: new Date(),
      })
      .where(eq(settlements.settlementId, settlementRow.settlementId));
    await this.db
      .update(queues)
      .set({ state: "settled", lockedForProcessing: true })
      .where(eq(queues.queueId, queue.queueId));

    const existingInvoice = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.settlementId, settlementRow.settlementId))
      .limit(1);

    const invoiceId = existingInvoice.length > 0 ? existingInvoice[0].invoiceId : randomUUID();
    if (existingInvoice.length === 0) {
      await this.db.insert(invoices).values({
        invoiceId,
        settlementId: settlementRow.settlementId,
        invoiceNumber: `INV-${settlementRow.settlementId.slice(0, 8).toUpperCase()}`,
        status: "final",
        issuedAt: new Date(),
        immutable: true,
      });
    }

    const existingLines = await this.db
      .select({ invoiceLineId: invoiceLines.invoiceLineId })
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId));

    if (existingLines.length === 0) {
      await this.db.insert(invoiceLines).values({
        invoiceLineId: randomUUID(),
        invoiceId,
        lineType: "net_payout",
        description: "Final net payout from assay finalization",
        amountUsd: command.finalValueUsd,
        sortOrder: 1,
      });
    }

    return {
      settlementId: settlementRow.settlementId,
      invoiceId,
      finalValueUsd: command.finalValueUsd,
      varianceUsd: varianceResult.value,
    };
  }

  private async applyOpenReconciliation(
    command: Extract<CommandDto, { commandType: "reconciliation.open_case" }>,
  ): Promise<Record<string, unknown>> {
    const reconciliationCaseId = randomUUID();
    await this.db.insert(reconciliationCases).values({
      reconciliationCaseId,
      triggerType: command.triggerType,
      severity: command.severity,
      status: "open",
      scopeType: command.relatedScopeType,
      scopeId: command.relatedScopeId,
      openedAt: new Date(),
    });

    return { reconciliationCaseId };
  }

  private async applyCloseReconciliation(
    command: Extract<CommandDto, { commandType: "reconciliation.close_case" }>,
  ): Promise<Record<string, unknown>> {
    const rows = await this.db
      .select()
      .from(reconciliationCases)
      .where(eq(reconciliationCases.reconciliationCaseId, command.caseId))
      .limit(1);
    if (rows.length === 0) throw new Error(`Reconciliation case ${command.caseId} not found.`);

    const transitioned = reconciliation.transitionReconciliationCase(
      {
        caseId: rows[0].reconciliationCaseId,
        triggerType: rows[0].triggerType as reconciliation.ReconciliationCase["triggerType"],
        severity: rows[0].severity,
        status: rows[0].status,
        relatedScopeType: rows[0].scopeType as reconciliation.ReconciliationCase["relatedScopeType"],
        relatedScopeId: rows[0].scopeId,
        openedAt: rows[0].openedAt.toISOString(),
        closedAt: rows[0].closedAt ? rows[0].closedAt.toISOString() : null,
        closureRationale: rows[0].closureRationale,
      },
      command.status,
      command.closureRationale,
    );
    if (!transitioned.ok) throw new Error(transitioned.error.message);

    await this.db
      .update(reconciliationCases)
      .set({ status: command.status, closureRationale: command.closureRationale, closedAt: new Date() })
      .where(eq(reconciliationCases.reconciliationCaseId, command.caseId));

    return { reconciliationCaseId: command.caseId, status: command.status };
  }

  private async applyRecordReconciliationAction(
    command: Extract<CommandDto, { commandType: "reconciliation.record_action" }>,
    origin: CommandSubmission["origin"],
  ): Promise<Record<string, unknown>> {
    const caseRows = await this.db
      .select()
      .from(reconciliationCases)
      .where(eq(reconciliationCases.reconciliationCaseId, command.caseId))
      .limit(1);
    if (caseRows.length === 0) {
      throw new Error(`Reconciliation case ${command.caseId} not found.`);
    }

    const currentStatus = caseRows[0].status;
    if (currentStatus !== "open" && currentStatus !== "investigating") {
      throw new Error(
        `Reconciliation case ${command.caseId} cannot accept actions in status ${currentStatus}.`,
      );
    }

    let nextStatus = currentStatus;
    if (currentStatus === "open") {
      await this.db
        .update(reconciliationCases)
        .set({ status: "investigating" })
        .where(eq(reconciliationCases.reconciliationCaseId, command.caseId));
      nextStatus = "investigating";
    }

    const reconciliationActionId = randomUUID();
    await this.db.insert(reconciliationActions).values({
      reconciliationActionId,
      reconciliationCaseId: command.caseId,
      actionType: command.actionType,
      actionPayload: command.actionPayload,
      createdByUserId: origin.userId,
      createdAt: new Date(),
    });

    return { reconciliationActionId, reconciliationCaseId: command.caseId, status: nextStatus };
  }

  private async getOrCreateSite(siteCode: string) {
    const rows = await this.db.select().from(sites).where(eq(sites.siteCode, siteCode)).limit(1);
    if (rows.length > 0) return rows[0];

    const siteId = randomUUID();
    await this.db.insert(sites).values({
      siteId,
      siteCode,
      name: `Site ${siteCode}`,
      siteType: "yard",
      createdAt: new Date(),
    });
    const inserted = await this.db.select().from(sites).where(eq(sites.siteId, siteId)).limit(1);
    return inserted[0];
  }

  private async getOrCreateBoxByCode(externalCode: string, transactionId: string) {
    const rows = await this.db.select().from(boxes).where(eq(boxes.externalCode, externalCode)).limit(1);
    if (rows.length > 0) return rows[0];

    const boxId = randomUUID();
    await this.db.insert(boxes).values({
      boxId,
      externalCode,
      materialType: this.inferMaterialTypeFromBoxCode(externalCode),
      state: "active",
      createdByTransactionId: transactionId,
      createdAt: new Date(),
    });
    const inserted = await this.db.select().from(boxes).where(eq(boxes.boxId, boxId)).limit(1);
    return inserted[0];
  }

  private async getRequiredBoxByCode(externalCode: string) {
    const rows = await this.db.select().from(boxes).where(eq(boxes.externalCode, externalCode)).limit(1);
    if (rows.length === 0) {
      throw new Error(`Box ${externalCode} was not found.`);
    }

    return rows[0];
  }

  private async getShipmentByRef(shipmentRef: string) {
    if (this.isUuid(shipmentRef)) {
      const byId = await this.db
        .select()
        .from(shipments)
        .where(eq(shipments.shipmentId, shipmentRef))
        .limit(1);
      if (byId.length > 0) {
        return byId[0];
      }
    }

    const byCode = await this.db
      .select()
      .from(shipments)
      .where(eq(shipments.shipmentCode, shipmentRef))
      .limit(1);
    return byCode.length > 0 ? byCode[0] : null;
  }

  private async getOrCreateQueue(queueCodeOrId: string) {
    if (this.isUuid(queueCodeOrId)) {
      const byId = await this.db.select().from(queues).where(eq(queues.queueId, queueCodeOrId)).limit(1);
      if (byId.length > 0) return byId[0];
    }

    const byCode = await this.db.select().from(queues).where(eq(queues.queueCode, queueCodeOrId)).limit(1);
    if (byCode.length > 0) return byCode[0];

    const queueId = randomUUID();
    await this.db.insert(queues).values({
      queueId,
      queueCode: queueCodeOrId,
      state: "open",
      lockedForProcessing: false,
      createdAt: new Date(),
    });
    const inserted = await this.db.select().from(queues).where(eq(queues.queueId, queueId)).limit(1);
    return inserted[0];
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private async getOrCreateLibraryEntry(
    candidateId: string,
    method: "vin" | "serial" | "library_match" | "category_fallback",
    confidence: "high" | "medium" | "low",
  ) {
    const byId = await this.db
      .select()
      .from(libraryEntries)
      .where(eq(libraryEntries.libraryEntryId, candidateId))
      .limit(1);
    if (byId.length > 0) return byId[0];

    const libraryEntryId = randomUUID();
    await this.db.insert(libraryEntries).values({
      libraryEntryId,
      qualificationStatus: "qualified",
      vinPattern: method === "vin" ? "VIN*" : null,
      serialPattern: method === "serial" ? "SERIAL*" : null,
      morphologicalSignature: { method },
      confidenceBand: confidence,
      createdAt: new Date(),
    });
    const inserted = await this.db
      .select()
      .from(libraryEntries)
      .where(eq(libraryEntries.libraryEntryId, libraryEntryId))
      .limit(1);
    return inserted[0];
  }

  private async getOrCreateMarketSnapshot(requestedId: string) {
    const byId = await this.db
      .select()
      .from(marketSnapshots)
      .where(eq(marketSnapshots.marketSnapshotId, requestedId))
      .limit(1);
    if (byId.length > 0) return byId[0];

    const marketSnapshotId = randomUUID();
    await this.db.insert(marketSnapshots).values({
      marketSnapshotId,
      ptUsdPerOz: "980.00",
      pdUsdPerOz: "1105.00",
      rhUsdPerOz: "4520.00",
      capturedAt: new Date(),
    });
    const inserted = await this.db
      .select()
      .from(marketSnapshots)
      .where(eq(marketSnapshots.marketSnapshotId, marketSnapshotId))
      .limit(1);
    return inserted[0];
  }

  private async getOrCreateTermsProfile(requestedId: string) {
    const byId = await this.db
      .select()
      .from(termsProfiles)
      .where(eq(termsProfiles.termsProfileId, requestedId))
      .limit(1);
    if (byId.length > 0) return byId[0];

    const customer = await this.getOrCreateAccount("customer_demo", "customer");
    const termsProfileId = randomUUID();
    await this.db.insert(termsProfiles).values({
      termsProfileId,
      customerAccountId: customer.accountId,
      payoutFactor: "0.92",
      processingChargeUsd: "25.00",
      treatmentChargeUsd: "14.00",
      activeFrom: new Date(),
      activeTo: null,
    });
    const inserted = await this.db
      .select()
      .from(termsProfiles)
      .where(eq(termsProfiles.termsProfileId, termsProfileId))
      .limit(1);
    return inserted[0];
  }

  private async getOrCreateAccount(
    accountCode: string,
    accountType: "buyer" | "warehouse" | "bank" | "customer" | "internal",
  ) {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(eq(accounts.accountCode, accountCode))
      .limit(1);
    if (rows.length > 0) return rows[0];

    const accountId = randomUUID();
    await this.db.insert(accounts).values({
      accountId,
      accountCode,
      accountType,
      ownerRef: accountCode,
      active: true,
      createdAt: new Date(),
    });
    const inserted = await this.db.select().from(accounts).where(eq(accounts.accountId, accountId)).limit(1);
    return inserted[0];
  }

  private async getOrCreateSettlement(requestedId: string) {
    if (this.isUuid(requestedId)) {
      const byId = await this.db
        .select()
        .from(settlements)
        .where(eq(settlements.settlementId, requestedId))
        .limit(1);
      if (byId.length > 0) return byId[0];
    }

    const byScope = await this.db
      .select()
      .from(settlements)
      .where(eq(settlements.scopeId, requestedId))
      .limit(1);
    if (byScope.length > 0) return byScope[0];

    const queueRows = await this.db
      .select({
        queueId: queues.queueId,
        queueCode: queues.queueCode,
        estimatedValueUsd: queues.estimatedValueUsd,
      })
      .from(queues)
      .where(
        this.isUuid(requestedId)
          ? or(eq(queues.queueId, requestedId), eq(queues.queueCode, requestedId))
          : eq(queues.queueCode, requestedId),
      )
      .limit(1);
    if (queueRows.length === 0) {
      throw new Error(
        `Settlement scope ${requestedId} is not linked to a known queue. Settlement creation requires a queue reference.`,
      );
    }

    const queueScopeId = queueRows[0].queueCode;
    const queueEstimateUsd = queueRows[0]?.estimatedValueUsd ?? null;
    const baselineEstimateUsd = queueEstimateUsd && Number(queueEstimateUsd) > 0 ? queueEstimateUsd : "75000.00";

    const settlementId = randomUUID();
    await this.db.insert(settlements).values({
      settlementId,
      scopeType: "queue",
      scopeId: queueScopeId,
      status: "draft",
      estimatedValueUsd: baselineEstimateUsd,
      createdAt: new Date(),
      finalizedAt: null,
    });
    const inserted = await this.db
      .select()
      .from(settlements)
      .where(eq(settlements.settlementId, settlementId))
      .limit(1);
    return inserted[0];
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private estimatedConverterValueUsd(
    method: "vin" | "serial" | "library_match" | "category_fallback",
    confidence: "high" | "medium" | "low",
  ): string {
    const methodBase: Record<typeof method, number> = {
      vin: 2_350,
      serial: 2_050,
      library_match: 1_650,
      category_fallback: 1_050,
    };
    const confidenceMultiplier: Record<typeof confidence, number> = {
      high: 1,
      medium: 0.92,
      low: 0.84,
    };
    return (methodBase[method] * confidenceMultiplier[confidence]).toFixed(2);
  }

  private sourcePricingMultiplier(
    source: "vin" | "serial" | "library_match" | "category_fallback",
  ): number {
    if (source === "vin") return 1.02;
    if (source === "serial") return 0.99;
    if (source === "library_match") return 0.95;
    return 0.9;
  }

  private estimatedBoxBaseValueUsd(materialType: string): number {
    const normalized = materialType.toLowerCase();
    if (normalized === "whole_converter" || normalized === "converter_whole") return 12_500;
    if (normalized === "processed_catalyst" || normalized === "catalyst_processed") return 190_000;
    if (normalized === "dust_recovery" || normalized === "baghouse_dust") return 74_000;
    if (normalized === "sample_bucket") return 18_000;
    return 45_000;
  }

  private isMilledMaterialType(materialType: string): boolean {
    const normalized = materialType.toLowerCase();
    if (normalized === "processed_catalyst" || normalized === "catalyst_processed") return true;
    if (normalized === "dust_recovery" || normalized === "baghouse_dust") return true;
    if (normalized === "sample_bucket") return true;
    if (normalized.includes("milled")) return true;
    if (normalized.includes("powder")) return true;
    return false;
  }

  private inferMaterialTypeFromBoxCode(externalCode: string): string {
    const normalized = externalCode.toLowerCase();
    if (
      normalized.includes("cat") ||
      normalized.includes("proc") ||
      normalized.includes("pc-") ||
      normalized.includes("processed")
    ) {
      return "processed_catalyst";
    }
    if (
      normalized.includes("whole") ||
      normalized.includes("wc-") ||
      normalized.includes("conv") ||
      normalized.includes("converter")
    ) {
      return "whole_converter";
    }
    if (
      normalized.includes("dust") ||
      normalized.includes("dr-") ||
      normalized.includes("drbox") ||
      normalized.includes("bag") ||
      normalized.includes("recovery")
    ) {
      return "dust_recovery";
    }
    if (normalized.includes("smp") || normalized.includes("sample")) {
      return "sample_bucket";
    }
    return "converter_mix";
  }

  private async createEvidenceBundle(
    origin: CommandSubmission["origin"],
    capturedAt: string,
    location: { lat: number; lon: number; accuracyM: number },
    types: readonly ("image" | "note" | "gps" | "video" | "document")[],
  ): Promise<string> {
    const evidenceBundleId = randomUUID();
    await this.db.insert(evidenceBundles).values({
      evidenceBundleId,
      createdByUserId: origin.userId,
      createdByDeviceId: origin.deviceId,
      capturedAt: new Date(capturedAt),
      gpsLat: location.lat.toFixed(6),
      gpsLon: location.lon.toFixed(6),
      gpsAccuracyM: location.accuracyM.toFixed(3),
    });

    await this.db.insert(evidenceArtifacts).values(
      types.map((type) => {
        const artifactId = randomUUID();
        return {
          artifactId,
          evidenceBundleId,
          evidenceType: type,
          uri: `dcs-proof://${type}/${evidenceBundleId}/${artifactId}`,
          capturedAt: new Date(capturedAt),
        };
      }),
    );

    return evidenceBundleId;
  }
}
