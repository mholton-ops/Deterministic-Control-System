import { createHash } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import {
  accounts,
  boxes,
  converters,
  createDb,
  createPool,
  devices,
  evidenceArtifacts,
  ledgerEntries,
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
const LIBRARY_ENTRY_BY_METHOD = {
  vin: "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd4001",
  serial: "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd4002",
  library_match: "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd4003",
  category_fallback: "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd4004",
} as const;
const MARKET_SNAPSHOT_IDS = [
  "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd2001",
  "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd2002",
  "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd2003",
] as const;
const TERMS_PROFILE_IDS = [
  "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd3001",
  "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd3002",
  "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd3003",
] as const;

function normalizeToUuid(value: string): string {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (uuidRegex.test(value)) {
    return value;
  }

  const hex = createHash("sha1").update(value).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

let scenarioUuidSequence = 0;

function nextScenarioUuid(): string {
  scenarioUuidSequence += 1;
  return normalizeToUuid(`scenario-uuid-${scenarioUuidSequence}`);
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

async function ensureOrigin(
  db: ReturnType<typeof createDb>,
  userId: string,
  deviceId: string,
  index: number,
  role: string = index % 3 === 0 ? "supervisor" : "operator",
) {
  const existingUser = await db.select().from(users).where(eq(users.userId, userId)).limit(1);
  if (existingUser.length === 0) {
    await db.insert(users).values({
      userId,
      externalRef: `operator-${String(index + 1).padStart(2, "0")}`,
      displayName: `Operator ${String(index + 1).padStart(2, "0")}`,
      role,
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
  scenarioUuidSequence = 0;
  const pool = createPool();
  const db = createDb(pool);
  const processor = new CommandProcessor(db);
  const financeApproverUserId = normalizeToUuid("sim-finance-approver");
  const financeApproverDeviceId = normalizeToUuid("sim-finance-approver-device");

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
  const queueCodes = Array.from({ length: 38 }, (_, index) => `QUEUE-SIM-${String(index + 1).padStart(3, "0")}`);

  try {
    for (let i = 0; i < 22; i += 1) {
      const userId = normalizeToUuid(`sim-user-${i + 1}`);
      const deviceId = normalizeToUuid(`sim-device-${i + 1}`);
      await ensureOrigin(db, userId, deviceId, i);
      origins.push({ sourceSystem: "operator_console", userId, deviceId, capturedAt: at(i) });
    }
    await ensureOrigin(db, financeApproverUserId, financeApproverDeviceId, 99, "finance_approver");

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
          commandId: nextScenarioUuid(),
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
            evidenceBundleId: nextScenarioUuid(),
            requiredTypesPresent: ["image", "gps"],
          },
        },
      });
    }

    const boxRows = await db.select().from(boxes).orderBy(boxes.externalCode);
    const defaultQueueCode = queueCodes[0];
    if (!defaultQueueCode) {
      throw new Error("Queue code list is empty.");
    }

    const processedBoxes = boxRows.filter((row) => row.materialType === "processed_catalyst");
    const dustBoxes = boxRows.filter((row) => row.materialType === "dust_recovery");
    const wholeBoxes = boxRows.filter((row) => row.materialType === "whole_converter");

    const queueAssignments: Array<{
      queueCode: string;
      boxCode: string;
      assignedAt: string;
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
        queueAssignments.push({
          queueCode,
          boxCode: selectedBox.externalCode,
          assignedAt: new Date(
            BASE_TIME.getTime() + (450 + assignmentOffset + index) * 60_000,
          ).toISOString(),
        });
      }
    }

    assignBoxSeries(processedBoxes, 0, 10, 0);
    assignBoxSeries(dustBoxes, 10, 10, 20);
    assignBoxSeries(wholeBoxes, 20, queueCodes.length - 20, 34);

    for (let assignmentIndex = 0; assignmentIndex < queueAssignments.length; assignmentIndex += 1) {
      const assignment = queueAssignments[assignmentIndex];
      const origin = origins[assignmentIndex % origins.length];
      await apply(processor, {
        idempotencyKey: `sim-assign-box-queue-${String(assignmentIndex + 1).padStart(3, "0")}`,
        origin: { ...origin, capturedAt: assignment.assignedAt },
        createdAt: assignment.assignedAt,
        dependencies: [],
        command: {
          commandType: "custody.assign_box_to_queue",
          commandId: nextScenarioUuid(),
          boxId: assignment.boxCode,
          queueId: assignment.queueCode,
        },
      });
    }

    for (let queueIndex = 0; queueIndex < queueCodes.length; queueIndex += 1) {
      const queueCode = queueCodes[queueIndex];
      const origin = origins[queueIndex % origins.length];
      await apply(processor, {
        idempotencyKey: `sim-lock-queue-${String(queueIndex + 1).padStart(3, "0")}`,
        origin: { ...origin, capturedAt: at(540 + queueIndex) },
        createdAt: at(540 + queueIndex),
        dependencies: [],
        command: {
          commandType: "custody.lock_queue_for_processing",
          commandId: nextScenarioUuid(),
          queueId: queueCode,
        },
      });
    }

    let shipmentCursor = 0;
    const shippableBoxes = boxRows.slice(0, 62).map((row) => row.externalCode);
    for (let boxIndex = 0; boxIndex < shippableBoxes.length; boxIndex += 1) {
      const origin = origins[boxIndex % origins.length];
      await apply(processor, {
        idempotencyKey: `sim-close-box-${String(boxIndex + 1).padStart(3, "0")}`,
        origin: { ...origin, capturedAt: at(580 + boxIndex) },
        createdAt: at(580 + boxIndex),
        dependencies: [],
        command: {
          commandType: "custody.close_box",
          commandId: nextScenarioUuid(),
          boxId: shippableBoxes[boxIndex],
        },
      });
    }
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
          commandId: nextScenarioUuid(),
          shipmentCode,
          originSiteId: originSite,
          destinationSiteId: "SITE-SIM-05",
          boxCodes: selectedBoxes,
        },
      });

      const containsMilledMaterial = selectedBoxes.some(
        (boxCode) => boxCode.startsWith("PC-BOX-") || boxCode.startsWith("DR-BOX-"),
      );
      if (containsMilledMaterial || shipmentIndex % 4 !== 0) {
        await apply(processor, {
          idempotencyKey: `sim-receive-shipment-${String(shipmentIndex + 1).padStart(3, "0")}`,
          origin: { ...origin, capturedAt: at(680 + shipmentIndex) },
          createdAt: at(680 + shipmentIndex),
          dependencies: [],
          command: {
            commandType: "custody.receive_shipment",
          commandId: nextScenarioUuid(),
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
      const confidence =
        method === "category_fallback"
          ? "low"
          : method === "library_match"
            ? "medium"
            : gradingIndex % 9 === 0
              ? "low"
              : "high";

      await apply(processor, {
        idempotencyKey: `sim-grade-${String(gradingIndex + 1).padStart(4, "0")}`,
        origin: { ...origin, capturedAt: at(760 + gradingIndex) },
        createdAt: at(760 + gradingIndex),
        dependencies: [],
        command: {
          commandType: "grading.issue_decision",
          commandId: nextScenarioUuid(),
          converterId: converter.converterId,
          candidateId: LIBRARY_ENTRY_BY_METHOD[method],
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
          commandId: nextScenarioUuid(),
            queueId: queueCode,
            source: sampleIndex === sampleCount - 1 && queueIndex % 4 === 0 ? "icp_final" : "internal_xrf",
            ptPpm: 420 + (queueIndex % 15) * 18 + sampleIndex * 4,
            pdPpm: 710 + (queueIndex % 13) * 23 + sampleIndex * 5,
            rhPpm: 70 + (queueIndex % 11) * 7 + sampleIndex,
            matrixId: queueIndex % 2 === 0 ? "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd1001" : null,
            evidence: { evidenceBundleId: nextScenarioUuid(), requiredTypesPresent: ["note"] },
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
          commandId: nextScenarioUuid(),
          queueId: queueCodes[queueIndex],
          marketSnapshotId: MARKET_SNAPSHOT_IDS[queueIndex % MARKET_SNAPSHOT_IDS.length],
          termsProfileId: TERMS_PROFILE_IDS[queueIndex % TERMS_PROFILE_IDS.length],
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
          commandId: nextScenarioUuid(),
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
          commandId: nextScenarioUuid(),
          debitAccountId: "internal_funding_pool",
          creditAccountId: ledgerIndex % 2 === 0 ? "buyer_alpha" : "buyer_beta",
          amount: {
            amount: advanceAmount.toFixed(2),
            currency: "USD",
          },
          purposeCode: ledgerIndex % 5 === 0 ? "field_purchase" : "funding_advance",
          sourceOperationalRef: queueCode,
          approvedByUserId: ledgerIndex % 5 === 0 ? null : financeApproverUserId,
          notes: `Funding line ${ledgerIndex + 1} for ${queueCode}`,
          evidence: {
            evidenceBundleId: nextScenarioUuid(),
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
          commandId: nextScenarioUuid(),
          debitAccountId: "buyer_gamma",
          creditAccountId: "treasury_bank",
          amount: {
            amount: wireAmount.toFixed(2),
            currency: "USD",
          },
          purposeCode: "wire",
          sourceOperationalRef: queueCode,
          approvedByUserId: null,
          notes: `Treasury movement ${ledgerIndex + 1}`,
          evidence: {
            evidenceBundleId: nextScenarioUuid(),
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
          commandId: nextScenarioUuid(),
          debitAccountId: "warehouse_ops",
          creditAccountId: "buyer_beta",
          amount: {
            amount: adjustmentAmount.toFixed(2),
            currency: "USD",
          },
          purposeCode: "adjustment",
          sourceOperationalRef: queueCode,
          approvedByUserId: null,
          notes: `Additive correction ${ledgerIndex + 1} for ${queueCode}`,
          evidence: {
            evidenceBundleId: nextScenarioUuid(),
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
          commandId: nextScenarioUuid(),
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
          commandId: nextScenarioUuid(),
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
          commandId: nextScenarioUuid(),
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
          commandId: nextScenarioUuid(),
            queueId: queueCode,
            source: "icp_final",
            ptPpm: 460 + (settlementIndex % 12) * 15,
            pdPpm: 760 + (settlementIndex % 10) * 21,
            rhPpm: 84 + (settlementIndex % 9) * 6,
            matrixId: null,
            evidence: { evidenceBundleId: nextScenarioUuid(), requiredTypesPresent: ["note"] },
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
      const requiredSteps: Array<
        | "lot_selected"
        | "contents_reviewed"
        | "sample_data_recorded"
        | "adjustments_recorded"
        | "weight_basis_locked"
        | "hedges_applied"
        | "financial_context_applied"
      > = [
        "lot_selected",
        "contents_reviewed",
        "sample_data_recorded",
        "adjustments_recorded",
        "weight_basis_locked",
        "hedges_applied",
        "financial_context_applied",
      ];
      for (let stepIndex = 0; stepIndex < requiredSteps.length; stepIndex += 1) {
        await apply(processor, {
          idempotencyKey: `sim-settle-control-${String(settlementIndex + 1).padStart(3, "0")}-${stepIndex + 1}`,
          origin: { ...origin, capturedAt: at(1700 + settlementIndex * 8 + stepIndex) },
          createdAt: at(1700 + settlementIndex * 8 + stepIndex),
          dependencies: [],
          command: {
            commandType: "settlement.append_step",
          commandId: nextScenarioUuid(),
            settlementId: queueCode,
            step: requiredSteps[stepIndex],
          },
        });
      }
      await apply(processor, {
        idempotencyKey: `sim-settle-final-${String(settlementIndex + 1).padStart(3, "0")}`,
        origin: { ...origin, capturedAt: at(1700 + settlementIndex * 8 + requiredSteps.length) },
        createdAt: at(1700 + settlementIndex * 8 + requiredSteps.length),
        dependencies: [],
        command: {
          commandType: "settlement.finalize_from_assay",
          commandId: nextScenarioUuid(),
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
          commandId: nextScenarioUuid(),
            settlementId: queueCode,
            step: steps[stepOrder],
          },
        });
      }
    }

    const usableQueues = await db.select().from(queues).orderBy(queues.queueCode);
    const usableShipments = await db.select().from(shipments).orderBy(shipments.shipmentCode);
    const evidenceConverters = await db
      .select({
        evidenceBundleId: converters.evidenceBundleId,
      })
      .from(converters)
      .orderBy(converters.capturedAt)
      .limit(130);

    for (let eventIndex = 0; eventIndex < evidenceConverters.length; eventIndex += 1) {
      const queueScope = usableQueues[eventIndex % Math.max(usableQueues.length, 1)]?.queueCode ?? queueCodes[0];
      const shipmentScope = usableShipments[eventIndex % Math.max(usableShipments.length, 1)]?.shipmentCode ?? "SHIP-SIM-001";
      const origin = origins[eventIndex % origins.length];
      const capturedAt = at(1900 + eventIndex);
      await apply(processor, {
        idempotencyKey: `sim-custody-event-${String(eventIndex + 1).padStart(3, "0")}`,
        origin: { ...origin, capturedAt },
        createdAt: capturedAt,
        dependencies: [],
        command: {
          commandType: "custody.record_event",
          commandId: nextScenarioUuid(),
          scopeType: eventIndex % 3 === 0 ? "shipment" : "queue",
          scopeId: eventIndex % 3 === 0 ? shipmentScope : queueScope,
          eventType: eventIndex % 3 === 0 ? "shipment_scan" : "queue_scan",
          capturedAt,
          evidence: {
            evidenceBundleId: evidenceConverters[eventIndex].evidenceBundleId,
            requiredTypesPresent: ["image"],
          },
        },
      });
    }

    const measurementQueues = usableQueues.filter((row) => row.state !== "settled");
    for (let measurementIndex = 0; measurementIndex < 28; measurementIndex += 1) {
      const queueRow = measurementQueues[measurementIndex % Math.max(measurementQueues.length, 1)];
      if (!queueRow) break;
      const input = 620 + measurementIndex * 14;
      const output = input - (12 + (measurementIndex % 5) * 2.5);
      const loss = input - output;
      const origin = origins[measurementIndex % origins.length];
      const capturedAt = at(2050 + measurementIndex);
      await apply(processor, {
        idempotencyKey: `sim-mass-measurement-${String(measurementIndex + 1).padStart(3, "0")}`,
        origin: { ...origin, capturedAt },
        createdAt: capturedAt,
        dependencies: [],
        command: {
          commandType: "custody.record_mass_measurement",
          commandId: nextScenarioUuid(),
          queueId: queueRow.queueCode,
          stage: measurementIndex % 2 === 0 ? "pre-process" : "post-process",
          inputWeightKg: input,
          outputWeightKg: output,
          explainedLossKg: loss,
          capturedAt,
          evidence: { evidenceBundleId: nextScenarioUuid(), requiredTypesPresent: ["note"] },
        },
      });
    }

    const linkedSettlements = await db.select().from(settlements);
    const finalConverters = await db.select({ id: converters.converterId }).from(converters);
    const finalBoxes = await db.select({ id: boxes.boxId }).from(boxes);
    const finalQueues = await db.select({ id: queues.queueId }).from(queues);
    const finalShipments = await db.select({ id: shipments.shipmentId }).from(shipments);

    console.log("Deterministic scenario complete with scaled truth-graph dataset.");
    console.log({
      sites: 6,
      operators: 22,
      customers: 40,
      converters: finalConverters.length,
      boxes: finalBoxes.length,
      queues: finalQueues.length,
      shipments: finalShipments.length,
      evidenceArtifacts: await db.select().from(evidenceArtifacts).then((rows) => rows.length),
      settlements: linkedSettlements.length,
    });
  } finally {
    await pool.end();
  }
}
