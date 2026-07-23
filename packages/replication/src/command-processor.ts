import { createHash } from "node:crypto";

import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import {
  commandSchema,
  type CommandDto,
  type CommandInputDto,
  type TransactionEnvelopeDto,
} from "@dcs/contracts";
import type { DcsDb } from "@dcs/db";
import {
  accounts,
  boxes,
  boxConverters,
  converters,
  correctionMatrices,
  custodyEvents,
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
  transactionDependencies,
  transactionEnvelopes,
  users,
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
import {
  checksumPayload,
  deterministicTransactionId,
  EventLogRepository,
  type StoredEnvelope,
} from "@dcs/event-log";

import { validateDependency } from "./dependency-validator";
import { assertControlledOrigin, ControlledOriginError } from "./origin-policy";
import {
  processReplicationQueueBatch,
  processReplicationTransaction,
  retryReplicationTransaction,
  type ReplicationAttemptResult,
} from "./replication-worker";

export interface CommandSubmission {
  readonly idempotencyKey: string;
  readonly origin: TransactionEnvelopeDto["origin"];
  readonly createdAt: string;
  readonly dependencies: readonly DependencyRef[];
  readonly command: CommandInputDto;
}

export interface CommandProcessResult {
  readonly transactionId: string;
  readonly status: "duplicate" | "awaiting_validation" | "applied";
  readonly eventType: string;
  readonly effects: Record<string, unknown>;
}

export interface ControlledQueueBatchResult {
  readonly resumed: readonly (
    | CommandProcessResult
    | { readonly transactionId: string; readonly status: "failed"; readonly error: string }
  )[];
  readonly replication: readonly ReplicationAttemptResult[];
}

interface ExecutionContext {
  readonly transactionId: string;
  readonly occurredAt: Date;
}

export class IdempotencyConflictError extends Error {
  public constructor(idempotencyKey: string) {
    super(`Idempotency key ${idempotencyKey} is already bound to a different command payload.`);
    this.name = "IdempotencyConflictError";
  }
}

export class CommandProcessor {
  private readonly eventLog: EventLogRepository;
  private readonly idCounters = new Map<string, number>();

  public constructor(
    private readonly db: DcsDb,
    private readonly executionContext?: ExecutionContext,
  ) {
    this.eventLog = new EventLogRepository(db);
  }

  public async process(submission: CommandSubmission): Promise<CommandProcessResult> {
    const command = commandSchema.parse(submission.command);
    const occurredAt = new Date(submission.createdAt);
    const transactionId = deterministicTransactionId(submission.idempotencyKey);

    let result: CommandProcessResult;
    try {
      result = await this.db.transaction(async (transaction) => {
        const processor = new CommandProcessor(transaction as unknown as DcsDb, {
          transactionId,
          occurredAt,
        });
        await assertControlledOrigin(processor.db, submission.origin, command.commandType);
        return processor.processInTransaction(submission, command);
      });
    } catch (error) {
      const existing = await this.eventLog.findByIdempotencyKey(submission.idempotencyKey);
      if (existing) {
        return this.duplicateResult(existing, command, submission.idempotencyKey);
      }
      if (!(error instanceof ControlledOriginError)) {
        await this.recordFailedSubmission(submission, command, error, occurredAt).catch(() => undefined);
      }
      throw error;
    }

    if (result.status !== "applied") {
      return result;
    }

    const replication = await processReplicationTransaction(this.db, result.transactionId, occurredAt);
    return {
      ...result,
      effects: { ...result.effects, replicationStatus: replication.status },
    };
  }

  public async resumeAwaitingValidation(
    transactionId: string,
    resumedAt = new Date(),
  ): Promise<CommandProcessResult> {
    let result: CommandProcessResult;
    try {
      result = await this.db.transaction(async (transaction) => {
        const db = transaction as unknown as DcsDb;
        await db.execute(
          sql`select transaction_id from transaction_envelopes where transaction_id = ${transactionId} for update`,
        );

        const envelopeRows = await db
          .select()
          .from(transactionEnvelopes)
          .where(eq(transactionEnvelopes.transactionId, transactionId))
          .limit(1);
        const envelope = envelopeRows[0];
        if (!envelope) {
          throw new Error(`Transaction ${transactionId} was not found.`);
        }

        const command = commandSchema.parse(envelope.payload);
        if (envelope.validationState !== "awaiting_validation") {
          return {
            transactionId,
            status: "duplicate" as const,
            eventType: envelope.eventType,
            effects: { priorStatus: envelope.validationState },
          };
        }

        const origin: CommandSubmission["origin"] = {
          sourceSystem: envelope.sourceSystem,
          userId: envelope.originUserId,
          deviceId: envelope.originDeviceId,
          capturedAt: envelope.originCapturedAt.toISOString(),
        };
        const processor = new CommandProcessor(db, {
          transactionId,
          occurredAt: envelope.createdAt,
        });
        await assertControlledOrigin(db, origin, command.commandType);

        const dependencies = await db
          .select()
          .from(transactionDependencies)
          .where(eq(transactionDependencies.transactionId, transactionId));
        const dependencyError = await processor.firstDependencyViolation(
          dependencies.map((dependency) => ({
            entityType: dependency.dependencyEntityType,
            entityId: dependency.dependencyEntityId,
            requiredState: dependency.requiredState,
          })),
        );
        if (dependencyError) {
          await processor.eventLog.markAwaitingValidation(transactionId, dependencyError, resumedAt);
          return {
            transactionId,
            status: "awaiting_validation" as const,
            eventType: envelope.eventType,
            effects: { reason: dependencyError },
          };
        }

        const effects = await processor.applyCommand(command, origin, transactionId);
        await processor.eventLog.markApplied(transactionId, resumedAt);
        return {
          transactionId,
          status: "applied" as const,
          eventType: envelope.eventType,
          effects,
        };
      });
    } catch (error) {
      const rows = await this.db
        .select({ status: transactionEnvelopes.validationState })
        .from(transactionEnvelopes)
        .where(eq(transactionEnvelopes.transactionId, transactionId))
        .limit(1);
      if (rows[0]?.status === "awaiting_validation") {
        await this.eventLog.markFailed(
          transactionId,
          error instanceof Error ? error.message : "Deferred command application failed.",
          resumedAt,
        );
      }
      throw error;
    }

    if (result.status !== "applied") return result;
    const replication = await processReplicationTransaction(this.db, transactionId, resumedAt);
    return {
      ...result,
      effects: { ...result.effects, replicationStatus: replication.status },
    };
  }

  private async processInTransaction(
    submission: CommandSubmission,
    command: CommandDto,
  ): Promise<CommandProcessResult> {
    const existing = await this.eventLog.findByIdempotencyKey(submission.idempotencyKey);
    if (existing) {
      return this.duplicateResult(existing, command, submission.idempotencyKey);
    }

    const envelope = await this.eventLog.appendEnvelope({
      idempotencyKey: submission.idempotencyKey,
      eventType: command.commandType,
      sourceSystem: submission.origin.sourceSystem,
      originUserId: submission.origin.userId,
      originDeviceId: submission.origin.deviceId,
      originCapturedAt: submission.origin.capturedAt,
      payload: command,
      createdAt: submission.createdAt,
      dependencies: submission.dependencies.map((dependency) => ({
        entityType: dependency.entityType,
        entityId: dependency.entityId,
        requiredState: dependency.requiredState,
      })),
      streams: this.replicationStreams(command),
    });

    const dependencyError = await this.firstDependencyViolation(submission.dependencies);
    if (dependencyError) {
      await this.eventLog.markAwaitingValidation(envelope.transactionId, dependencyError, this.occurredAt());
      return {
        transactionId: envelope.transactionId,
        status: "awaiting_validation",
        eventType: command.commandType,
        effects: { reason: dependencyError },
      };
    }

    const effects = await this.applyCommand(command, submission.origin, envelope.transactionId);
    await this.eventLog.markApplied(envelope.transactionId, this.occurredAt());
    return {
      transactionId: envelope.transactionId,
      status: "applied",
      eventType: command.commandType,
      effects,
    };
  }

  private duplicateResult(
    existing: StoredEnvelope,
    command: CommandDto,
    idempotencyKey: string,
  ): CommandProcessResult {
    if (existing.eventType !== command.commandType || checksumPayload(existing.payload) !== checksumPayload(command)) {
      throw new IdempotencyConflictError(idempotencyKey);
    }
    return {
      transactionId: existing.transactionId,
      status: "duplicate",
      eventType: existing.eventType,
      effects: { priorStatus: existing.validationState },
    };
  }

  private async recordFailedSubmission(
    submission: CommandSubmission,
    command: CommandDto,
    error: unknown,
    failedAt: Date,
  ): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const log = new EventLogRepository(transaction as unknown as DcsDb);
      const envelope = await log.appendEnvelope({
        idempotencyKey: submission.idempotencyKey,
        eventType: command.commandType,
        sourceSystem: submission.origin.sourceSystem,
        originUserId: submission.origin.userId,
        originDeviceId: submission.origin.deviceId,
        originCapturedAt: submission.origin.capturedAt,
        payload: command,
        createdAt: submission.createdAt,
        dependencies: submission.dependencies.map((dependency) => ({ ...dependency })),
        streams: this.replicationStreams(command),
      });
      await log.markFailed(
        envelope.transactionId,
        error instanceof Error ? error.message : "Command application failed.",
        failedAt,
      );
    });
  }

  private replicationStreams(command: CommandDto): readonly ("record" | "image")[] {
    return "evidence" in command && command.evidence.requiredTypesPresent.includes("image")
      ? ["record", "image"]
      : ["record"];
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
    return validateDependency(this.db, dependency);
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
      case "custody.close_box":
        return this.applyCloseBox(command, transactionId);
      case "custody.lock_queue_for_processing":
        return this.applyLockQueue(command, transactionId);
      case "custody.assign_box_to_queue":
        return this.applyAssignBoxToQueue(command, transactionId);
      case "custody.create_shipment":
        return this.applyCreateShipment(command, transactionId);
      case "custody.receive_shipment":
        return this.applyReceiveShipment(command, transactionId);
      case "custody.record_event":
        return this.applyRecordCustodyEvent(command, transactionId);
      case "custody.record_mass_measurement":
        return this.applyRecordMassMeasurement(command, origin, transactionId);
      case "grading.issue_decision":
        return this.applyGradingDecision(command, origin, transactionId);
      case "analytics.record_sample":
        return this.applyRecordSample(command, origin, transactionId);
      case "pricing.resolve_estimate":
        return this.applyResolvePricing(command, transactionId);
      case "finance.post_ledger_entry":
        return this.applyPostLedgerEntry(command, origin, transactionId);
      case "finance.post_additive_correction":
        return this.applyPostAdditiveCorrection(command, origin, transactionId);
      case "hedge.open_position":
        return this.applyOpenHedge(command, transactionId);
      case "settlement.append_step":
        return this.applySettlementStep(command, origin, transactionId);
      case "settlement.finalize_from_assay":
        return this.applyFinalizeSettlementFromAssay(command, origin, transactionId);
      case "reconciliation.open_case":
        return this.applyOpenReconciliation(command, transactionId);
      case "reconciliation.record_action":
        return this.applyRecordReconciliationAction(command, origin, transactionId);
      case "reconciliation.close_case":
        return this.applyCloseReconciliation(command, transactionId);
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

    const site = await this.getRequiredSite(command.yardId);
    const box = await this.getOrCreateBoxByCode(command.boxId, transactionId);
    const evidenceBundleId = await this.createEvidenceBundle(
      command.evidence.evidenceBundleId,
      origin,
      command.capturedAt,
      command.location,
      command.evidence.requiredTypesPresent,
    );

    const converterId = this.nextId("effect");
    await this.db.insert(converters).values({
      converterId,
      state: "boxed",
      originTransactionId: transactionId,
      lastTransitionTransactionId: transactionId,
      evidenceBundleId,
      currentBoxId: box.boxId,
      vinOrSerial: command.vinOrSerial,
      capturedAt: new Date(command.capturedAt),
      capturedSiteId: site.siteId,
    });

    await this.db.insert(boxConverters).values({
      boxId: box.boxId,
      converterId,
      assignedAt: this.occurredAt(),
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
      .set({ currentBoxId: box.boxId, state: "boxed", lastTransitionTransactionId: transactionId })
      .where(eq(converters.converterId, command.converterId));

    await this.db.insert(boxConverters).values({
      boxId: box.boxId,
      converterId: command.converterId,
      assignedAt: this.occurredAt(),
      assignedByTransactionId: transactionId,
    });

    return { converterId: command.converterId, boxId: box.boxId };
  }

  private async applyLockQueue(
    command: Extract<CommandDto, { commandType: "custody.lock_queue_for_processing" }>,
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    const queue = await this.getRequiredQueue(command.queueId);
    const queueBoxCountRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(queueBoxes)
      .where(eq(queueBoxes.queueId, queue.queueId));
    const queueBoxCount = queueBoxCountRows[0]?.count ?? 0;
    if (queueBoxCount === 0) {
      throw new Error(`Queue ${command.queueId} cannot lock without custody-linked boxes.`);
    }
    const result = custody.lockQueueForProcessing({
      queueId: queue.queueId,
      state: queue.state,
      lockedForProcessing: queue.lockedForProcessing,
    });
    if (!result.ok) throw new Error(result.error.message);

    await this.db
      .update(queues)
      .set({
        state: result.value.state,
        lockedForProcessing: true,
        lastTransitionTransactionId: transactionId,
      })
      .where(eq(queues.queueId, queue.queueId));
    await this.updateQueueConverterState(queue.queueId, "processing", transactionId);

    return { queueId: queue.queueId, state: result.value.state };
  }

  private async applyCloseBox(
    command: Extract<CommandDto, { commandType: "custody.close_box" }>,
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    const box = await this.getRequiredBoxByCode(command.boxId);
    const converterCountRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(boxConverters)
      .where(eq(boxConverters.boxId, box.boxId));
    const converterCount = converterCountRows[0]?.count ?? 0;
    if (converterCount === 0) {
      throw new Error(`Box ${command.boxId} cannot close without custody-linked material.`);
    }
    const transition = custody.transitionBoxState(
      { boxId: box.boxId, state: box.state, converterCount },
      "closed",
    );
    if (!transition.ok) throw new Error(transition.error.message);

    await this.db
      .update(boxes)
      .set({ state: "closed", lastTransitionTransactionId: transactionId })
      .where(eq(boxes.boxId, box.boxId));
    return { boxId: box.boxId, state: "closed", converterCount };
  }

  private async applyAssignBoxToQueue(
    command: Extract<CommandDto, { commandType: "custody.assign_box_to_queue" }>,
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    const queue = await this.getOrCreateQueue(command.queueId, transactionId);
    const box = await this.getRequiredBoxByCode(command.boxId);
    if (queue.lockedForProcessing) {
      throw new Error(`Queue ${queue.queueCode} is locked; box membership cannot change.`);
    }

    const existingAssignments = await this.db
      .select({ queueId: queueBoxes.queueId })
      .from(queueBoxes)
      .where(eq(queueBoxes.boxId, box.boxId))
      .limit(1);
    if (existingAssignments.length > 0) {
      throw new Error(
        existingAssignments[0].queueId === queue.queueId
          ? `Box ${command.boxId} is already assigned to queue ${queue.queueCode}.`
          : `Box ${command.boxId} is already assigned to a different queue.`,
      );
    }

    await this.db.insert(queueBoxes).values({
      queueId: queue.queueId,
      boxId: box.boxId,
      assignedAt: this.occurredAt(),
      assignedByTransactionId: transactionId,
    });

    await this.db
      .update(converters)
      .set({ state: "queued", lastTransitionTransactionId: transactionId })
      .where(eq(converters.currentBoxId, box.boxId));

    return {
      queueId: queue.queueId,
      boxId: box.boxId,
      materialType: box.materialType,
    };
  }

  private async applyCreateShipment(
    command: Extract<CommandDto, { commandType: "custody.create_shipment" }>,
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    const originSite = await this.getRequiredSite(command.originSiteId);
    const destinationSite = await this.getRequiredSite(command.destinationSiteId);

    const boxRows = [] as Awaited<ReturnType<typeof this.getRequiredBoxByCode>>[];
    for (const boxCode of command.boxCodes) {
      const box = await this.getRequiredBoxByCode(boxCode);
      if (box.state !== "closed") {
        throw new Error(`Box ${boxCode} cannot be shipped from state ${box.state}.`);
      }

      boxRows.push(box);
    }

    const shipmentId = this.nextId("effect");
    await this.db.insert(shipments).values({
      shipmentId,
      createdByTransactionId: transactionId,
      lastTransitionTransactionId: transactionId,
      shipmentCode: command.shipmentCode,
      state: "in_transit",
      originSiteId: originSite.siteId,
      destinationSiteId: destinationSite.siteId,
      departedAt: this.occurredAt(),
      receivedAt: null,
    });

    await this.db.insert(shipmentBoxes).values(
      boxRows.map((box) => ({
        shipmentId,
        boxId: box.boxId,
        assignedByTransactionId: transactionId,
        assignedAt: this.occurredAt(),
      })),
    );

    for (const box of boxRows) {
      await this.db
        .update(boxes)
        .set({ state: "shipped", lastTransitionTransactionId: transactionId })
        .where(eq(boxes.boxId, box.boxId));
      await this.db
        .update(converters)
        .set({ state: "in_transit", lastTransitionTransactionId: transactionId })
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
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    const shipment = await this.getShipmentByRef(command.shipmentRef);
    if (!shipment) {
      throw new Error(`Shipment ${command.shipmentRef} was not found.`);
    }
    if (shipment.state !== "in_transit") {
      throw new Error(`Shipment ${command.shipmentRef} cannot be received from state ${shipment.state}.`);
    }

    const receivingSite = await this.getRequiredSite(command.receivingSiteId);
    if (shipment.destinationSiteId !== receivingSite.siteId) {
      throw new Error(
        `Shipment destination ${shipment.destinationSiteId} does not match receiving site ${receivingSite.siteId}.`,
      );
    }

    await this.db
      .update(shipments)
      .set({
        state: "received",
        receivedAt: this.occurredAt(),
        lastTransitionTransactionId: transactionId,
      })
      .where(eq(shipments.shipmentId, shipment.shipmentId));

    const linkedBoxes = await this.db
      .select({ boxId: shipmentBoxes.boxId })
      .from(shipmentBoxes)
      .where(eq(shipmentBoxes.shipmentId, shipment.shipmentId));

    for (const row of linkedBoxes) {
      await this.db
        .update(boxes)
        .set({ state: "received", lastTransitionTransactionId: transactionId })
        .where(eq(boxes.boxId, row.boxId));
      await this.db
        .update(converters)
        .set({ state: "received", lastTransitionTransactionId: transactionId })
        .where(eq(converters.currentBoxId, row.boxId));
    }

    return {
      shipmentId: shipment.shipmentId,
      shipmentCode: shipment.shipmentCode,
      receivedBoxCount: linkedBoxes.length,
      state: "received",
    };
  }

  private async applyRecordCustodyEvent(
    command: Extract<CommandDto, { commandType: "custody.record_event" }>,
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    if (command.scopeType === "queue") {
      await this.getRequiredQueue(command.scopeId);
    } else {
      const shipment = await this.getShipmentByRef(command.scopeId);
      if (!shipment) throw new Error(`Shipment ${command.scopeId} was not found.`);
    }
    await this.getRequiredEvidenceBundle(
      command.evidence.evidenceBundleId,
      command.evidence.requiredTypesPresent,
    );

    const custodyEventId = this.nextId("effect");
    await this.db.insert(custodyEvents).values({
      custodyEventId,
      transactionId,
      scopeType: command.scopeType,
      scopeId: command.scopeId,
      eventType: command.eventType,
      evidenceBundleId: command.evidence.evidenceBundleId,
      createdAt: new Date(command.capturedAt),
    });
    return { custodyEventId, scopeType: command.scopeType, scopeId: command.scopeId };
  }

  private async applyRecordMassMeasurement(
    command: Extract<CommandDto, { commandType: "custody.record_mass_measurement" }>,
    origin: CommandSubmission["origin"],
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    const queue = await this.getRequiredQueue(command.queueId);
    if (!queue.lockedForProcessing) {
      throw new Error(`Queue ${queue.queueCode} must be locked before mass measurement.`);
    }
    if (queue.state === "settled") {
      throw new Error(`Queue ${queue.queueCode} cannot accept mass measurements after settlement.`);
    }

    const lockedWeightRows = await this.db
      .select({ settlementStepId: settlementSteps.settlementStepId })
      .from(settlementSteps)
      .innerJoin(settlements, eq(settlementSteps.settlementId, settlements.settlementId))
      .where(
        and(
          or(eq(settlements.scopeId, queue.queueId), eq(settlements.scopeId, queue.queueCode)),
          eq(settlementSteps.stepName, "weight_basis_locked"),
        ),
      )
      .limit(1);
    if (lockedWeightRows.length > 0) {
      throw new Error(`Queue ${queue.queueCode} cannot accept mass measurements after weight basis lock.`);
    }

    const expectedLoss = command.inputWeightKg - command.outputWeightKg;
    if (command.outputWeightKg > command.inputWeightKg) {
      throw new Error("Mass measurement output cannot exceed input.");
    }
    if (Math.abs(expectedLoss - command.explainedLossKg) > 0.01) {
      throw new Error("Mass measurement loss must reconcile input and output within 0.01 kg.");
    }

    const evidenceBundleId = await this.createEvidenceBundle(
      command.evidence.evidenceBundleId,
      origin,
      command.capturedAt,
      null,
      command.evidence.requiredTypesPresent,
    );
    const massMeasurementId = this.nextId("effect");
    await this.db.insert(massMeasurements).values({
      massMeasurementId,
      transactionId,
      queueId: queue.queueId,
      evidenceBundleId,
      stage: command.stage,
      inputWeightKg: command.inputWeightKg.toFixed(3),
      outputWeightKg: command.outputWeightKg.toFixed(3),
      explainedLossKg: command.explainedLossKg.toFixed(3),
      capturedAt: new Date(command.capturedAt),
    });
    return { massMeasurementId, queueId: queue.queueId, reconciledLossKg: expectedLoss.toFixed(3) };
  }

  private async applyGradingDecision(
    command: Extract<CommandDto, { commandType: "grading.issue_decision" }>,
    origin: CommandSubmission["origin"],
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    const library = await this.getRequiredLibraryEntry(
      command.candidateId,
      command.identificationMethod,
      command.confidence,
    );

    const decision = grading.createGradingDecision({
      decisionId: this.nextId("effect"),
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

    const gradingDecisionId = this.nextId("effect");
    await this.db.insert(gradingDecisions).values({
      gradingDecisionId,
      transactionId,
      converterId: command.converterId,
      libraryEntryId: library.libraryEntryId,
      method: command.identificationMethod,
      confidenceBand: command.confidence,
      estimatedValueUsd: decision.value.estimatedValueUsd,
      overridden: Boolean(command.overrideReason),
      overrideReason: command.overrideReason,
      decidedByUserId: origin.userId,
      decidedAt: this.occurredAt(),
    });

    return { gradingDecisionId };
  }

  private async applyRecordSample(
    command: Extract<CommandDto, { commandType: "analytics.record_sample" }>,
    origin: CommandSubmission["origin"],
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    const queue = await this.getRequiredQueue(command.queueId);
    if (!queue.lockedForProcessing || !["processing", "sampled", "assay_pending"].includes(queue.state)) {
      throw new Error(`Queue ${queue.queueCode} must be in controlled processing before sampling.`);
    }

    const inTransitRows = await this.db
      .select({ shipmentId: shipments.shipmentId })
      .from(queueBoxes)
      .innerJoin(shipmentBoxes, eq(queueBoxes.boxId, shipmentBoxes.boxId))
      .innerJoin(shipments, eq(shipmentBoxes.shipmentId, shipments.shipmentId))
      .where(and(eq(queueBoxes.queueId, queue.queueId), eq(shipments.state, "in_transit")))
      .limit(1);
    if (inTransitRows.length > 0) {
      throw new Error(`Queue ${queue.queueCode} cannot be sampled while linked material is in transit.`);
    }
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

    const evidenceBundleId = await this.createEvidenceBundle(
      command.evidence.evidenceBundleId,
      origin,
      origin.capturedAt,
      null,
      command.evidence.requiredTypesPresent,
    );

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

    const sampleId = this.nextId("effect");
    await this.db.insert(samples).values({
      sampleId,
      transactionId,
      queueId: queue.queueId,
      source: command.source,
      matrixId: command.matrixId,
      evidenceBundleId,
      ptPpmRaw: command.ptPpm.toFixed(4),
      pdPpmRaw: command.pdPpm.toFixed(4),
      rhPpmRaw: command.rhPpm.toFixed(4),
      ptPpmCorrected: pt.toFixed(4),
      pdPpmCorrected: pd.toFixed(4),
      rhPpmCorrected: rh.toFixed(4),
      capturedAt: this.occurredAt(),
    });

    let nextQueueState: custody.QueueState = queue.state;
    if (nextQueueState === "processing") {
      const transition = custody.transitionQueueState(queue, "sampled");
      if (!transition.ok) throw new Error(transition.error.message);
      nextQueueState = transition.value.state;
    }
    if (command.source === "icp_final" && nextQueueState === "sampled") {
      const transition = custody.transitionQueueState(
        { ...queue, state: nextQueueState },
        "assay_pending",
      );
      if (!transition.ok) throw new Error(transition.error.message);
      nextQueueState = transition.value.state;
    }
    if (nextQueueState !== queue.state) {
      await this.db
        .update(queues)
        .set({ state: nextQueueState, lastTransitionTransactionId: transactionId })
        .where(eq(queues.queueId, queue.queueId));
    }
    await this.updateQueueConverterState(queue.queueId, "sampled", transactionId);

    return { sampleId, queueId: queue.queueId, evidenceBundleId, queueState: nextQueueState };
  }

  private async applyResolvePricing(
    command: Extract<CommandDto, { commandType: "pricing.resolve_estimate" }>,
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    if (command.attemptedFieldOverride) {
      throw new Error("Field-origin actors cannot override centrally controlled pricing decisions.");
    }

    const queue = await this.getRequiredQueue(command.queueId);
    if (!queue.lockedForProcessing || queue.state === "settled") {
      throw new Error(`Queue ${queue.queueCode} is not eligible for controlled pricing.`);
    }
    const source = pricing.resolvePricingSource(command.sourceCandidates);
    if (!source.ok) throw new Error(source.error.message);

    const market = await this.getRequiredMarketSnapshot(command.marketSnapshotId);
    const terms = await this.getRequiredTermsProfile(command.termsProfileId);

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
    if (boxIds.length === 0) {
      throw new Error(`Queue ${queue.queueCode} cannot be priced without custody-linked material.`);
    }

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

    const pricingDecisionId = this.nextId("effect");
    await this.db.insert(pricingDecisions).values({
      pricingDecisionId,
      transactionId,
      queueId: queue.queueId,
      marketSnapshotId: market.marketSnapshotId,
      termsProfileId: terms.termsProfileId,
      sourceMethod: source.value,
      estimateUsd: finalEstimateUsd,
      confidenceBand,
      decidedAt: this.occurredAt(),
    });

    let nextQueueState: custody.QueueState = queue.state;
    if (assay.finalAssayCount > 0 && queue.state === "assay_pending") {
      const transition = custody.transitionQueueState(queue, "valued");
      if (!transition.ok) throw new Error(transition.error.message);
      nextQueueState = transition.value.state;
    }

    await this.db
      .update(queues)
      .set({
        estimatedValueUsd: finalEstimateUsd,
        state: nextQueueState,
        lastTransitionTransactionId: transactionId,
      })
      .where(eq(queues.queueId, queue.queueId));

    return {
      pricingDecisionId,
      estimateUsd: finalEstimateUsd,
      materialBaseUsd: materialBaseUsd.toFixed(2),
      dominantMaterial,
      sampleCount: assay.sampleCount,
      finalAssayCount: assay.finalAssayCount,
      queueFloorUsd: queueFloorUsd.toFixed(2),
      queueState: nextQueueState,
    };
  }

  private async applyPostLedgerEntry(
    command: Extract<CommandDto, { commandType: "finance.post_ledger_entry" }>,
    origin: CommandSubmission["origin"],
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    const debit = await this.getRequiredAccount(command.debitAccountId);
    const credit = await this.getRequiredAccount(command.creditAccountId);
    await this.assertOperationalReference(command.sourceOperationalRef);

    if (command.purposeCode === "funding_advance" && !command.approvedByUserId) {
      throw new Error("Funding advances require an approving actor.");
    }
    if (command.approvedByUserId === origin.userId) {
      throw new Error("The approving actor and executing actor must be different users.");
    }
    if (command.approvedByUserId) {
      const approverRows = await this.db
        .select({ role: users.role, active: users.active })
        .from(users)
        .where(eq(users.userId, command.approvedByUserId))
        .limit(1);
      const approver = approverRows[0];
      if (!approver?.active || !["finance_approver", "control_admin", "supervisor"].includes(approver.role)) {
        throw new Error("The funding approving actor is unknown, inactive, or lacks approval authority.");
      }
    }

    const evidenceBundleId = await this.createEvidenceBundle(
      command.evidence.evidenceBundleId,
      origin,
      origin.capturedAt,
      null,
      command.evidence.requiredTypesPresent,
    );

    const validation = finance.validateLedgerPosting(
      {
        ledgerEntryId: this.nextId("effect"),
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

    const ledgerEntryId = this.nextId("effect");
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
      approvedByUserId: command.approvedByUserId,
      executedByUserId: origin.userId,
      createdAt: this.occurredAt(),
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
      correctionEntryId: this.nextId("effect"),
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
      command.evidence.evidenceBundleId,
      origin,
      origin.capturedAt,
      null,
      command.evidence.requiredTypesPresent,
    );

    const correctionLedgerEntryId = this.nextId("effect");
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
      approvedByUserId: null,
      executedByUserId: origin.userId,
      createdAt: this.occurredAt(),
    });

    const correctionId = this.nextId("effect");
    await this.db.insert(ledgerCorrections).values({
      correctionId,
      targetLedgerEntryId: target.ledgerEntryId,
      correctionLedgerEntryId,
      reasonCode: command.reasonCode,
      createdAt: this.occurredAt(),
    });

    if (command.reconciliationCaseId) {
      const caseRows = await this.db
        .select({ status: reconciliationCases.status })
        .from(reconciliationCases)
        .where(eq(reconciliationCases.reconciliationCaseId, command.reconciliationCaseId))
        .limit(1);
      const reconciliationCase = caseRows[0];
      if (!reconciliationCase) {
        throw new Error(`Reconciliation case ${command.reconciliationCaseId} not found.`);
      }
      if (reconciliationCase.status !== "open" && reconciliationCase.status !== "investigating") {
        throw new Error(
          `Reconciliation case ${command.reconciliationCaseId} cannot accept corrections in status ${reconciliationCase.status}.`,
        );
      }
      if (reconciliationCase.status === "open") {
        await this.db
          .update(reconciliationCases)
          .set({ status: "investigating", lastTransitionTransactionId: transactionId })
          .where(eq(reconciliationCases.reconciliationCaseId, command.reconciliationCaseId));
      }
      await this.db.insert(reconciliationActions).values({
        reconciliationActionId: this.nextId("effect"),
        transactionId,
        reconciliationCaseId: command.reconciliationCaseId,
        actionType: "financial_correction_posted",
        actionPayload: {
          targetLedgerEntryId: target.ledgerEntryId,
          correctionLedgerEntryId,
          reasonCode: command.reasonCode,
          deltaUsd: command.deltaUsd,
        },
        createdByUserId: origin.userId,
        createdAt: this.occurredAt(),
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
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    const hedgePositionId = this.nextId("effect");
    await this.db.insert(hedgePositions).values({
      hedgePositionId,
      transactionId,
      layer: command.layer,
      scopeType: command.scopeType,
      scopeId: command.scopeId,
      hedgedPtOz: command.hedgedPtOz.toFixed(6),
      hedgedPdOz: command.hedgedPdOz.toFixed(6),
      hedgedRhOz: command.hedgedRhOz.toFixed(6),
      status: "open",
      openedAt: this.occurredAt(),
    });

    return { hedgePositionId };
  }

  private async applySettlementStep(
    command: Extract<CommandDto, { commandType: "settlement.append_step" }>,
    origin: CommandSubmission["origin"],
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    if (command.step === "final_value_calculated" || command.step === "invoice_finalized") {
      throw new Error(
        `${command.step} is system-derived and can only be recorded by settlement.finalize_from_assay.`,
      );
    }
    const settlementRow = await this.getOrCreateSettlement(command.settlementId, transactionId);
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
      settlementStepId: this.nextId("effect"),
      transactionId,
      settlementId: settlementRow.settlementId,
      stepOrder: steps.length + 1,
      stepName: command.step,
      recordedAt: this.occurredAt(),
      recordedByUserId: origin.userId,
    });

    return { settlementId: settlementRow.settlementId, step: command.step };
  }

  private async applyFinalizeSettlementFromAssay(
    command: Extract<CommandDto, { commandType: "settlement.finalize_from_assay" }>,
    origin: CommandSubmission["origin"],
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    const settlementRow = await this.getOrCreateSettlement(command.settlementId, transactionId);
    if (settlementRow.status === "finalized") {
      throw new Error(`Settlement ${settlementRow.settlementId} is already finalized and cannot be rewritten.`);
    }
    const queueRows = await this.db
      .select({
        queueId: queues.queueId,
        queueCode: queues.queueCode,
        state: queues.state,
        lockedForProcessing: queues.lockedForProcessing,
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
    if (!queue.lockedForProcessing || !["assay_pending", "valued"].includes(queue.state)) {
      throw new Error(
        `Settlement ${settlementRow.settlementId} cannot finalize while queue ${queue.queueCode} is ${queue.state}.`,
      );
    }

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

    const requiredOperatorSteps: settlement.SettlementStep[] = [
      "lot_selected",
      "contents_reviewed",
      "sample_data_recorded",
      "adjustments_recorded",
      "weight_basis_locked",
      "hedges_applied",
      "financial_context_applied",
    ];

    const existingNames = existingSteps.map((step) => step.stepName);
    const missingSteps = requiredOperatorSteps.filter(
      (step, index) => existingNames[index] !== step,
    );
    if (missingSteps.length > 0 || existingNames.length !== requiredOperatorSteps.length) {
      throw new Error(
        `Settlement ${settlementRow.settlementId} is missing ordered operator controls: ${missingSteps.join(", ") || "unexpected step sequence"}.`,
      );
    }

    const varianceResult = settlement.calculateSettlementVariance(
      settlementRow.estimatedValueUsd,
      command.finalValueUsd,
    );
    if (!varianceResult.ok) {
      throw new Error(varianceResult.error.message);
    }

    await this.db.insert(settlementSteps).values([
      {
        settlementStepId: this.nextId("effect"),
        transactionId,
        settlementId: settlementRow.settlementId,
        stepOrder: requiredOperatorSteps.length + 1,
        stepName: "final_value_calculated",
        recordedAt: this.occurredAt(),
        recordedByUserId: origin.userId,
      },
      {
        settlementStepId: this.nextId("effect"),
        transactionId,
        settlementId: settlementRow.settlementId,
        stepOrder: requiredOperatorSteps.length + 2,
        stepName: "invoice_finalized",
        recordedAt: this.occurredAt(),
        recordedByUserId: origin.userId,
      },
    ]);

    const existingInvoice = await this.db
      .select()
      .from(invoices)
      .where(eq(invoices.settlementId, settlementRow.settlementId))
      .limit(1);

    if (existingInvoice.length > 0) {
      throw new Error(`Settlement ${settlementRow.settlementId} already has a final invoice.`);
    }

    const invoiceId = this.nextId("effect");
    await this.db.insert(invoices).values({
      invoiceId,
      transactionId,
      settlementId: settlementRow.settlementId,
      invoiceNumber: `INV-${settlementRow.settlementId.slice(0, 8).toUpperCase()}`,
      status: "final",
      issuedAt: this.occurredAt(),
      immutable: true,
    });

    await this.db.insert(invoiceLines).values({
      invoiceLineId: this.nextId("effect"),
      invoiceId,
      lineType: "net_payout",
      description: "Final net payout from assay finalization",
      amountUsd: command.finalValueUsd,
      sortOrder: 1,
    });

    let finalQueueState = queue.state;
    if (finalQueueState === "assay_pending") {
      const valued = custody.transitionQueueState({ ...queue, state: finalQueueState }, "valued");
      if (!valued.ok) throw new Error(valued.error.message);
      finalQueueState = valued.value.state;
    }
    const settled = custody.transitionQueueState({ ...queue, state: finalQueueState }, "settled");
    if (!settled.ok) throw new Error(settled.error.message);

    await this.db
      .update(settlements)
      .set({
        status: "finalized",
        finalValueUsd: command.finalValueUsd,
        varianceUsd: varianceResult.value,
        finalizedAt: this.occurredAt(),
        finalizedByTransactionId: transactionId,
      })
      .where(eq(settlements.settlementId, settlementRow.settlementId));
    await this.db
      .update(queues)
      .set({
        state: settled.value.state,
        lockedForProcessing: true,
        lastTransitionTransactionId: transactionId,
      })
      .where(eq(queues.queueId, queue.queueId));
    await this.updateQueueConverterState(queue.queueId, "settled", transactionId);

    return {
      settlementId: settlementRow.settlementId,
      invoiceId,
      finalValueUsd: command.finalValueUsd,
      varianceUsd: varianceResult.value,
    };
  }

  private async applyOpenReconciliation(
    command: Extract<CommandDto, { commandType: "reconciliation.open_case" }>,
    transactionId: string,
  ): Promise<Record<string, unknown>> {
    const reconciliationCaseId = this.nextId("effect");
    await this.db.insert(reconciliationCases).values({
      reconciliationCaseId,
      openedByTransactionId: transactionId,
      lastTransitionTransactionId: transactionId,
      triggerType: command.triggerType,
      severity: command.severity,
      status: "open",
      scopeType: command.relatedScopeType,
      scopeId: command.relatedScopeId,
      openedAt: this.occurredAt(),
    });

    return { reconciliationCaseId };
  }

  private async applyCloseReconciliation(
    command: Extract<CommandDto, { commandType: "reconciliation.close_case" }>,
    transactionId: string,
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
      .set({
        status: command.status,
        closureRationale: command.closureRationale,
        closedAt: this.occurredAt(),
        closedByTransactionId: transactionId,
        lastTransitionTransactionId: transactionId,
      })
      .where(eq(reconciliationCases.reconciliationCaseId, command.caseId));

    return { reconciliationCaseId: command.caseId, status: command.status };
  }

  private async applyRecordReconciliationAction(
    command: Extract<CommandDto, { commandType: "reconciliation.record_action" }>,
    origin: CommandSubmission["origin"],
    transactionId: string,
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
        .set({ status: "investigating", lastTransitionTransactionId: transactionId })
        .where(eq(reconciliationCases.reconciliationCaseId, command.caseId));
      nextStatus = "investigating";
    }

    const reconciliationActionId = this.nextId("effect");
    await this.db.insert(reconciliationActions).values({
      reconciliationActionId,
      transactionId,
      reconciliationCaseId: command.caseId,
      actionType: command.actionType,
      actionPayload: command.actionPayload,
      createdByUserId: origin.userId,
      createdAt: this.occurredAt(),
    });

    return { reconciliationActionId, reconciliationCaseId: command.caseId, status: nextStatus };
  }

  private async getRequiredSite(siteCode: string) {
    const rows = await this.db.select().from(sites).where(eq(sites.siteCode, siteCode)).limit(1);
    if (rows.length > 0) return rows[0];
    throw new Error(`Site ${siteCode} is not registered in controlled master data.`);
  }

  private async getOrCreateBoxByCode(externalCode: string, transactionId: string) {
    const rows = await this.db.select().from(boxes).where(eq(boxes.externalCode, externalCode)).limit(1);
    if (rows.length > 0) return rows[0];

    const boxId = this.nextId("effect");
    await this.db.insert(boxes).values({
      boxId,
      externalCode,
      materialType: this.inferMaterialTypeFromBoxCode(externalCode),
      state: "active",
      createdByTransactionId: transactionId,
      lastTransitionTransactionId: transactionId,
      createdAt: this.occurredAt(),
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

  private async getOrCreateQueue(queueCodeOrId: string, transactionId: string) {
    if (this.isUuid(queueCodeOrId)) {
      const byId = await this.db.select().from(queues).where(eq(queues.queueId, queueCodeOrId)).limit(1);
      if (byId.length > 0) return byId[0];
    }

    const byCode = await this.db.select().from(queues).where(eq(queues.queueCode, queueCodeOrId)).limit(1);
    if (byCode.length > 0) return byCode[0];

    const queueId = this.nextId("effect");
    await this.db.insert(queues).values({
      queueId,
      createdByTransactionId: transactionId,
      lastTransitionTransactionId: transactionId,
      queueCode: queueCodeOrId,
      state: "open",
      lockedForProcessing: false,
      createdAt: this.occurredAt(),
    });
    const inserted = await this.db.select().from(queues).where(eq(queues.queueId, queueId)).limit(1);
    return inserted[0];
  }

  private async getRequiredQueue(queueCodeOrId: string) {
    if (this.isUuid(queueCodeOrId)) {
      const byId = await this.db
        .select()
        .from(queues)
        .where(eq(queues.queueId, queueCodeOrId))
        .limit(1);
      if (byId.length > 0) return byId[0];
    }

    const byCode = await this.db
      .select()
      .from(queues)
      .where(eq(queues.queueCode, queueCodeOrId))
      .limit(1);
    if (byCode.length > 0) return byCode[0];
    throw new Error(`Queue ${queueCodeOrId} was not found.`);
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private async getRequiredLibraryEntry(
    candidateId: string,
    method: "vin" | "serial" | "library_match" | "category_fallback",
    confidence: "high" | "medium" | "low",
  ) {
    const byId = await this.db
      .select()
      .from(libraryEntries)
      .where(eq(libraryEntries.libraryEntryId, candidateId))
      .limit(1);
    const entry = byId[0];
    if (!entry || entry.qualificationStatus !== "qualified") {
      throw new Error(`Smart Library entry ${candidateId} is unknown or not qualified.`);
    }
    const confidenceRank = { low: 0, medium: 1, high: 2 } as const;
    if (confidenceRank[confidence] > confidenceRank[entry.confidenceBand]) {
      throw new Error(
        `Smart Library entry ${candidateId} cannot support a ${confidence}-confidence decision.`,
      );
    }
    if (method === "vin" && !entry.vinPattern) {
      throw new Error(`Smart Library entry ${candidateId} is not qualified for VIN matching.`);
    }
    if (method === "serial" && !entry.serialPattern) {
      throw new Error(`Smart Library entry ${candidateId} is not qualified for serial matching.`);
    }
    return entry;
  }

  private async getRequiredMarketSnapshot(requestedId: string) {
    const byId = await this.db
      .select()
      .from(marketSnapshots)
      .where(eq(marketSnapshots.marketSnapshotId, requestedId))
      .limit(1);
    if (byId.length > 0) return byId[0];
    throw new Error(`Market snapshot ${requestedId} is not registered in controlled master data.`);
  }

  private async getRequiredTermsProfile(requestedId: string) {
    const byId = await this.db
      .select()
      .from(termsProfiles)
      .where(eq(termsProfiles.termsProfileId, requestedId))
      .limit(1);
    const profile = byId[0];
    if (!profile) {
      throw new Error(`Terms profile ${requestedId} is not registered in controlled master data.`);
    }
    const occurredAt = this.occurredAt();
    if (profile.activeFrom > occurredAt || (profile.activeTo && profile.activeTo < occurredAt)) {
      throw new Error(`Terms profile ${requestedId} is not active for this transaction time.`);
    }
    return profile;
  }

  private async getRequiredAccount(accountCodeOrId: string) {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(
        this.isUuid(accountCodeOrId)
          ? or(eq(accounts.accountId, accountCodeOrId), eq(accounts.accountCode, accountCodeOrId))
          : eq(accounts.accountCode, accountCodeOrId),
      )
      .limit(1);
    const account = rows[0];
    if (!account?.active) {
      throw new Error(`Account ${accountCodeOrId} is unknown or inactive.`);
    }
    return account;
  }

  private async assertOperationalReference(reference: string): Promise<void> {
    const queueRows = await this.db
      .select({ id: queues.queueId })
      .from(queues)
      .where(
        this.isUuid(reference)
          ? or(eq(queues.queueId, reference), eq(queues.queueCode, reference))
          : eq(queues.queueCode, reference),
      )
      .limit(1);
    if (queueRows.length > 0) return;

    const boxRows = await this.db
      .select({ id: boxes.boxId })
      .from(boxes)
      .where(
        this.isUuid(reference)
          ? or(eq(boxes.boxId, reference), eq(boxes.externalCode, reference))
          : eq(boxes.externalCode, reference),
      )
      .limit(1);
    if (boxRows.length > 0) return;

    const shipmentRows = await this.db
      .select({ id: shipments.shipmentId })
      .from(shipments)
      .where(
        this.isUuid(reference)
          ? or(eq(shipments.shipmentId, reference), eq(shipments.shipmentCode, reference))
          : eq(shipments.shipmentCode, reference),
      )
      .limit(1);
    if (shipmentRows.length > 0) return;

    const settlementRows = await this.db
      .select({ id: settlements.settlementId })
      .from(settlements)
      .where(
        this.isUuid(reference)
          ? or(eq(settlements.settlementId, reference), eq(settlements.scopeId, reference))
          : eq(settlements.scopeId, reference),
      )
      .limit(1);
    if (settlementRows.length === 0) {
      throw new Error(`Operational reference ${reference} is not linked to known material or settlement state.`);
    }
  }

  private async getOrCreateSettlement(requestedId: string, transactionId: string) {
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

    const settlementId = this.nextId("effect");
    await this.db.insert(settlements).values({
      settlementId,
      createdByTransactionId: transactionId,
      scopeType: "queue",
      scopeId: queueScopeId,
      status: "draft",
      estimatedValueUsd: baselineEstimateUsd,
      createdAt: this.occurredAt(),
      finalizedAt: null,
    });
    const inserted = await this.db
      .select()
      .from(settlements)
      .where(eq(settlements.settlementId, settlementId))
      .limit(1);
    return inserted[0];
  }

  private async updateQueueConverterState(
    queueId: string,
    state: "processing" | "sampled" | "settled",
    transactionId: string,
  ): Promise<void> {
    const linkedBoxes = await this.db
      .select({ boxId: queueBoxes.boxId })
      .from(queueBoxes)
      .where(eq(queueBoxes.queueId, queueId));
    if (linkedBoxes.length === 0) return;

    await this.db
      .update(converters)
      .set({ state, lastTransitionTransactionId: transactionId })
      .where(inArray(converters.currentBoxId, linkedBoxes.map((row) => row.boxId)));
  }

  private occurredAt(): Date {
    if (!this.executionContext) {
      throw new Error("Command execution context is required for deterministic effects.");
    }
    return new Date(this.executionContext.occurredAt);
  }

  private nextId(scope: string): string {
    if (!this.executionContext) {
      throw new Error("Command execution context is required for deterministic identifiers.");
    }
    const sequence = (this.idCounters.get(scope) ?? 0) + 1;
    this.idCounters.set(scope, sequence);
    const hex = createHash("sha256")
      .update(`${this.executionContext.transactionId}:${scope}:${sequence}`)
      .digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
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

  private async getRequiredEvidenceBundle(
    evidenceBundleId: string,
    requiredTypes: readonly ("image" | "note" | "gps" | "video" | "document")[],
  ): Promise<void> {
    const bundles = await this.db
      .select({ id: evidenceBundles.evidenceBundleId })
      .from(evidenceBundles)
      .where(eq(evidenceBundles.evidenceBundleId, evidenceBundleId))
      .limit(1);
    if (bundles.length === 0) {
      throw new Error(`Evidence bundle ${evidenceBundleId} was not found.`);
    }

    const artifacts = await this.db
      .select({ evidenceType: evidenceArtifacts.evidenceType })
      .from(evidenceArtifacts)
      .where(eq(evidenceArtifacts.evidenceBundleId, evidenceBundleId));
    const available = new Set(artifacts.map((artifact) => artifact.evidenceType));
    const missing = requiredTypes.filter((type) => !available.has(type));
    if (missing.length > 0) {
      throw new Error(`Evidence bundle ${evidenceBundleId} is missing required artifacts: ${missing.join(", ")}.`);
    }
  }

  private async createEvidenceBundle(
    requestedEvidenceBundleId: string,
    origin: CommandSubmission["origin"],
    capturedAt: string,
    location: { lat: number; lon: number; accuracyM: number } | null,
    types: readonly ("image" | "note" | "gps" | "video" | "document")[],
  ): Promise<string> {
    if (!this.isUuid(requestedEvidenceBundleId)) {
      throw new Error(`Evidence bundle ${requestedEvidenceBundleId} must be a UUID.`);
    }

    const existing = await this.db
      .select()
      .from(evidenceBundles)
      .where(eq(evidenceBundles.evidenceBundleId, requestedEvidenceBundleId))
      .limit(1);
    if (existing.length > 0) {
      if (
        existing[0].createdByUserId !== origin.userId ||
        existing[0].createdByDeviceId !== origin.deviceId
      ) {
        throw new Error(`Evidence bundle ${requestedEvidenceBundleId} belongs to a different origin.`);
      }
      const artifacts = await this.db
        .select({ evidenceType: evidenceArtifacts.evidenceType })
        .from(evidenceArtifacts)
        .where(eq(evidenceArtifacts.evidenceBundleId, requestedEvidenceBundleId));
      const existingTypes = new Set(artifacts.map((artifact) => artifact.evidenceType));
      const missingTypes = types.filter((type) => !existingTypes.has(type));
      if (missingTypes.length > 0) {
        throw new Error(
          `Evidence bundle ${requestedEvidenceBundleId} is missing required artifacts: ${missingTypes.join(", ")}.`,
        );
      }
      return requestedEvidenceBundleId;
    }

    const evidenceBundleId = requestedEvidenceBundleId;
    await this.db.insert(evidenceBundles).values({
      evidenceBundleId,
      createdByUserId: origin.userId,
      createdByDeviceId: origin.deviceId,
      capturedAt: new Date(capturedAt),
      gpsLat: location?.lat.toFixed(6) ?? null,
      gpsLon: location?.lon.toFixed(6) ?? null,
      gpsAccuracyM: location?.accuracyM.toFixed(3) ?? null,
    });

    await this.db.insert(evidenceArtifacts).values(
      types.map((type) => {
        const artifactId = this.nextId("effect");
        const uri = `dcs-proof://${type}/${evidenceBundleId}/${artifactId}`;
        return {
          artifactId,
          evidenceBundleId,
          evidenceType: type,
          uri,
          sha256: createHash("sha256").update(uri).digest("hex"),
          synthetic: true,
          capturedAt: new Date(capturedAt),
        };
      }),
    );

    return evidenceBundleId;
  }
}

export async function processControlledQueueBatch(
  db: DcsDb,
  limit = 100,
  attemptedAt = new Date(),
): Promise<ControlledQueueBatchResult> {
  const awaitingRows = await db
    .select({ transactionId: transactionEnvelopes.transactionId })
    .from(transactionEnvelopes)
    .where(eq(transactionEnvelopes.validationState, "awaiting_validation"))
    .orderBy(asc(transactionEnvelopes.createdAt))
    .limit(limit);

  const processor = new CommandProcessor(db);
  const resumed: Array<
    | CommandProcessResult
    | { readonly transactionId: string; readonly status: "failed"; readonly error: string }
  > = [];
  for (const row of awaitingRows) {
    try {
      resumed.push(await processor.resumeAwaitingValidation(row.transactionId, attemptedAt));
    } catch (error) {
      resumed.push({
        transactionId: row.transactionId,
        status: "failed",
        error: error instanceof Error ? error.message : "Deferred command application failed.",
      });
    }
  }

  return {
    resumed,
    replication: await processReplicationQueueBatch(db, limit, attemptedAt),
  };
}

export async function retryControlledTransaction(
  db: DcsDb,
  transactionId: string,
  retriedAt = new Date(),
): Promise<{
  readonly transactionId: string;
  readonly command: CommandProcessResult;
  readonly replication: ReplicationAttemptResult | null;
}> {
  const rows = await db
    .select()
    .from(transactionEnvelopes)
    .where(eq(transactionEnvelopes.transactionId, transactionId))
    .limit(1);
  const envelope = rows[0];
  if (!envelope) throw new Error(`Transaction ${transactionId} was not found.`);

  let command: CommandProcessResult;
  if (envelope.validationState === "awaiting_validation") {
    command = await new CommandProcessor(db).resumeAwaitingValidation(transactionId, retriedAt);
  } else {
    command = {
      transactionId,
      status: "duplicate",
      eventType: envelope.eventType,
      effects: {
        priorStatus: envelope.validationState,
        ...(envelope.failureReason ? { failureReason: envelope.failureReason } : {}),
      },
    };
  }

  if (command.status === "awaiting_validation" || envelope.validationState === "failed") {
    return { transactionId, command, replication: null };
  }

  return {
    transactionId,
    command,
    replication: await retryReplicationTransaction(db, transactionId, retriedAt),
  };
}
