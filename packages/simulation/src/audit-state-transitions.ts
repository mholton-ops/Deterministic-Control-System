import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

import { eq } from "drizzle-orm";
import { createDb, createPool, devices, users } from "@dcs/db";
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

    await apply(processor, {
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
      /expected step/i,
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
