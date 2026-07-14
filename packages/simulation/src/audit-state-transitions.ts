import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

import { eq, sql } from "drizzle-orm";
import {
  boxes,
  createDb,
  createPool,
  devices,
  evidenceArtifacts,
  evidenceBundles,
  ledgerEntries,
  queues,
  reconciliationCases,
  replicationQueue,
  replicationReceipts,
  sites,
  transactionEnvelopes,
  users,
} from "@dcs/db";
import {
  CommandProcessor,
  processReplicationTransaction,
  type CommandSubmission,
} from "@dcs/replication";

function normalizeToUuid(value: string): string {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (uuidRegex.test(value)) {
    return value;
  }

  const hex = createHash("sha1").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function ensureOrigin(db: ReturnType<typeof createDb>, userId: string, deviceId: string) {
  const userRows = await db.select().from(users).where(eq(users.userId, userId)).limit(1);
  if (userRows.length === 0) {
    await db.insert(users).values({
      userId,
      externalRef: userId,
      displayName: "State Audit Operator",
      role: "operator",
      active: true,
      createdAt: new Date(),
    });
  }

  const deviceRows = await db.select().from(devices).where(eq(devices.deviceId, deviceId)).limit(1);
  if (deviceRows.length === 0) {
    await db.insert(devices).values({
      deviceId,
      externalRef: deviceId,
      assignedUserId: userId,
      active: true,
      createdAt: new Date(),
    });
  }
}

async function apply(processor: CommandProcessor, command: CommandSubmission) {
  const result = await processor.process(command);
  assert.equal(result.status, "applied", `Expected applied status for ${command.command.commandType}.`);
  return result;
}

async function expectFailure(
  processor: CommandProcessor,
  command: CommandSubmission,
  reasonPattern: RegExp,
) {
  await assert.rejects(() => processor.process(command), (error: unknown) => {
    if (!(error instanceof Error)) {
      return false;
    }

    return reasonPattern.test(error.message);
  });
}

export async function runStateTransitionAudit(): Promise<void> {
  const pool = createPool();
  const db = createDb(pool);
  const processor = new CommandProcessor(db);

  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const origin = {
    sourceSystem: "operator_console" as const,
    userId: normalizeToUuid("state-audit-user"),
    deviceId: normalizeToUuid("state-audit-device"),
    capturedAt: new Date("2026-02-15T08:00:00.000Z").toISOString(),
  };

  await ensureOrigin(db, origin.userId, origin.deviceId);

  try {
    const queueCode = `QUEUE-AUDIT-${suffix}`;
    const boxCode = `BOX-AUDIT-${suffix}`;
    const shipmentCode = `SHIP-AUDIT-${suffix}`;

    const unauthorizedIdempotencyKey = `audit-unauthorized-origin-${suffix}`;
    await expectFailure(
      processor,
      {
        idempotencyKey: unauthorizedIdempotencyKey,
        origin: {
          ...origin,
          userId: randomUUID(),
          deviceId: randomUUID(),
        },
        createdAt: new Date("2026-02-15T08:00:10.000Z").toISOString(),
        dependencies: [],
        command: {
          commandType: "reconciliation.open_case",
          commandId: randomUUID(),
          triggerType: "sequence_violation",
          severity: "low",
          relatedScopeType: "queue",
          relatedScopeId: queueCode,
        },
      },
      /unknown or inactive/i,
    );
    const unauthorizedEnvelope = await db
      .select({ transactionId: transactionEnvelopes.transactionId })
      .from(transactionEnvelopes)
      .where(eq(transactionEnvelopes.idempotencyKey, unauthorizedIdempotencyKey));
    assert.equal(unauthorizedEnvelope.length, 0, "Unauthorized origins must not create accepted history.");

    const foreignUserId = normalizeToUuid(`state-audit-foreign-user-${suffix}`);
    const foreignDeviceId = normalizeToUuid(`state-audit-foreign-device-${suffix}`);
    await ensureOrigin(db, foreignUserId, foreignDeviceId);
    const foreignEvidenceBundleId = randomUUID();
    await db.insert(evidenceBundles).values({
      evidenceBundleId: foreignEvidenceBundleId,
      createdByUserId: foreignUserId,
      createdByDeviceId: foreignDeviceId,
      capturedAt: new Date("2026-02-15T08:00:20.000Z"),
      gpsLat: "34.215000",
      gpsLon: "-118.494000",
      gpsAccuracyM: "9.000",
    });
    await db.insert(evidenceArtifacts).values(
      (["image", "gps"] as const).map((evidenceType) => {
        const artifactId = randomUUID();
        const uri = `dcs-proof://${evidenceType}/${foreignEvidenceBundleId}/${artifactId}`;
        return {
          artifactId,
          evidenceBundleId: foreignEvidenceBundleId,
          evidenceType,
          uri,
          sha256: createHash("sha256").update(uri).digest("hex"),
          synthetic: true,
          capturedAt: new Date("2026-02-15T08:00:20.000Z"),
        };
      }),
    );

    const atomicBoxCode = `ATOMIC-BOX-${suffix}`;
    const atomicFailureKey = `audit-atomic-failure-${suffix}`;
    await expectFailure(
      processor,
      {
        idempotencyKey: atomicFailureKey,
        origin,
        createdAt: new Date("2026-02-15T08:00:30.000Z").toISOString(),
        dependencies: [],
        command: {
          commandType: "field.capture_converter",
          commandId: randomUUID(),
          yardId: "YARD-SIM-01",
          boxId: atomicBoxCode,
          vinOrSerial: `VIN-ATOMIC-${suffix}`,
          capturedAt: new Date("2026-02-15T08:00:30.000Z").toISOString(),
          location: { lat: 34.215, lon: -118.494, accuracyM: 9 },
          evidence: {
            evidenceBundleId: foreignEvidenceBundleId,
            requiredTypesPresent: ["image", "gps"],
          },
        },
      },
      /belongs to a different origin/i,
    );
    const rolledBackBoxes = await db
      .select({ boxId: boxes.boxId })
      .from(boxes)
      .where(eq(boxes.externalCode, atomicBoxCode));
    assert.equal(rolledBackBoxes.length, 0, "A failed command must roll back box creation.");

    const failedEnvelopeRows = await db
      .select()
      .from(transactionEnvelopes)
      .where(eq(transactionEnvelopes.idempotencyKey, atomicFailureKey))
      .limit(1);
    assert.equal(failedEnvelopeRows[0]?.validationState, "failed");
    assert.equal(failedEnvelopeRows[0]?.originCapturedAt.toISOString(), origin.capturedAt);
    const failedQueueRows = await db
      .select({ status: replicationQueue.status })
      .from(replicationQueue)
      .where(eq(replicationQueue.transactionId, failedEnvelopeRows[0]!.transactionId));
    assert.ok(failedQueueRows.length > 0 && failedQueueRows.every((row) => row.status === "failed"));

    const openCase = await apply(processor, {
      idempotencyKey: `audit-open-case-${suffix}`,
      origin,
      createdAt: new Date("2026-02-15T08:01:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "reconciliation.open_case",
        commandId: randomUUID(),
        triggerType: "assay_variance",
        severity: "medium",
        relatedScopeType: "queue",
        relatedScopeId: queueCode,
      },
    });
    const caseId = String(openCase.effects.reconciliationCaseId);

    await expectFailure(
      processor,
      {
        idempotencyKey: `audit-close-without-investigation-${suffix}`,
        origin,
        createdAt: new Date("2026-02-15T08:02:00.000Z").toISOString(),
        dependencies: [],
        command: {
          commandType: "reconciliation.close_case",
          commandId: randomUUID(),
          caseId,
          status: "resolved",
          closureRationale: "Attempted invalid direct close.",
        },
      },
      /cannot transition from open to resolved/i,
    );

    const dependencySiteId = randomUUID();
    const blockedScopeId = `BLOCKED-${suffix}`;
    const blocked = await processor.process({
      idempotencyKey: `audit-dependency-blocked-${suffix}`,
      origin,
      createdAt: new Date("2026-02-15T08:02:10.000Z").toISOString(),
      dependencies: [
        { entityType: "site", entityId: dependencySiteId, requiredState: "exists" },
      ],
      command: {
        commandType: "reconciliation.open_case",
        commandId: randomUUID(),
        triggerType: "ledger_orphan",
        severity: "low",
        relatedScopeType: "queue",
        relatedScopeId: blockedScopeId,
      },
    });
    assert.equal(blocked.status, "awaiting_validation");
    const prematureCases = await db
      .select({ caseId: reconciliationCases.reconciliationCaseId })
      .from(reconciliationCases)
      .where(eq(reconciliationCases.scopeId, blockedScopeId));
    assert.equal(prematureCases.length, 0, "Dependency-blocked commands must not mutate domain state.");

    await db.insert(sites).values({
      siteId: dependencySiteId,
      siteCode: `DEP-${suffix}`,
      name: "State Audit Dependency Site",
      siteType: "test_fixture",
      createdAt: new Date("2026-02-15T08:02:20.000Z"),
    });
    const resumed = await processor.resumeAwaitingValidation(
      blocked.transactionId,
      new Date("2026-02-15T08:02:30.000Z"),
    );
    assert.equal(resumed.status, "applied");
    const resumedCaseId = String(resumed.effects.reconciliationCaseId);
    const resumedCases = await db
      .select({ caseId: reconciliationCases.reconciliationCaseId })
      .from(reconciliationCases)
      .where(eq(reconciliationCases.reconciliationCaseId, resumedCaseId));
    assert.equal(resumedCases.length, 1, "A resolved dependency must allow exactly one domain application.");
    await assert.rejects(
      async () => {
        await db
          .update(reconciliationCases)
          .set({
            status: "resolved",
            closureRationale: "Direct state rewrite must be rejected.",
            closedAt: new Date("2026-02-15T08:02:45.000Z"),
            closedByTransactionId: resumed.transactionId,
            lastTransitionTransactionId: resumed.transactionId,
          })
          .where(eq(reconciliationCases.reconciliationCaseId, resumedCaseId));
      },
      /invalid reconciliation status transition/i,
      "Reconciliation state must not skip the controlled investigation transition.",
    );

    const receiptCountBeforeRedelivery = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(replicationReceipts)
      .where(eq(replicationReceipts.transactionId, blocked.transactionId));
    assert.equal(
      receiptCountBeforeRedelivery[0]?.count,
      1,
      "A resumed dependency-blocked command must reach receiver acknowledgement.",
    );
    await processReplicationTransaction(
      db,
      blocked.transactionId,
      new Date("2026-02-15T08:02:40.000Z"),
    );
    const receiptCountAfterRedelivery = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(replicationReceipts)
      .where(eq(replicationReceipts.transactionId, blocked.transactionId));
    assert.equal(
      receiptCountAfterRedelivery[0]?.count,
      receiptCountBeforeRedelivery[0]?.count,
      "Receiver redelivery must not create duplicate receipts.",
    );

    await apply(processor, {
      idempotencyKey: `audit-capture-${suffix}`,
      origin,
      createdAt: new Date("2026-02-15T08:03:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "field.capture_converter",
        commandId: randomUUID(),
        yardId: "YARD-SIM-01",
        boxId: boxCode,
        vinOrSerial: `VIN-AUDIT-${suffix}`,
        capturedAt: new Date("2026-02-15T08:03:00.000Z").toISOString(),
        location: { lat: 34.215, lon: -118.494, accuracyM: 9 },
        evidence: { evidenceBundleId: randomUUID(), requiredTypesPresent: ["image", "gps"] },
      },
    });

    const queueAssignment = await apply(processor, {
      idempotencyKey: `audit-assign-box-to-queue-${suffix}`,
      origin,
      createdAt: new Date("2026-02-15T08:04:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "custody.assign_box_to_queue",
        commandId: randomUUID(),
        boxId: boxCode,
        queueId: queueCode,
      },
    });
    const queueId = String(queueAssignment.effects.queueId);
    await assert.rejects(
      async () => {
        await db.update(queues).set({ state: "processing" }).where(eq(queues.queueId, queueId));
      },
      /requires a new source transaction/i,
      "Queue state must not change without a controlling command transaction.",
    );

    await expectFailure(
      processor,
      {
        idempotencyKey: `audit-out-of-order-settlement-${suffix}`,
        origin,
        createdAt: new Date("2026-02-15T08:05:00.000Z").toISOString(),
        dependencies: [],
        command: {
          commandType: "settlement.append_step",
          commandId: randomUUID(),
          settlementId: queueCode,
          step: "invoice_finalized",
        },
      },
      /system-derived|expected step/i,
    );

    const ledgerPosting = await apply(processor, {
      idempotencyKey: `audit-ledger-post-${suffix}`,
      origin,
      createdAt: new Date("2026-02-15T08:06:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "finance.post_ledger_entry",
        commandId: randomUUID(),
        debitAccountId: "internal_funding_pool",
        creditAccountId: "buyer_alpha",
        amount: { amount: "100.00", currency: "USD" },
        purposeCode: "adjustment",
        sourceOperationalRef: queueCode,
        notes: "State audit baseline ledger entry",
        evidence: { evidenceBundleId: randomUUID(), requiredTypesPresent: ["note"] },
      },
    });
    const targetLedgerEntryId = String(ledgerPosting.effects.ledgerEntryId);

    await assert.rejects(
      async () => {
        await db
          .update(ledgerEntries)
          .set({ amountUsd: "101.00" })
          .where(eq(ledgerEntries.ledgerEntryId, targetLedgerEntryId));
      },
      /append-only/i,
      "Accepted ledger history must reject in-place mutation.",
    );
    await assert.rejects(
      async () => {
        await db
          .update(transactionEnvelopes)
          .set({ payload: { tampered: true } })
          .where(eq(transactionEnvelopes.transactionId, ledgerPosting.transactionId));
      },
      /immutable/i,
      "Accepted transaction payloads must reject in-place mutation.",
    );
    await assert.rejects(
      async () => {
        await db
          .update(transactionEnvelopes)
          .set({ validationState: "pending" })
          .where(eq(transactionEnvelopes.transactionId, ledgerPosting.transactionId));
      },
      /status transition/i,
      "Confirmed transaction status must not move backward.",
    );

    await expectFailure(
      processor,
      {
        idempotencyKey: `audit-zero-delta-correction-${suffix}`,
        origin,
        createdAt: new Date("2026-02-15T08:07:00.000Z").toISOString(),
        dependencies: [],
        command: {
          commandType: "finance.post_additive_correction",
          commandId: randomUUID(),
          targetLedgerEntryId,
          reasonCode: "operator_error",
          deltaUsd: "0.00",
          notes: "Invalid zero-delta correction",
          reconciliationCaseId: null,
          evidence: { evidenceBundleId: randomUUID(), requiredTypesPresent: ["note"] },
        },
      },
      /non-zero delta/i,
    );

    await expectFailure(
      processor,
      {
        idempotencyKey: `audit-funding-sod-${suffix}`,
        origin,
        createdAt: new Date("2026-02-15T08:07:10.000Z").toISOString(),
        dependencies: [],
        command: {
          commandType: "finance.post_ledger_entry",
          commandId: randomUUID(),
          debitAccountId: "internal_funding_pool",
          creditAccountId: "buyer_alpha",
          amount: { amount: "25.00", currency: "USD" },
          purposeCode: "funding_advance",
          sourceOperationalRef: queueCode,
          approvedByUserId: origin.userId,
          notes: "Invalid same-actor funding approval",
          evidence: { evidenceBundleId: randomUUID(), requiredTypesPresent: ["note"] },
        },
      },
      /must be different users/i,
    );

    const idempotencySubmission = {
      idempotencyKey: `audit-idempotent-command-${suffix}`,
      origin,
      createdAt: new Date("2026-02-15T08:07:20.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "reconciliation.open_case" as const,
        commandId: randomUUID(),
        triggerType: "custody_mismatch",
        severity: "low" as const,
        relatedScopeType: "queue" as const,
        relatedScopeId: queueCode,
      },
    } satisfies CommandSubmission;
    const firstIdempotentResult = await apply(processor, idempotencySubmission);
    const duplicateIdempotentResult = await processor.process(idempotencySubmission);
    assert.equal(duplicateIdempotentResult.status, "duplicate");
    assert.equal(duplicateIdempotentResult.transactionId, firstIdempotentResult.transactionId);
    await expectFailure(
      processor,
      {
        ...idempotencySubmission,
        command: { ...idempotencySubmission.command, severity: "high" },
      },
      /already bound to a different command payload/i,
    );

    await apply(processor, {
      idempotencyKey: `audit-close-box-${suffix}`,
      origin,
      createdAt: new Date("2026-02-15T08:07:30.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "custody.close_box",
        commandId: randomUUID(),
        boxId: boxCode,
      },
    });

    await apply(processor, {
      idempotencyKey: `audit-create-shipment-${suffix}`,
      origin,
      createdAt: new Date("2026-02-15T08:08:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "custody.create_shipment",
        commandId: randomUUID(),
        shipmentCode,
        originSiteId: "YARD-SIM-01",
        destinationSiteId: "WAREHOUSE-SIM-01",
        boxCodes: [boxCode],
      },
    });

    await apply(processor, {
      idempotencyKey: `audit-receive-shipment-${suffix}`,
      origin,
      createdAt: new Date("2026-02-15T08:09:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "custody.receive_shipment",
        commandId: randomUUID(),
        shipmentRef: shipmentCode,
        receivingSiteId: "WAREHOUSE-SIM-01",
      },
    });

    await expectFailure(
      processor,
      {
        idempotencyKey: `audit-ship-received-box-${suffix}`,
        origin,
        createdAt: new Date("2026-02-15T08:10:00.000Z").toISOString(),
        dependencies: [],
        command: {
          commandType: "custody.create_shipment",
          commandId: randomUUID(),
          shipmentCode: `${shipmentCode}-RETRY`,
          originSiteId: "YARD-SIM-01",
          destinationSiteId: "WAREHOUSE-SIM-01",
          boxCodes: [boxCode],
        },
      },
      /cannot be shipped from state received/i,
    );

    console.log(`State transition audit PASS (${suffix})`);
  } finally {
    await pool.end();
  }
}

runStateTransitionAudit().catch((error) => {
  console.error("State transition audit failed:", error);
  process.exit(1);
});
