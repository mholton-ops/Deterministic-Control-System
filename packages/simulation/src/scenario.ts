import { createHash, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import {
  accounts,
  boxes,
  converters,
  createDb,
  createPool,
  custodyEvents,
  devices,
  evidenceArtifacts,
  ledgerEntries,
  massMeasurements,
  queueBoxes,
  queues,
  samples,
  settlements,
  shipments,
  sites,
  users,
} from "@dcs/db";
import { CommandProcessor, type CommandSubmission } from "@dcs/replication";

interface OriginContext {
  readonly sourceSystem: "operator_console";
  readonly userId: string;
  readonly deviceId: string;
  readonly capturedAt: string;
}

const BASE_TIME = new Date("2026-03-01T08:00:00.000Z");

function normalizeToUuid(value: string): string {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (uuidRegex.test(value)) {
    return value;
  }

  const hex = createHash("sha1").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function at(minutes: number): string {
  return new Date(BASE_TIME.getTime() + minutes * 60_000).toISOString();
}

function isMilledMaterialType(materialType: string): boolean {
  const normalized = materialType.toLowerCase();
  if (normalized === "processed_catalyst" || normalized === "catalyst_processed") return true;
  if (normalized === "dust_recovery" || normalized === "baghouse_dust") return true;
  if (normalized === "sample_bucket") return true;
  if (normalized.includes("milled")) return true;
  if (normalized.includes("powder")) return true;
  return false;
}

async function ensureOrigin(db: ReturnType<typeof createDb>, userId: string, deviceId: string, index: number) {
  const existingUser = await db.select().from(users).where(eq(users.userId, userId)).limit(1);
  if (existingUser.length === 0) {
    await db.insert(users).values({
      userId,
      externalRef: `operator-${String(index + 1).padStart(2, "0")}`,
      displayName: `Operator ${String(index + 1).padStart(2, "0")}`,
      role: index % 3 === 0 ? "supervisor" : "operator",
      active: true,
      createdAt: new Date(BASE_TIME.getTime() - index * 86_400_000),
    });
  }

  const existingDevice = await db.select().from(devices).where(eq(devices.deviceId, deviceId)).limit(1);
  if (existingDevice.length === 0) {
    await db.insert(devices).values({
      deviceId,
      externalRef: `device-${String(index + 1).padStart(2, "0")}`,
      assignedUserId: userId,
      active: true,
      createdAt: new Date(BASE_TIME.getTime() - index * 86_400_000),
    });
  }
}

async function ensureSite(
  db: ReturnType<typeof createDb>,
  siteCode: string,
  siteType: "yard" | "warehouse" | "lab",
  name: string,
) {
  const existing = await db.select().from(sites).where(eq(sites.siteCode, siteCode)).limit(1);
  if (existing.length > 0) return;

  await db.insert(sites).values({
    siteId: normalizeToUuid(`site:${siteCode}`),
    siteCode,
    name,
    siteType,
    createdAt: BASE_TIME,
  });
}

async function ensureAccount(
  db: ReturnType<typeof createDb>,
  accountCode: string,
  accountType: "buyer" | "warehouse" | "bank" | "customer" | "internal",
) {
  const existing = await db.select().from(accounts).where(eq(accounts.accountCode, accountCode)).limit(1);
  if (existing.length > 0) return;

  await db.insert(accounts).values({
    accountId: normalizeToUuid(`account:${accountCode}`),
    accountCode,
    accountType,
    ownerRef: accountCode,
    active: true,
    createdAt: BASE_TIME,
  });
}

async function apply(
  processor: CommandProcessor,
  submission: CommandSubmission,
): Promise<{ transactionId: string; status: "applied" | "duplicate"; effects: Record<string, unknown> }> {
  const result = await processor.process(submission);
  if (result.status !== "applied" && result.status !== "duplicate") {
    throw new Error(`Command ${submission.command.commandType} expected applied|duplicate, got ${result.status}`);
  }

  return {
    transactionId: result.transactionId,
    status: result.status,
    effects: result.effects,
  };
}

export async function runDeterministicScenario(): Promise<void> {
  const pool = createPool();
  const db = createDb(pool);
  const processor = new CommandProcessor(db);

  const origins: OriginContext[] = [];
  const siteCodes = [
    "SITE-SIM-01",
    "SITE-SIM-02",
    "SITE-SIM-03",
    "SITE-SIM-04",
    "SITE-SIM-05",
    "SITE-SIM-06",
  ] as const;
  const wholeConverterBoxCodes = Array.from(
    { length: 54 },
    (_, index) => `WC-BOX-${String(index + 1).padStart(3, "0")}`,
  );
  const processedCatalystBoxCodes = Array.from(
    { length: 20 },
    (_, index) => `PC-BOX-${String(index + 1).padStart(3, "0")}`,
  );
  const dustRecoveryBoxCodes = Array.from(
    { length: 14 },
    (_, index) => `DR-BOX-${String(index + 1).padStart(3, "0")}`,
  );
  const boxCodes = [
    ...wholeConverterBoxCodes,
    ...processedCatalystBoxCodes,
    ...dustRecoveryBoxCodes,
  ];
  const queueCodes = Array.from({ length: 38 }, (_, index) => `QUEUE-SIM-${String(index + 1).padStart(3, "0")}`);

  try {
    for (let i = 0; i < 22; i += 1) {
      const userId = normalizeToUuid(`sim-user-${i + 1}`);
      const deviceId = normalizeToUuid(`sim-device-${i + 1}`);
      await ensureOrigin(db, userId, deviceId, i);
      origins.push({ sourceSystem: "operator_console", userId, deviceId, capturedAt: at(i) });
    }

    await ensureSite(db, "SITE-SIM-01", "yard", "North Yard");
    await ensureSite(db, "SITE-SIM-02", "yard", "South Yard");
    await ensureSite(db, "SITE-SIM-03", "yard", "East Yard");
    await ensureSite(db, "SITE-SIM-04", "yard", "West Yard");
    await ensureSite(db, "SITE-SIM-05", "warehouse", "Primary Processing Warehouse");
    await ensureSite(db, "SITE-SIM-06", "lab", "Assay and Validation Lab");

    await ensureAccount(db, "internal_funding_pool", "internal");
    await ensureAccount(db, "buyer_alpha", "buyer");
    await ensureAccount(db, "buyer_beta", "buyer");
    await ensureAccount(db, "buyer_gamma", "buyer");
    await ensureAccount(db, "treasury_bank", "bank");
    await ensureAccount(db, "warehouse_ops", "warehouse");
    for (let customerIndex = 1; customerIndex <= 40; customerIndex += 1) {
      await ensureAccount(db, `customer_${String(customerIndex).padStart(2, "0")}`, "customer");
    }

    for (let converterIndex = 0; converterIndex < 270; converterIndex += 1) {
      const origin = origins[converterIndex % origins.length];
      const siteCode = siteCodes[converterIndex % 4];
      const boxCode =
        converterIndex % 9 === 0
          ? processedCatalystBoxCodes[Math.floor(converterIndex / 9) % processedCatalystBoxCodes.length]
          : converterIndex % 7 === 0
            ? dustRecoveryBoxCodes[Math.floor(converterIndex / 7) % dustRecoveryBoxCodes.length]
            : wholeConverterBoxCodes[Math.floor(converterIndex / 2) % wholeConverterBoxCodes.length];
      const vinOrSerial = converterIndex % 11 === 0 ? null : `VIN-SIM-${String(converterIndex + 1).padStart(5, "0")}`;

      await apply(processor, {
        idempotencyKey: `sim-capture-${String(converterIndex + 1).padStart(4, "0")}`,
        origin: { ...origin, capturedAt: at(converterIndex) },
        createdAt: at(converterIndex),
        dependencies: [],
        command: {
          commandType: "field.capture_converter",
          commandId: randomUUID(),
          yardId: siteCode,
          boxId: boxCode,
          vinOrSerial,
          capturedAt: at(converterIndex),
          location: {
            lat: 34.15 + (converterIndex % 30) * 0.004,
            lon: -118.65 + (converterIndex % 30) * 0.005,
            accuracyM: 5 + (converterIndex % 7),
          },
          evidence: {
            evidenceBundleId: randomUUID(),
            requiredTypesPresent: ["image", "gps"],
          },
        },
      });
    }

    const queueTransactionByCode = new Map<string, string>();
    for (let queueIndex = 0; queueIndex < queueCodes.length; queueIndex += 1) {
      const queueCode = queueCodes[queueIndex];
      const origin = origins[queueIndex % origins.length];
      const result = await apply(processor, {
        idempotencyKey: `sim-lock-queue-${String(queueIndex + 1).padStart(3, "0")}`,
        origin: { ...origin, capturedAt: at(400 + queueIndex) },
        createdAt: at(400 + queueIndex),
        dependencies: [],
        command: {
          commandType: "custody.lock_queue_for_processing",
          commandId: randomUUID(),
          queueId: queueCode,
        },
      });
      queueTransactionByCode.set(queueCode, result.transactionId);
    }

    const queueRows = await db.select().from(queues);
    const boxRows = await db.select().from(boxes);
    const queueByCode = new Map(queueRows.map((row) => [row.queueCode, row] as const));
    const defaultQueueCode = queueCodes[0];
    if (!defaultQueueCode) {
      throw new Error("Queue code list is empty.");
    }
    const fallbackTransactionId = queueTransactionByCode.get(defaultQueueCode);
    if (!fallbackTransactionId) {
      throw new Error("Queue lock transaction map is empty; cannot assign box continuity.");
    }
    const fallbackTxId: string = fallbackTransactionId;

    const processedBoxes = boxRows.filter((row) => row.materialType === "processed_catalyst");
    const dustBoxes = boxRows.filter((row) => row.materialType === "dust_recovery");
    const wholeBoxes = boxRows.filter((row) => row.materialType === "whole_converter");

    const queueAssignments: Array<{
      queueId: string;
      boxId: string;
      assignedAt: Date;
      assignedByTransactionId: string;
    }> = [];

    function assignBoxSeries(
      selectedBoxes: typeof boxRows,
      queueStartIndex: number,
      queueSpread: number,
      assignmentOffset: number,
    ) {
      for (let index = 0; index < selectedBoxes.length; index += 1) {
        const selectedBox = selectedBoxes[index];
        if (!selectedBox) continue;
        const queueCode =
          queueCodes[(queueStartIndex + (index % queueSpread)) % queueCodes.length] ?? defaultQueueCode;
        const queue = queueByCode.get(queueCode);
        if (!queue) continue;
        queueAssignments.push({
          queueId: queue.queueId,
          boxId: selectedBox.boxId,
          assignedAt: new Date(BASE_TIME.getTime() + (500 + assignmentOffset + index) * 60_000),
          assignedByTransactionId: queueTransactionByCode.get(queueCode) ?? fallbackTxId,
        });
      }
    }

    assignBoxSeries(processedBoxes, 0, 8, 0);
    assignBoxSeries(dustBoxes, 8, 8, 120);
    assignBoxSeries(wholeBoxes, 16, queueCodes.length - 4, 240);

    if (queueAssignments.length > 0) {
      await db.insert(queueBoxes).values(queueAssignments).onConflictDoNothing();
    }

    let shipmentCursor = 0;
    const shippableBoxes = boxRows.slice(0, 62).map((row) => row.externalCode);
    for (let shipmentIndex = 0; shipmentIndex < 22; shipmentIndex += 1) {
      const origin = origins[shipmentIndex % origins.length];
      const chunkSize = 2 + (shipmentIndex % 3);
      const selectedBoxes = shippableBoxes.slice(shipmentCursor, shipmentCursor + chunkSize);
      shipmentCursor += chunkSize;
      if (selectedBoxes.length === 0) break;

      const shipmentCode = `SHIP-SIM-${String(shipmentIndex + 1).padStart(3, "0")}`;
      const originSite = siteCodes[shipmentIndex % 4];
      await apply(processor, {
        idempotencyKey: `sim-create-shipment-${String(shipmentIndex + 1).padStart(3, "0")}`,
        origin: { ...origin, capturedAt: at(620 + shipmentIndex) },
        createdAt: at(620 + shipmentIndex),
        dependencies: [],
        command: {
          commandType: "custody.create_shipment",
          commandId: randomUUID(),
          shipmentCode,
          originSiteId: originSite,
          destinationSiteId: "SITE-SIM-05",
          boxCodes: selectedBoxes,
        },
      });

      if (shipmentIndex % 4 !== 0) {
        await apply(processor, {
          idempotencyKey: `sim-receive-shipment-${String(shipmentIndex + 1).padStart(3, "0")}`,
          origin: { ...origin, capturedAt: at(680 + shipmentIndex) },
          createdAt: at(680 + shipmentIndex),
          dependencies: [],
          command: {
            commandType: "custody.receive_shipment",
            commandId: randomUUID(),
            shipmentRef: shipmentCode,
            receivingSiteId: "SITE-SIM-05",
          },
        });
      }
    }

    const converterRows = await db.select().from(converters).orderBy(converters.capturedAt);
    for (let gradingIndex = 0; gradingIndex < 188; gradingIndex += 1) {
      const converter = converterRows[gradingIndex];
      if (!converter) break;
      const origin = origins[gradingIndex % origins.length];
      const method = gradingIndex % 5 === 0 ? "category_fallback" : gradingIndex % 3 === 0 ? "library_match" : gradingIndex % 2 === 0 ? "serial" : "vin";
      const confidence = gradingIndex % 9 === 0 ? "low" : gradingIndex % 3 === 0 ? "medium" : "high";

      await apply(processor, {
        idempotencyKey: `sim-grade-${String(gradingIndex + 1).padStart(4, "0")}`,
        origin: { ...origin, capturedAt: at(760 + gradingIndex) },
        createdAt: at(760 + gradingIndex),
        dependencies: [],
        command: {
          commandType: "grading.issue_decision",
          commandId: randomUUID(),
          converterId: converter.converterId,
          candidateId: normalizeToUuid(`library-candidate-${method}-${confidence}-${gradingIndex % 16}`),
          identificationMethod: method,
          confidence,
          overrideReason: gradingIndex % 16 === 0 ? "Operator override due damaged serial plate." : null,
        },
      });
    }

    const queueMaterialRows = await db
      .select({
        queueCode: queues.queueCode,
        materialType: boxes.materialType,
      })
      .from(queueBoxes)
      .leftJoin(queues, eq(queues.queueId, queueBoxes.queueId))
      .leftJoin(boxes, eq(boxes.boxId, queueBoxes.boxId));
    const queueMaterials = new Map<string, Set<string>>();
    for (const row of queueMaterialRows) {
      if (!row.queueCode || !row.materialType) continue;
      const set = queueMaterials.get(row.queueCode) ?? new Set<string>();
      set.add(row.materialType.toLowerCase());
      queueMaterials.set(row.queueCode, set);
    }
    const sampleEligibleQueueCodes = queueCodes.filter((queueCode) => {
      const queueMaterialSet = queueMaterials.get(queueCode);
      return (
        queueMaterialSet !== undefined &&
        queueMaterialSet.size > 0 &&
        [...queueMaterialSet].every((materialType) => isMilledMaterialType(materialType))
      );
    });

    for (let queueIndex = 0; queueIndex < queueCodes.length; queueIndex += 1) {
      const queueCode = queueCodes[queueIndex];
      const isSampleEligible = sampleEligibleQueueCodes.includes(queueCode);
      if (!isSampleEligible) {
        continue;
      }

      const sampleCount = queueIndex % 3 === 0 ? 3 : 2;
      for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        const origin = origins[(queueIndex + sampleIndex) % origins.length];
        await apply(processor, {
          idempotencyKey: `sim-sample-${String(queueIndex + 1).padStart(3, "0")}-${sampleIndex + 1}`,
          origin: { ...origin, capturedAt: at(980 + queueIndex * 4 + sampleIndex) },
          createdAt: at(980 + queueIndex * 4 + sampleIndex),
          dependencies: [],
          command: {
            commandType: "analytics.record_sample",
            commandId: randomUUID(),
            queueId: queueCode,
            source: sampleIndex === sampleCount - 1 && queueIndex % 4 === 0 ? "icp_final" : "internal_xrf",
            ptPpm: 420 + (queueIndex % 15) * 18 + sampleIndex * 4,
            pdPpm: 710 + (queueIndex % 13) * 23 + sampleIndex * 5,
            rhPpm: 70 + (queueIndex % 11) * 7 + sampleIndex,
            matrixId: queueIndex % 2 === 0 ? "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd1001" : null,
          },
        });
      }
    }

    for (let queueIndex = 0; queueIndex < queueCodes.length; queueIndex += 1) {
      const origin = origins[(queueIndex + 2) % origins.length];
      await apply(processor, {
        idempotencyKey: `sim-price-${String(queueIndex + 1).padStart(3, "0")}`,
        origin: { ...origin, capturedAt: at(1220 + queueIndex) },
        createdAt: at(1220 + queueIndex),
        dependencies: [],
        command: {
          commandType: "pricing.resolve_estimate",
          commandId: randomUUID(),
          queueId: queueCodes[queueIndex],
          marketSnapshotId: queueIndex % 2 === 0 ? "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd2001" : randomUUID(),
          termsProfileId: queueIndex % 3 === 0 ? "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd3001" : randomUUID(),
          sourceCandidates:
            queueIndex % 6 === 0
              ? ["category_fallback"]
              : queueIndex % 2 === 0
                ? ["vin", "library_match"]
                : ["serial", "library_match"],
          attemptedFieldOverride: false,
        },
      });
    }

    for (let queueIndex = 0; queueIndex < 29; queueIndex += 1) {
      const origin = origins[(queueIndex + 3) % origins.length];
      await apply(processor, {
        idempotencyKey: `sim-hedge-${String(queueIndex + 1).padStart(3, "0")}`,
        origin: { ...origin, capturedAt: at(1300 + queueIndex) },
        createdAt: at(1300 + queueIndex),
        dependencies: [],
        command: {
          commandType: "hedge.open_position",
          commandId: randomUUID(),
          layer: queueIndex % 3 === 0 ? "external" : "internal",
          scopeType: "queue",
          scopeId: queueCodes[queueIndex],
          hedgedPtOz: queueIndex % 5 === 0 ? 0 : 0.12 + queueIndex * 0.01,
          hedgedPdOz: queueIndex % 4 === 0 ? 0 : 0.21 + queueIndex * 0.012,
          hedgedRhOz: queueIndex % 7 === 0 ? 0 : 0.03 + queueIndex * 0.002,
        },
      });
    }

    for (let ledgerIndex = 0; ledgerIndex < 46; ledgerIndex += 1) {
      const origin = origins[(ledgerIndex + 4) % origins.length];
      const queueCode = queueCodes[ledgerIndex % queueCodes.length];
      const advanceAmount =
        25_000 +
        (ledgerIndex % 8) * 18_500 +
        Math.floor(ledgerIndex / 8) * 7_250;
      await apply(processor, {
        idempotencyKey: `sim-ledger-advance-${String(ledgerIndex + 1).padStart(3, "0")}`,
        origin: { ...origin, capturedAt: at(1380 + ledgerIndex) },
        createdAt: at(1380 + ledgerIndex),
        dependencies: [],
        command: {
          commandType: "finance.post_ledger_entry",
          commandId: randomUUID(),
          debitAccountId: "internal_funding_pool",
          creditAccountId: ledgerIndex % 2 === 0 ? "buyer_alpha" : "buyer_beta",
          amount: {
            amount: advanceAmount.toFixed(2),
            currency: "USD",
          },
          purposeCode: ledgerIndex % 5 === 0 ? "field_purchase" : "funding_advance",
          sourceOperationalRef: queueCode,
          notes: `Funding line ${ledgerIndex + 1} for ${queueCode}`,
          evidence: {
            evidenceBundleId: randomUUID(),
            requiredTypesPresent: ["note"],
          },
        },
      });
    }

    for (let ledgerIndex = 0; ledgerIndex < 12; ledgerIndex += 1) {
      const origin = origins[(ledgerIndex + 5) % origins.length];
      const queueCode = queueCodes[(ledgerIndex * 3) % queueCodes.length];
      const wireAmount = 80_000 + ledgerIndex * 15_500;
      await apply(processor, {
        idempotencyKey: `sim-ledger-wire-${String(ledgerIndex + 1).padStart(3, "0")}`,
        origin: { ...origin, capturedAt: at(1460 + ledgerIndex) },
        createdAt: at(1460 + ledgerIndex),
        dependencies: [],
        command: {
          commandType: "finance.post_ledger_entry",
          commandId: randomUUID(),
          debitAccountId: "buyer_gamma",
          creditAccountId: "treasury_bank",
          amount: {
            amount: wireAmount.toFixed(2),
            currency: "USD",
          },
          purposeCode: "wire",
          sourceOperationalRef: queueCode,
          notes: `Treasury movement ${ledgerIndex + 1}`,
          evidence: {
            evidenceBundleId: randomUUID(),
            requiredTypesPresent: ["note"],
          },
        },
      });
    }

    for (let ledgerIndex = 0; ledgerIndex < 10; ledgerIndex += 1) {
      const origin = origins[(ledgerIndex + 9) % origins.length];
      const queueCode = queueCodes[(ledgerIndex * 5) % queueCodes.length];
      const adjustmentAmount = 4_500 + ledgerIndex * 2_250;
      await apply(processor, {
        idempotencyKey: `sim-ledger-adjust-${String(ledgerIndex + 1).padStart(3, "0")}`,
        origin: { ...origin, capturedAt: at(1490 + ledgerIndex) },
        createdAt: at(1490 + ledgerIndex),
        dependencies: [],
        command: {
          commandType: "finance.post_ledger_entry",
          commandId: randomUUID(),
          debitAccountId: "warehouse_ops",
          creditAccountId: "buyer_beta",
          amount: {
            amount: adjustmentAmount.toFixed(2),
            currency: "USD",
          },
          purposeCode: "adjustment",
          sourceOperationalRef: queueCode,
          notes: `Additive correction ${ledgerIndex + 1} for ${queueCode}`,
          evidence: {
            evidenceBundleId: randomUUID(),
            requiredTypesPresent: ["note"],
          },
        },
      });
    }

    const shipmentRows = await db.select().from(shipments).orderBy(shipments.shipmentCode);
    const ledgerEntriesRows = await db.select().from(ledgerEntries).orderBy(ledgerEntries.createdAt);

    for (let caseIndex = 0; caseIndex < 20; caseIndex += 1) {
      const origin = origins[(caseIndex + 6) % origins.length];
      const scopeType = caseIndex % 4 === 0 ? "shipment" : caseIndex % 5 === 0 ? "ledger" : "queue";
      const relatedScopeId =
        scopeType === "shipment"
          ? shipmentRows[caseIndex % Math.max(shipmentRows.length, 1)]?.shipmentCode ?? queueCodes[0]
          : scopeType === "ledger"
            ? ledgerEntriesRows[caseIndex % Math.max(ledgerEntriesRows.length, 1)]?.ledgerEntryId ?? queueCodes[0]
            : queueCodes[caseIndex % queueCodes.length];

      const openCase = await apply(processor, {
        idempotencyKey: `sim-reconcile-open-${String(caseIndex + 1).padStart(3, "0")}`,
        origin: { ...origin, capturedAt: at(1540 + caseIndex) },
        createdAt: at(1540 + caseIndex),
        dependencies: [],
        command: {
          commandType: "reconciliation.open_case",
          commandId: randomUUID(),
          triggerType: caseIndex % 4 === 0 ? "weight_delta" : caseIndex % 3 === 0 ? "custody_mismatch" : "assay_variance",
          severity: caseIndex % 6 === 0 ? "critical" : caseIndex % 4 === 0 ? "high" : caseIndex % 3 === 0 ? "medium" : "low",
          relatedScopeType: scopeType,
          relatedScopeId,
        },
      });
      const caseId = String(openCase.effects.reconciliationCaseId ?? "");
      if (!caseId) continue;

      await apply(processor, {
        idempotencyKey: `sim-reconcile-action-${String(caseIndex + 1).padStart(3, "0")}`,
        origin: { ...origin, capturedAt: at(1565 + caseIndex) },
        createdAt: at(1565 + caseIndex),
        dependencies: [],
        command: {
          commandType: "reconciliation.record_action",
          commandId: randomUUID(),
          caseId,
          actionType: caseIndex % 3 === 0 ? "request_additional_assay" : "operator_review",
          actionPayload: {
            expectedResolutionHours: 12 + caseIndex * 2,
            note: `Case ${caseId.slice(0, 8)} under investigation`,
          },
        },
      });

      if (caseIndex % 2 === 0) {
        await apply(processor, {
          idempotencyKey: `sim-reconcile-close-${String(caseIndex + 1).padStart(3, "0")}`,
          origin: { ...origin, capturedAt: at(1600 + caseIndex) },
          createdAt: at(1600 + caseIndex),
          dependencies: [],
          command: {
            commandType: "reconciliation.close_case",
            commandId: randomUUID(),
            caseId,
            status: caseIndex % 5 === 0 ? "accepted_variance" : "resolved",
            closureRationale:
              caseIndex % 5 === 0
                ? "Variance accepted after secondary validation."
                : "Case resolved after evidence and correction review.",
          },
        });
      }
    }

    const queueValuationRows = await db
      .select({ queueCode: queues.queueCode, estimatedValueUsd: queues.estimatedValueUsd })
      .from(queues)
      .orderBy(queues.queueCode);

    const settlementQueueCodes = sampleEligibleQueueCodes.slice(0, 20);
    for (let settlementIndex = 0; settlementIndex < settlementQueueCodes.length; settlementIndex += 1) {
      const origin = origins[(settlementIndex + 7) % origins.length];
      const queueCode = settlementQueueCodes[settlementIndex] ?? queueCodes[0];
      const queueRowsForSettlement = await db
        .select({ queueId: queues.queueId })
        .from(queues)
        .where(eq(queues.queueCode, queueCode))
        .limit(1);
      const queueIdForSettlement = queueRowsForSettlement[0]?.queueId;
      if (!queueIdForSettlement) {
        continue;
      }

      const assayCoverageRows = await db
        .select({
          icpFinalCount: sql<number>`count(*) filter (where ${samples.source} = 'icp_final')::int`,
        })
        .from(samples)
        .where(eq(samples.queueId, queueIdForSettlement));
      const icpFinalCount = assayCoverageRows[0]?.icpFinalCount ?? 0;
      if (icpFinalCount === 0) {
        await apply(processor, {
          idempotencyKey: `sim-sample-final-${String(settlementIndex + 1).padStart(3, "0")}`,
          origin: { ...origin, capturedAt: at(1680 + settlementIndex) },
          createdAt: at(1680 + settlementIndex),
          dependencies: [],
          command: {
            commandType: "analytics.record_sample",
            commandId: randomUUID(),
            queueId: queueCode,
            source: "icp_final",
            ptPpm: 460 + (settlementIndex % 12) * 15,
            pdPpm: 760 + (settlementIndex % 10) * 21,
            rhPpm: 84 + (settlementIndex % 9) * 6,
            matrixId: null,
          },
        });
      }

      const estimateValue =
        Number(queueValuationRows.find((row) => row.queueCode === queueCode)?.estimatedValueUsd ?? "120000");
      const varianceRatio =
        (settlementIndex % 7 === 0 ? 0.065 : 0) +
        (settlementIndex % 5 === 0 ? -0.04 : 0) +
        ((settlementIndex % 4) - 1.5) * 0.012;
      const finalValue = Math.max(45_000, estimateValue * (1 + varianceRatio));
      await apply(processor, {
        idempotencyKey: `sim-settle-final-${String(settlementIndex + 1).padStart(3, "0")}`,
        origin: { ...origin, capturedAt: at(1700 + settlementIndex) },
        createdAt: at(1700 + settlementIndex),
        dependencies: [],
        command: {
          commandType: "settlement.finalize_from_assay",
          commandId: randomUUID(),
          settlementId: queueCode,
          finalValueUsd: finalValue.toFixed(2),
        },
      });
    }

    for (let partialIndex = 30; partialIndex < 34; partialIndex += 1) {
      const queueCode = queueCodes[partialIndex];
      const origin = origins[(partialIndex + 8) % origins.length];
      const steps: Array<"lot_selected" | "contents_reviewed" | "sample_data_recorded"> = [
        "lot_selected",
        "contents_reviewed",
        "sample_data_recorded",
      ];

      for (let stepOrder = 0; stepOrder < steps.length; stepOrder += 1) {
        await apply(processor, {
          idempotencyKey: `sim-settle-step-${String(partialIndex + 1).padStart(3, "0")}-${stepOrder + 1}`,
          origin: { ...origin, capturedAt: at(1760 + partialIndex * 3 + stepOrder) },
          createdAt: at(1760 + partialIndex * 3 + stepOrder),
          dependencies: [],
          command: {
            commandType: "settlement.append_step",
            commandId: randomUUID(),
            settlementId: queueCode,
            step: steps[stepOrder],
          },
        });
      }
    }

    const queueRowsAfter = await db.select().from(queues).orderBy(queues.queueCode);
    for (const [index, queueRow] of queueRowsAfter.entries()) {
      let state: (typeof queues.$inferInsert)["state"] = "processing";
      let locked = true;

      if (index < 4) {
        state = "settled";
      } else if (index < 10) {
        state = "assay_pending";
      } else if (index < 18) {
        state = "valued";
      } else if (index < 28) {
        state = "assay_pending";
      } else if (index < 34) {
        state = "sampled";
      } else if (index % 2 === 0) {
        state = "open";
        locked = false;
      } else {
        state = "processing";
      }

      await db.update(queues).set({ state, lockedForProcessing: locked }).where(eq(queues.queueId, queueRow.queueId));
    }

    const shipmentRowsAfter = await db.select().from(shipments).orderBy(shipments.shipmentCode);
    for (const [index, shipment] of shipmentRowsAfter.entries()) {
      const nextState: (typeof shipments.$inferInsert)["state"] =
        shipment.state === "received"
          ? index % 3 === 0
            ? "closed"
            : "received"
          : index % 5 === 0
            ? "discrepant"
            : "in_transit";
      await db.update(shipments).set({ state: nextState }).where(eq(shipments.shipmentId, shipment.shipmentId));
    }

    const boxRowsAfter = await db.select().from(boxes).orderBy(boxes.externalCode);
    for (const [index, boxRow] of boxRowsAfter.entries()) {
      const nextState: (typeof boxes.$inferInsert)["state"] =
        boxRow.state === "shipped" || boxRow.state === "received"
          ? boxRow.state
          : index % 9 === 0
            ? "retired"
            : index % 4 === 0
              ? "closed"
              : "active";
      await db.update(boxes).set({ state: nextState }).where(eq(boxes.boxId, boxRow.boxId));
    }

    const converterRowsAfter = await db.select().from(converters).orderBy(converters.capturedAt);
    for (const [index, converter] of converterRowsAfter.entries()) {
      const state: (typeof converters.$inferInsert)["state"] =
        index % 17 === 0
          ? "captured"
          : index % 11 === 0
            ? "processing"
            : index % 7 === 0
              ? "sampled"
              : index % 5 === 0
                ? "settled"
                : converter.state;
      await db.update(converters).set({ state }).where(eq(converters.converterId, converter.converterId));
    }

    const evidenceGapBundles = converterRowsAfter.slice(0, 40).map((row) => row.evidenceBundleId);
    for (const [index, bundleId] of evidenceGapBundles.entries()) {
      if (index % 3 === 0) {
        await db
          .delete(evidenceArtifacts)
          .where(and(eq(evidenceArtifacts.evidenceBundleId, bundleId), eq(evidenceArtifacts.evidenceType, "gps")));
      }
    }

    const usableQueues = await db.select().from(queues).orderBy(queues.queueCode);
    const usableShipments = await db.select().from(shipments).orderBy(shipments.shipmentCode);
    const evidenceConverters = await db
      .select({
        evidenceBundleId: converters.evidenceBundleId,
        originTransactionId: converters.originTransactionId,
      })
      .from(converters)
      .orderBy(converters.capturedAt)
      .limit(130);

    for (let eventIndex = 0; eventIndex < evidenceConverters.length; eventIndex += 1) {
      const queueScope = usableQueues[eventIndex % Math.max(usableQueues.length, 1)]?.queueCode ?? queueCodes[0];
      const shipmentScope = usableShipments[eventIndex % Math.max(usableShipments.length, 1)]?.shipmentCode ?? "SHIP-SIM-001";

      await db.insert(custodyEvents).values({
        custodyEventId: randomUUID(),
        transactionId: evidenceConverters[eventIndex].originTransactionId,
        scopeType: eventIndex % 3 === 0 ? "shipment" : eventIndex % 5 === 0 ? "lot" : "queue",
        scopeId: eventIndex % 3 === 0 ? shipmentScope : queueScope,
        eventType: eventIndex % 3 === 0 ? "shipment_scan" : eventIndex % 5 === 0 ? "lot_reweigh" : "queue_scan",
        evidenceBundleId: evidenceConverters[eventIndex].evidenceBundleId,
        createdAt: new Date(BASE_TIME.getTime() + (1900 + eventIndex) * 60_000),
      });
    }

    for (let measurementIndex = 0; measurementIndex < 28; measurementIndex += 1) {
      const queueRow = usableQueues[measurementIndex % Math.max(usableQueues.length, 1)];
      if (!queueRow) break;
      const input = 620 + measurementIndex * 14;
      const output = input - (12 + (measurementIndex % 5) * 2.5);
      const loss = input - output;
      await db.insert(massMeasurements).values({
        massMeasurementId: randomUUID(),
        queueId: queueRow.queueId,
        stage: measurementIndex % 2 === 0 ? "pre-process" : "post-process",
        inputWeightKg: input.toFixed(3),
        outputWeightKg: output.toFixed(3),
        explainedLossKg: loss.toFixed(3),
        capturedAt: new Date(BASE_TIME.getTime() + (2050 + measurementIndex) * 60_000),
      });
    }

    const linkedSettlements = await db.select().from(settlements);

    console.log("Deterministic scenario complete with scaled truth-graph dataset.");
    console.log({
      sites: 6,
      operators: 22,
      customers: 40,
      converters: converterRowsAfter.length,
      boxes: boxRowsAfter.length,
      queues: queueRowsAfter.length,
      shipments: shipmentRowsAfter.length,
      evidenceArtifactsAfterGaping: await db.select().from(evidenceArtifacts).then((rows) => rows.length),
      settlements: linkedSettlements.length,
    });
  } finally {
    await pool.end();
  }
}
