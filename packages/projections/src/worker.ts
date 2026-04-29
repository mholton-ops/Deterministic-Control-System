import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { DcsDb } from "@dcs/db";
import { projectionRebuildCheckpoint, transactionEnvelopes } from "@dcs/db";

import { rebuildMaterializedProjections } from "./materializer";

export interface ProjectionWorkerResult {
  readonly ran: boolean;
  readonly reason: "up_to_date" | "rebuilt" | "no_applied_transactions";
  readonly lastTransactionId: string | null;
  readonly projectionGeneratedAt: string | null;
}

export async function runProjectionWorkerOnce(db: DcsDb): Promise<ProjectionWorkerResult> {
  const latestAppliedRows = await db
    .select({
      transactionId: transactionEnvelopes.transactionId,
      appliedAt: transactionEnvelopes.appliedAt,
    })
    .from(transactionEnvelopes)
    .where(
      and(
        eq(transactionEnvelopes.validationState, "applied"),
        isNotNull(transactionEnvelopes.appliedAt),
      ),
    )
    .orderBy(desc(transactionEnvelopes.appliedAt))
    .limit(1);

  if (latestAppliedRows.length === 0) {
    return {
      ran: false,
      reason: "no_applied_transactions",
      lastTransactionId: null,
      projectionGeneratedAt: null,
    };
  }

  const latest = latestAppliedRows[0];
  const checkpointRows = await db
    .select()
    .from(projectionRebuildCheckpoint)
    .where(eq(projectionRebuildCheckpoint.checkpointKey, "global"))
    .limit(1);

  const checkpoint = checkpointRows.length > 0 ? checkpointRows[0] : null;

  if (checkpoint?.lastTransactionId === latest.transactionId) {
    return {
      ran: false,
      reason: "up_to_date",
      lastTransactionId: latest.transactionId,
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
      lastAppliedAt: latest.appliedAt,
      lastTransactionId: latest.transactionId,
      projectionGeneratedAt: new Date(summary.generatedAt),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: projectionRebuildCheckpoint.checkpointKey,
      set: {
        lastAppliedAt: latest.appliedAt,
        lastTransactionId: latest.transactionId,
        projectionGeneratedAt: new Date(summary.generatedAt),
        updatedAt: new Date(),
      },
    });

  return {
    ran: true,
    reason: "rebuilt",
    lastTransactionId: latest.transactionId,
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
