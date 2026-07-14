import { eq } from "drizzle-orm";
import type { DcsDb } from "@dcs/db";
import {
  accounts,
  boxes,
  converters,
  evidenceBundles,
  libraryEntries,
  queues,
  settlements,
  shipments,
  sites,
  transactionEnvelopes,
} from "@dcs/db";

export interface DependencyRequirement {
  readonly entityType: string;
  readonly entityId: string;
  readonly requiredState: string;
}

function compareState(dependency: DependencyRequirement, actualState: string | null): string | null {
  if (actualState === null) {
    return `${dependency.entityType} ${dependency.entityId} not found`;
  }
  if (dependency.requiredState === "exists" || dependency.requiredState === actualState) {
    return null;
  }
  return `${dependency.entityType} ${dependency.entityId} expected ${dependency.requiredState} got ${actualState}`;
}

export async function validateDependency(
  db: DcsDb,
  dependency: DependencyRequirement,
): Promise<string | null> {
  if (dependency.entityType === "converter") {
    const row = await db.select({ state: converters.state }).from(converters).where(eq(converters.converterId, dependency.entityId)).limit(1);
    return compareState(dependency, row[0]?.state ?? null);
  }
  if (dependency.entityType === "box") {
    const row = await db.select({ state: boxes.state }).from(boxes).where(eq(boxes.boxId, dependency.entityId)).limit(1);
    return compareState(dependency, row[0]?.state ?? null);
  }
  if (dependency.entityType === "queue") {
    const row = await db.select({ state: queues.state }).from(queues).where(eq(queues.queueId, dependency.entityId)).limit(1);
    return compareState(dependency, row[0]?.state ?? null);
  }
  if (dependency.entityType === "shipment") {
    const row = await db.select({ state: shipments.state }).from(shipments).where(eq(shipments.shipmentId, dependency.entityId)).limit(1);
    return compareState(dependency, row[0]?.state ?? null);
  }
  if (dependency.entityType === "settlement") {
    const row = await db.select({ state: settlements.status }).from(settlements).where(eq(settlements.settlementId, dependency.entityId)).limit(1);
    return compareState(dependency, row[0]?.state ?? null);
  }
  if (dependency.entityType === "transaction") {
    const row = await db.select({ state: transactionEnvelopes.validationState }).from(transactionEnvelopes).where(eq(transactionEnvelopes.transactionId, dependency.entityId)).limit(1);
    return compareState(dependency, row[0]?.state ?? null);
  }
  if (dependency.entityType === "account") {
    const row = await db.select({ active: accounts.active }).from(accounts).where(eq(accounts.accountId, dependency.entityId)).limit(1);
    return compareState(dependency, row[0] ? (row[0].active ? "active" : "inactive") : null);
  }
  if (dependency.entityType === "library_entry") {
    const row = await db.select({ state: libraryEntries.qualificationStatus }).from(libraryEntries).where(eq(libraryEntries.libraryEntryId, dependency.entityId)).limit(1);
    return compareState(dependency, row[0]?.state ?? null);
  }
  if (dependency.entityType === "site") {
    const row = await db.select({ id: sites.siteId }).from(sites).where(eq(sites.siteId, dependency.entityId)).limit(1);
    return compareState(dependency, row[0] ? "exists" : null);
  }
  if (dependency.entityType === "evidence_bundle") {
    const row = await db.select({ id: evidenceBundles.evidenceBundleId }).from(evidenceBundles).where(eq(evidenceBundles.evidenceBundleId, dependency.entityId)).limit(1);
    return compareState(dependency, row[0] ? "exists" : null);
  }
  return `unknown dependency type ${dependency.entityType}`;
}
