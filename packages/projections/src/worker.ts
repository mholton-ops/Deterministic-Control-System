import { createHash } from "node:crypto";

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { DcsDb } from "@dcs/db";
import { projectionRebuildCheckpoint, transactionEnvelopes } from "@dcs/db";

import { rebuildMaterializedProjections } from "./materializer";

export interface ProjectionWorkerResult {
  readonly ran: boolean;
  readonly reason: "up_to_date" | "rebuilt" | "no_transactions";
  readonly lastTransactionId: string | null;
  readonly projectionGeneratedAt: string | null;
}

export async function runProjectionWorkerOnce(db: DcsDb): Promise<ProjectionWorkerResult> {
  const sourceStateRows = await db
    .select({
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${transactionEnvelopes.validationState} = 'pending')::int`,
      awaitingValidation: sql<number>`count(*) filter (where ${transactionEnvelopes.validationState} = 'awaiting_validation')::int`,
      applied: sql<number>`count(*) filter (where ${transactionEnvelopes.validationState} = 'applied')::int`,
      confirmed: sql<number>`count(*) filter (where ${transactionEnvelopes.validationState} = 'confirmed')::int`,
      failed: sql<number>`count(*) filter (where ${transactionEnvelopes.validationState} = 'failed')::int`,
    })
    .from(transactionEnvelopes);
  const sourceState = sourceStateRows[0] ?? {
    total: 0,
    pending: 0,
    awaitingValidation: 0,
    applied: 0,
    confirmed: 0,
    failed: 0,
  };
  const sourceFingerprint = createHash("sha256")
    .update(JSON.stringify(sourceState))
    .digest("hex");

  const latestAppliedRows = await db
    .select({
      transactionId: transactionEnvelopes.transactionId,
      appliedAt: transactionEnvelopes.appliedAt,
    })
    .from(transactionEnvelopes)
    .where(
      and(
        inArray(transactionEnvelopes.validationState, ["applied", "confirmed"]),
        isNotNull(transactionEnvelopes.appliedAt),
      ),
    )
    .orderBy(desc(transactionEnvelopes.appliedAt), desc(transactionEnvelopes.transactionId))
    .limit(1);

  if (sourceState.total === 0) {
    return {
      ran: false,
      reason: "no_transactions",
      lastTransactionId: null,
      projectionGeneratedAt: null,
    };
  }

  const latestAccepted = latestAppliedRows[0] ?? null;
  const latestTransactionRows = await db
    .select({ transactionId: transactionEnvelopes.transactionId })
    .from(transactionEnvelopes)
    .orderBy(desc(transactionEnvelopes.createdAt), desc(transactionEnvelopes.transactionId))
    .limit(1);
  const latestTransactionId = latestTransactionRows[0]?.transactionId ?? null;
  const checkpointRows = await db
    .select()
    .from(projectionRebuildCheckpoint)
    .where(eq(projectionRebuildCheckpoint.checkpointKey, "global"))
    .limit(1);
  const checkpoint = checkpointRows[0] ?? null;

  if (
    checkpoint?.sourceTransactionCount === sourceState.total &&
    checkpoint.sourceFingerprint === sourceFingerprint
  ) {
    return {
      ran: false,
      reason: "up_to_date",
      lastTransactionId: latestTransactionId,
      projectionGeneratedAt: checkpoint.projectionGeneratedAt
        ? checkpoint.projectionGeneratedAt.toISOString()
        : null,
    };
  }

  const summary = await rebuildMaterializedProjections(db);

  await db
    .insert(projectionRebuildCheckpoint)
    .values({
      checkpointKey: "global",
      lastAppliedAt: latestAccepted?.appliedAt ?? null,
      lastTransactionId: latestTransactionId,
      sourceTransactionCount: sourceState.total,
      sourceFingerprint,
      projectionGeneratedAt: new Date(summary.generatedAt),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: projectionRebuildCheckpoint.checkpointKey,
      set: {
        lastAppliedAt: latestAccepted?.appliedAt ?? null,
        lastTransactionId: latestTransactionId,
        sourceTransactionCount: sourceState.total,
        sourceFingerprint,
        projectionGeneratedAt: new Date(summary.generatedAt),
        updatedAt: new Date(),
      },
    });

  return {
    ran: true,
    reason: "rebuilt",
    lastTransactionId: latestTransactionId,
    projectionGeneratedAt: summary.generatedAt,
  };
}

export async function runProjectionWorkerLoop(
  db: DcsDb,
  intervalMs: number,
  onTick?: (result: ProjectionWorkerResult) => void,
): Promise<never> {
  for (;;) {
    const result = await runProjectionWorkerOnce(db);
    onTick?.(result);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
