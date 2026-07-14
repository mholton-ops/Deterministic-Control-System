import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import {
  accounts,
  correctionMatrices,
  createDb,
  createPool,
  devices,
  libraryEntries,
  marketSnapshots,
  sites,
  termsProfiles,
  users,
} from "./index";

const SEED_TIME = new Date("2026-01-01T00:00:00.000Z");

function deterministicSeedUuid(value: string): string {
  const hex = createHash("sha256").update(`dcs-seed:${value}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function upsertUser(
  db: ReturnType<typeof createDb>,
  userId: string,
  role: string,
  displayName: string,
) {
  const rows = await db.select().from(users).where(eq(users.userId, userId)).limit(1);
  if (rows.length > 0) return rows[0];

  await db.insert(users).values({
    userId,
    externalRef: userId,
    displayName,
    role,
    active: true,
    createdAt: SEED_TIME,
  });
  const inserted = await db.select().from(users).where(eq(users.userId, userId)).limit(1);
  return inserted[0];
}

async function upsertDevice(
  db: ReturnType<typeof createDb>,
  deviceId: string,
  assignedUserId: string,
) {
  const rows = await db.select().from(devices).where(eq(devices.deviceId, deviceId)).limit(1);
  if (rows.length > 0) return rows[0];

  await db.insert(devices).values({
    deviceId,
    externalRef: deviceId,
    assignedUserId,
    active: true,
    createdAt: SEED_TIME,
  });
  const inserted = await db.select().from(devices).where(eq(devices.deviceId, deviceId)).limit(1);
  return inserted[0];
}

async function upsertAccount(
  db: ReturnType<typeof createDb>,
  accountCode: string,
  accountType: "buyer" | "warehouse" | "bank" | "customer" | "internal",
) {
  const rows = await db.select().from(accounts).where(eq(accounts.accountCode, accountCode)).limit(1);
  if (rows.length > 0) return rows[0];

  const accountId = deterministicSeedUuid(`account:${accountCode}`);
  await db.insert(accounts).values({
    accountId,
    accountCode,
    accountType,
    ownerRef: accountCode,
    active: true,
    createdAt: SEED_TIME,
  });
  const inserted = await db.select().from(accounts).where(eq(accounts.accountId, accountId)).limit(1);
  return inserted[0];
}

async function upsertSite(
  db: ReturnType<typeof createDb>,
  siteCode: string,
  name: string,
  siteType: string,
) {
  const rows = await db.select().from(sites).where(eq(sites.siteCode, siteCode)).limit(1);
  if (rows.length > 0) return rows[0];

  const siteId = deterministicSeedUuid(`site:${siteCode}`);
  await db.insert(sites).values({ siteId, siteCode, name, siteType, createdAt: SEED_TIME });
  const inserted = await db.select().from(sites).where(eq(sites.siteId, siteId)).limit(1);
  return inserted[0];
}

export async function seedDeterministicData(): Promise<void> {
  const pool = createPool();
  const db = createDb(pool);

  try {
    const operatorUserId = "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd0001";
    const operatorDeviceId = "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd0002";
    const financeApproverUserId = "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd0003";

    await upsertUser(db, operatorUserId, "operator", "Seeded Operator");
    await upsertDevice(db, operatorDeviceId, operatorUserId);
    await upsertUser(db, financeApproverUserId, "finance_approver", "Seeded Finance Approver");

    const internal = await upsertAccount(db, "internal_funding_pool", "internal");
    await upsertAccount(db, "buyer_alpha", "buyer");
    await upsertAccount(db, "buyer_beta", "buyer");
    await upsertAccount(db, "buyer_gamma", "buyer");
    await upsertAccount(db, "treasury_bank", "bank");
    await upsertAccount(db, "warehouse_ops", "warehouse");
    const customer = await upsertAccount(db, "customer_demo", "customer");

    for (const [siteCode, name, siteType] of [
      ["YARD-SIM-01", "Demo Origin Yard", "yard"],
      ["WAREHOUSE-SIM-01", "Demo Receiving Warehouse", "warehouse"],
      ["SITE-SIM-01", "Demo Site 01", "yard"],
      ["SITE-SIM-02", "Demo Site 02", "yard"],
      ["SITE-SIM-03", "Demo Site 03", "yard"],
      ["SITE-SIM-04", "Demo Site 04", "yard"],
      ["SITE-SIM-05", "Demo Processing Site", "processor"],
      ["SITE-SIM-06", "Demo Reserve Site", "warehouse"],
    ] as const) {
      await upsertSite(db, siteCode, name, siteType);
    }

    const matrixRows = await db
      .select()
      .from(correctionMatrices)
      .where(eq(correctionMatrices.materialFingerprint, "seeded-pgm-mix-a"))
      .limit(1);
    if (matrixRows.length === 0) {
      await db.insert(correctionMatrices).values({
        matrixId: "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd1001",
        materialFingerprint: "seeded-pgm-mix-a",
        qualificationStatus: "qualified",
        ptMultiplier: "1.035000",
        pdMultiplier: "0.982000",
        rhMultiplier: "1.061000",
        version: 1,
        createdAt: SEED_TIME,
      });
    }

    const marketData = [
      ["8a3d5b8f-899f-4a3f-a8eb-2c7af6dd2001", "980.00", "1105.00", "4520.00", "2026-01-15T00:00:00.000Z"],
      ["8a3d5b8f-899f-4a3f-a8eb-2c7af6dd2002", "995.00", "1088.00", "4475.00", "2026-01-16T00:00:00.000Z"],
      ["8a3d5b8f-899f-4a3f-a8eb-2c7af6dd2003", "972.00", "1124.00", "4580.00", "2026-01-17T00:00:00.000Z"],
    ] as const;
    for (const [marketSnapshotId, ptUsdPerOz, pdUsdPerOz, rhUsdPerOz, capturedAt] of marketData) {
      const rows = await db
        .select({ id: marketSnapshots.marketSnapshotId })
        .from(marketSnapshots)
        .where(eq(marketSnapshots.marketSnapshotId, marketSnapshotId))
        .limit(1);
      if (rows.length === 0) {
        await db.insert(marketSnapshots).values({
          marketSnapshotId,
          ptUsdPerOz,
          pdUsdPerOz,
          rhUsdPerOz,
          capturedAt: new Date(capturedAt),
        });
      }
    }

    const termsData = [
      ["8a3d5b8f-899f-4a3f-a8eb-2c7af6dd3001", "0.92", "25.00", "14.00"],
      ["8a3d5b8f-899f-4a3f-a8eb-2c7af6dd3002", "0.90", "28.00", "15.00"],
      ["8a3d5b8f-899f-4a3f-a8eb-2c7af6dd3003", "0.94", "22.00", "12.00"],
    ] as const;
    for (const [termsProfileId, payoutFactor, processingChargeUsd, treatmentChargeUsd] of termsData) {
      const rows = await db
        .select({ id: termsProfiles.termsProfileId })
        .from(termsProfiles)
        .where(eq(termsProfiles.termsProfileId, termsProfileId))
        .limit(1);
      if (rows.length === 0) {
        await db.insert(termsProfiles).values({
          termsProfileId,
          customerAccountId: customer.accountId,
          payoutFactor,
          processingChargeUsd,
          treatmentChargeUsd,
          activeFrom: SEED_TIME,
          activeTo: null,
        });
      }
    }

    const libraryData = [
      ["8a3d5b8f-899f-4a3f-a8eb-2c7af6dd4001", "VIN-SIM-*", null, "vin"],
      ["8a3d5b8f-899f-4a3f-a8eb-2c7af6dd4002", null, "SERIAL-SIM-*", "serial"],
      ["8a3d5b8f-899f-4a3f-a8eb-2c7af6dd4003", null, null, "library_match"],
      ["8a3d5b8f-899f-4a3f-a8eb-2c7af6dd4004", null, null, "category_fallback"],
    ] as const;
    for (const [libraryEntryId, vinPattern, serialPattern, method] of libraryData) {
      const rows = await db
        .select({ id: libraryEntries.libraryEntryId })
        .from(libraryEntries)
        .where(eq(libraryEntries.libraryEntryId, libraryEntryId))
        .limit(1);
      if (rows.length === 0) {
        await db.insert(libraryEntries).values({
          libraryEntryId,
          qualificationStatus: "qualified",
          vinPattern,
          serialPattern,
          morphologicalSignature: { method, source: "deterministic_demo_master" },
          confidenceBand: method === "category_fallback" ? "low" : method === "library_match" ? "medium" : "high",
          createdAt: SEED_TIME,
        });
      }
    }

    console.log("Seed data applied.");
    console.log({
      operatorUserId,
      operatorDeviceId,
      financeApproverUserId,
      internalFundingAccountId: internal.accountId,
      customerAccountId: customer.accountId,
      marketSnapshotIds: marketData.map(([id]) => id),
      termsProfileIds: termsData.map(([id]) => id),
      libraryEntryIds: libraryData.map(([id]) => id),
    });
  } finally {
    await pool.end();
  }
}

seedDeterministicData().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
