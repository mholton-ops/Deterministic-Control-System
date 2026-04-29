import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

import { eq } from "drizzle-orm";
import {
  boxes,
  converters,
  createDb,
  createPool,
  devices,
  invoices,
  ledgerCorrections,
  ledgerEntries,
  pricingDecisions,
  queueBoxes,
  queues,
  reconciliationActions,
  reconciliationCases,
  settlements,
  shipments,
  users,
} from "@dcs/db";
import { CommandProcessor, type CommandSubmission } from "@dcs/replication";

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
      displayName: "Integration Test Operator",
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

async function processAndAssert(
  processor: CommandProcessor,
  command: CommandSubmission,
): Promise<{ transactionId: string }> {
  const result = await processor.process(command);
  assert.equal(
    result.status,
    "applied",
    `Expected applied status for ${command.command.commandType}, got ${result.status}.`,
  );
  return { transactionId: result.transactionId };
}

export async function runFieldToSettlementIntegration(): Promise<void> {
  const pool = createPool();
  const db = createDb(pool);
  const processor = new CommandProcessor(db);

  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const queueCode = `QUEUE-IT-${suffix}`;
  const boxCode = `PC-BOX-IT-${suffix}`;
  const shipmentCode = `SHIP-IT-${suffix}`;
  const converterVin = `VIN-IT-${suffix}`;

  const origin = {
    sourceSystem: "operator_console" as const,
    userId: normalizeToUuid("integration-user"),
    deviceId: normalizeToUuid("integration-device"),
    capturedAt: new Date("2026-02-01T08:00:00.000Z").toISOString(),
  };

  await ensureOrigin(db, origin.userId, origin.deviceId);

  try {
    await processAndAssert(processor, {
      idempotencyKey: `it-capture-${suffix}`,
      origin,
      createdAt: new Date("2026-02-01T08:00:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "field.capture_converter",
        commandId: randomUUID(),
        yardId: "YARD-SIM-01",
        boxId: boxCode,
        vinOrSerial: converterVin,
        capturedAt: new Date("2026-02-01T08:00:00.000Z").toISOString(),
        location: { lat: 34.212, lon: -118.491, accuracyM: 8 },
        evidence: { evidenceBundleId: randomUUID(), requiredTypesPresent: ["image", "gps"] },
      },
    });

    await processAndAssert(processor, {
      idempotencyKey: `it-lock-queue-${suffix}`,
      origin,
      createdAt: new Date("2026-02-01T08:05:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "custody.lock_queue_for_processing",
        commandId: randomUUID(),
        queueId: queueCode,
      },
    });

    await processAndAssert(processor, {
      idempotencyKey: `it-assign-box-queue-${suffix}`,
      origin,
      createdAt: new Date("2026-02-01T08:05:30.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "custody.assign_box_to_queue",
        commandId: randomUUID(),
        boxId: boxCode,
        queueId: queueCode,
      },
    });

    await processAndAssert(processor, {
      idempotencyKey: `it-create-shipment-${suffix}`,
      origin,
      createdAt: new Date("2026-02-01T08:06:00.000Z").toISOString(),
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

    await processAndAssert(processor, {
      idempotencyKey: `it-receive-shipment-${suffix}`,
      origin,
      createdAt: new Date("2026-02-01T08:09:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "custody.receive_shipment",
        commandId: randomUUID(),
        shipmentRef: shipmentCode,
        receivingSiteId: "WAREHOUSE-SIM-01",
      },
    });

    await processAndAssert(processor, {
      idempotencyKey: `it-record-sample-${suffix}`,
      origin,
      createdAt: new Date("2026-02-01T08:10:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "analytics.record_sample",
        commandId: randomUUID(),
        queueId: queueCode,
        source: "internal_xrf",
        ptPpm: 590,
        pdPpm: 910,
        rhPpm: 105,
        matrixId: null,
      },
    });

    await processAndAssert(processor, {
      idempotencyKey: `it-record-sample-icp-${suffix}`,
      origin,
      createdAt: new Date("2026-02-01T08:10:40.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "analytics.record_sample",
        commandId: randomUUID(),
        queueId: queueCode,
        source: "icp_final",
        ptPpm: 602,
        pdPpm: 936,
        rhPpm: 108,
        matrixId: null,
      },
    });

    await processAndAssert(processor, {
      idempotencyKey: `it-resolve-pricing-${suffix}`,
      origin,
      createdAt: new Date("2026-02-01T08:12:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "pricing.resolve_estimate",
        commandId: randomUUID(),
        queueId: queueCode,
        marketSnapshotId: "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd2001",
        termsProfileId: "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd3001",
        sourceCandidates: ["vin", "library_match"],
        attemptedFieldOverride: false,
      },
    });

    await processAndAssert(processor, {
      idempotencyKey: `it-hedge-${suffix}`,
      origin,
      createdAt: new Date("2026-02-01T08:13:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "hedge.open_position",
        commandId: randomUUID(),
        layer: "internal",
        scopeType: "queue",
        scopeId: queueCode,
        hedgedPtOz: 0.2,
        hedgedPdOz: 0.3,
        hedgedRhOz: 0.04,
      },
    });

    const ledgerPosting = await processor.process({
      idempotencyKey: `it-ledger-${suffix}`,
      origin,
      createdAt: new Date("2026-02-01T08:14:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "finance.post_ledger_entry",
        commandId: randomUUID(),
        debitAccountId: "internal_funding_pool",
        creditAccountId: "buyer_alpha",
        amount: { amount: "4750.00", currency: "USD" },
        purposeCode: "funding_advance",
        sourceOperationalRef: queueCode,
        notes: "Integration test funding movement",
        evidence: { evidenceBundleId: randomUUID(), requiredTypesPresent: ["note"] },
      },
    });
    assert.equal(ledgerPosting.status, "applied", "Expected ledger posting to apply.");
    const originalLedgerEntryId = String(ledgerPosting.effects.ledgerEntryId);
    assert.ok(originalLedgerEntryId.length > 0, "Ledger posting should return a ledger entry id.");

    const openCase = await processor.process({
      idempotencyKey: `it-open-reconcile-${suffix}`,
      origin,
      createdAt: new Date("2026-02-01T08:15:00.000Z").toISOString(),
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
    assert.equal(openCase.status, "applied", "Expected open reconciliation case to apply.");
    const caseId = String(openCase.effects.reconciliationCaseId);
    assert.ok(caseId.length > 0, "Reconciliation case id should be returned.");

    await processAndAssert(processor, {
      idempotencyKey: `it-reconcile-action-${suffix}`,
      origin,
      createdAt: new Date("2026-02-01T08:16:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "reconciliation.record_action",
        commandId: randomUUID(),
        caseId,
        actionType: "variance_investigation_started",
        actionPayload: {
          note: "Variance review initiated",
          estimatedFinalizationWindowHours: 6,
        },
      },
    });

    await processAndAssert(processor, {
      idempotencyKey: `it-ledger-correction-${suffix}`,
      origin,
      createdAt: new Date("2026-02-01T08:18:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "finance.post_additive_correction",
        commandId: randomUUID(),
        targetLedgerEntryId: originalLedgerEntryId,
        reasonCode: "reconciliation",
        deltaUsd: "-250.00",
        notes: "Reconciliation variance correction",
        reconciliationCaseId: caseId,
        evidence: { evidenceBundleId: randomUUID(), requiredTypesPresent: ["note"] },
      },
    });

    const queueEstimateRows = await db
      .select({ estimatedValueUsd: queues.estimatedValueUsd })
      .from(queues)
      .where(eq(queues.queueCode, queueCode))
      .limit(1);
    const finalizedValueUsd = (
      Number(queueEstimateRows[0]?.estimatedValueUsd ?? "75000") * 1.03
    ).toFixed(2);

    await processAndAssert(processor, {
      idempotencyKey: `it-finalize-settlement-${suffix}`,
      origin,
      createdAt: new Date("2026-02-01T08:20:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "settlement.finalize_from_assay",
        commandId: randomUUID(),
        settlementId: queueCode,
        finalValueUsd: finalizedValueUsd,
      },
    });

    await processAndAssert(processor, {
      idempotencyKey: `it-close-reconcile-${suffix}`,
      origin,
      createdAt: new Date("2026-02-01T08:21:00.000Z").toISOString(),
      dependencies: [],
      command: {
        commandType: "reconciliation.close_case",
        commandId: randomUUID(),
        caseId,
        status: "resolved",
        closureRationale: "Financial correction posted and settlement finalized.",
      },
    });

    const converterRows = await db
      .select()
      .from(converters)
      .where(eq(converters.vinOrSerial, converterVin))
      .limit(1);
    assert.equal(converterRows.length, 1, "Converter should be present.");
    assert.equal(converterRows[0].state, "received", "Converter should be in received state.");

    const boxRows = await db.select().from(boxes).where(eq(boxes.externalCode, boxCode)).limit(1);
    assert.equal(boxRows.length, 1, "Box should exist.");
    assert.equal(boxRows[0].state, "received", "Box should be received after shipment receipt.");

    const shipmentRows = await db
      .select()
      .from(shipments)
      .where(eq(shipments.shipmentCode, shipmentCode))
      .limit(1);
    assert.equal(shipmentRows.length, 1, "Shipment should exist.");
    assert.equal(shipmentRows[0].state, "received", "Shipment should be received.");

    const queueRows = await db.select().from(queues).where(eq(queues.queueCode, queueCode)).limit(1);
    assert.equal(queueRows.length, 1, "Queue should exist for integration scope.");

    const queueBoxRows = await db
      .select()
      .from(queueBoxes)
      .where(eq(queueBoxes.queueId, queueRows[0].queueId))
      .limit(5);
    assert.equal(queueBoxRows.length, 1, "Queue should have custody-linked box before sampling.");

    const pricingRows = await db
      .select()
      .from(pricingDecisions)
      .where(eq(pricingDecisions.queueId, queueRows[0].queueId))
      .limit(1);
    assert.equal(pricingRows.length, 1, "Pricing decision should exist for integration queue.");

    const ledgerRows = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.sourceOperationalRef, queueCode))
      .limit(10);
    assert.equal(
      ledgerRows.length >= 2,
      true,
      "Original and correction ledger entries should both be tied to the integration queue scope.",
    );

    const correctionRows = await db
      .select()
      .from(ledgerCorrections)
      .where(eq(ledgerCorrections.targetLedgerEntryId, originalLedgerEntryId))
      .limit(2);
    assert.equal(correctionRows.length, 1, "A ledger correction record should reference the target entry.");

    const settlementRows = await db
      .select()
      .from(settlements)
      .where(eq(settlements.scopeId, queueCode))
      .limit(1);
    assert.equal(settlementRows.length, 1, "Settlement should exist.");
    assert.equal(settlementRows[0].status, "finalized", "Settlement should be finalized.");

    const invoiceRows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.settlementId, settlementRows[0].settlementId))
      .limit(1);
    assert.equal(invoiceRows.length, 1, "Finalized settlement should have an invoice.");

    const caseRows = await db
      .select()
      .from(reconciliationCases)
      .where(eq(reconciliationCases.reconciliationCaseId, caseId))
      .limit(1);
    assert.equal(caseRows.length, 1, "Reconciliation case should exist.");
    assert.equal(caseRows[0].status, "resolved", "Reconciliation case should be resolved.");

    const actionRows = await db
      .select()
      .from(reconciliationActions)
      .where(eq(reconciliationActions.reconciliationCaseId, caseId))
      .limit(10);
    assert.equal(
      actionRows.length >= 2,
      true,
      "Reconciliation case should have investigation and financial correction actions.",
    );

    console.log(`Integration workflow PASS (${suffix})`);
  } finally {
    await pool.end();
  }
}

runFieldToSettlementIntegration().catch((error) => {
  console.error("Integration workflow failed:", error);
  process.exit(1);
});
