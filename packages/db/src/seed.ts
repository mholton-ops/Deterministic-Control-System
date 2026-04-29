import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import {
  accounts,
  correctionMatrices,
  createDb,
  createPool,
  devices,
  marketSnapshots,
  termsProfiles,
  users,
} from "./index";

async function upsertUser(db: ReturnType<typeof createDb>, userId: string, role: string, displayName: string) {
  const rows = await db.select().from(users).where(eq(users.userId, userId)).limit(1);
  if (rows.length > 0) return rows[0];

  await db.insert(users).values({
    userId,
    externalRef: userId,
    displayName,
    role,
    active: true,
    createdAt: new Date(),
  });

  const inserted = await db.select().from(users).where(eq(users.userId, userId)).limit(1);
  return inserted[0];
}

async function upsertDevice(db: ReturnType<typeof createDb>, deviceId: string, assignedUserId: string) {
  const rows = await db.select().from(devices).where(eq(devices.deviceId, deviceId)).limit(1);
  if (rows.length > 0) return rows[0];

  await db.insert(devices).values({
    deviceId,
    externalRef: deviceId,
    assignedUserId,
    active: true,
    createdAt: new Date(),
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

  const accountId = randomUUID();
  await db.insert(accounts).values({
    accountId,
    accountCode,
    accountType,
    ownerRef: accountCode,
    active: true,
    createdAt: new Date(),
  });

  const inserted = await db.select().from(accounts).where(eq(accounts.accountId, accountId)).limit(1);
  return inserted[0];
}

export async function seedDeterministicData(): Promise<void> {
  const pool = createPool();
  const db = createDb(pool);

  try {
    const operatorUserId = "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd0001";
    const operatorDeviceId = "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd0002";

    await upsertUser(db, operatorUserId, "operator", "Seeded Operator");
    await upsertDevice(db, operatorDeviceId, operatorUserId);

    const internal = await upsertAccount(db, "internal_funding_pool", "internal");
    await upsertAccount(db, "buyer_alpha", "buyer");
    const customer = await upsertAccount(db, "customer_demo", "customer");

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
        createdAt: new Date(),
      });
    }

    const marketRows = await db
      .select()
      .from(marketSnapshots)
      .where(eq(marketSnapshots.marketSnapshotId, "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd2001"))
      .limit(1);

    if (marketRows.length === 0) {
      await db.insert(marketSnapshots).values({
        marketSnapshotId: "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd2001",
        ptUsdPerOz: "980.00",
        pdUsdPerOz: "1105.00",
        rhUsdPerOz: "4520.00",
        capturedAt: new Date("2026-01-15T00:00:00.000Z"),
      });
    }

    const termsRows = await db
      .select()
      .from(termsProfiles)
      .where(eq(termsProfiles.termsProfileId, "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd3001"))
      .limit(1);

    if (termsRows.length === 0) {
      await db.insert(termsProfiles).values({
        termsProfileId: "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd3001",
        customerAccountId: customer.accountId,
        payoutFactor: "0.92",
        processingChargeUsd: "25.00",
        treatmentChargeUsd: "14.00",
        activeFrom: new Date("2026-01-01T00:00:00.000Z"),
        activeTo: null,
      });
    }

    console.log("Seed data applied.");
    console.log({
      operatorUserId,
      operatorDeviceId,
      internalFundingAccountId: internal.accountId,
      customerAccountId: customer.accountId,
      marketSnapshotId: "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd2001",
      termsProfileId: "8a3d5b8f-899f-4a3f-a8eb-2c7af6dd3001",
    });
  } finally {
    await pool.end();
  }
}

seedDeterministicData().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
