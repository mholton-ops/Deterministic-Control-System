import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { DcsDb } from "@dcs/db";
import {
  replicationQueue,
  replicationReceipts,
  transactionDependencies,
  transactionEnvelopes,
} from "@dcs/db";
import { checksumPayload, EventLogRepository } from "@dcs/event-log";

import { validateDependency } from "./dependency-validator";

export interface ReplicationAttemptResult {
  readonly transactionId: string;
  readonly confirmedStreams: number;
  readonly failedStreams: number;
  readonly status: "confirmed" | "failed" | "not_ready";
}

function asDcsDb(value: unknown): DcsDb {
  return value as DcsDb;
}

async function failQueueItem(db: DcsDb, replicationQueueId: number, error: unknown, attemptedAt: Date): Promise<void> {
  const message = error instanceof Error ? error.message : "Replication receiver validation failed.";
  await db
    .update(replicationQueue)
    .set({
      status: "failed",
      lastError: message,
      retryCount: sql`${replicationQueue.retryCount} + 1`,
      lastAttemptAt: attemptedAt,
      nextAttemptAt: new Date(attemptedAt.getTime() + 30_000),
      updatedAt: attemptedAt,
    })
    .where(eq(replicationQueue.replicationQueueId, replicationQueueId));
}

export async function processReplicationTransaction(
  db: DcsDb,
  transactionId: string,
  attemptedAt = new Date(),
): Promise<ReplicationAttemptResult> {
  const queueRows = await db
    .select()
    .from(replicationQueue)
    .where(eq(replicationQueue.transactionId, transactionId))
    .orderBy(asc(replicationQueue.replicationQueueId));

  if (queueRows.length === 0) {
    return { transactionId, confirmedStreams: 0, failedStreams: 0, status: "not_ready" };
  }

  let confirmedStreams = 0;
  let failedStreams = 0;
  for (const queueRow of queueRows) {
    if (queueRow.status === "confirmed") {
      confirmedStreams += 1;
      continue;
    }
    if (queueRow.status === "awaiting_validation") {
      continue;
    }

    try {
      await db.transaction(async (transaction) => {
        const tx = asDcsDb(transaction);
        const envelopeRows = await tx
          .select()
          .from(transactionEnvelopes)
          .where(eq(transactionEnvelopes.transactionId, transactionId))
          .limit(1);
        const envelope = envelopeRows[0];
        if (!envelope || !["applied", "confirmed"].includes(envelope.validationState)) {
          throw new Error("The local transaction is not ready for receiver application.");
        }

        const dependencies = await tx
          .select()
          .from(transactionDependencies)
          .where(eq(transactionDependencies.transactionId, transactionId));
        for (const dependency of dependencies) {
          const violation = await validateDependency(tx, {
            entityType: dependency.dependencyEntityType,
            entityId: dependency.dependencyEntityId,
            requiredState: dependency.requiredState,
          });
          if (violation) {
            throw new Error(`Receiver dependency check failed: ${violation}`);
          }
        }

        const calculatedChecksum = checksumPayload(envelope.payload);
        if (queueRow.payloadChecksum && queueRow.payloadChecksum !== calculatedChecksum) {
          throw new Error("Receiver checksum validation failed.");
        }
        if (!queueRow.payloadChecksum) {
          await tx
            .update(replicationQueue)
            .set({ payloadChecksum: calculatedChecksum, updatedAt: attemptedAt })
            .where(eq(replicationQueue.replicationQueueId, queueRow.replicationQueueId));
        }

        await tx
          .insert(replicationReceipts)
          .values({
            transactionId,
            targetNode: queueRow.targetNode,
            streamType: queueRow.streamType,
            payloadChecksum: calculatedChecksum,
            receivedAt: attemptedAt,
          })
          .onConflictDoNothing();

        const receiptRows = await tx
          .select({ checksum: replicationReceipts.payloadChecksum })
          .from(replicationReceipts)
          .where(
            and(
              eq(replicationReceipts.transactionId, transactionId),
              eq(replicationReceipts.targetNode, queueRow.targetNode),
              eq(replicationReceipts.streamType, queueRow.streamType),
            ),
          )
          .limit(1);
        if (receiptRows[0]?.checksum !== calculatedChecksum) {
          throw new Error("Receiver idempotency receipt conflicts with the transaction checksum.");
        }

        await tx
          .update(replicationQueue)
          .set({
            status: "confirmed",
            lastError: null,
            lastAttemptAt: attemptedAt,
            nextAttemptAt: null,
            acknowledgedAt: attemptedAt,
            updatedAt: attemptedAt,
          })
          .where(eq(replicationQueue.replicationQueueId, queueRow.replicationQueueId));
      });
      confirmedStreams += 1;
    } catch (error) {
      await failQueueItem(db, queueRow.replicationQueueId, error, attemptedAt);
      failedStreams += 1;
    }
  }

  const remaining = await db
    .select({ status: replicationQueue.status })
    .from(replicationQueue)
    .where(eq(replicationQueue.transactionId, transactionId));
  if (remaining.length > 0 && remaining.every((row) => row.status === "confirmed")) {
    await new EventLogRepository(db).markConfirmed(transactionId, attemptedAt);
    return { transactionId, confirmedStreams, failedStreams, status: "confirmed" };
  }

  return {
    transactionId,
    confirmedStreams,
    failedStreams,
    status: failedStreams > 0 ? "failed" : "not_ready",
  };
}

export async function processReplicationQueueBatch(
  db: DcsDb,
  limit = 100,
  attemptedAt = new Date(),
): Promise<readonly ReplicationAttemptResult[]> {
  const rows = await db
    .select({ transactionId: replicationQueue.transactionId })
    .from(replicationQueue)
    .innerJoin(
      transactionEnvelopes,
      eq(replicationQueue.transactionId, transactionEnvelopes.transactionId),
    )
    .where(
      and(
        inArray(transactionEnvelopes.validationState, ["applied", "confirmed"]),
        or(
          eq(replicationQueue.status, "pending"),
          and(
            eq(replicationQueue.status, "failed"),
            or(isNull(replicationQueue.nextAttemptAt), lte(replicationQueue.nextAttemptAt, attemptedAt)),
          ),
        ),
      ),
    )
    .orderBy(asc(replicationQueue.updatedAt))
    .limit(limit);
  const transactionIds = [...new Set(rows.map((row) => row.transactionId))];
  const results: ReplicationAttemptResult[] = [];
  for (const queuedTransactionId of transactionIds) {
    results.push(await processReplicationTransaction(db, queuedTransactionId, attemptedAt));
  }
  return results;
}

export async function retryReplicationTransaction(
  db: DcsDb,
  transactionId: string,
  retriedAt = new Date(),
): Promise<ReplicationAttemptResult> {
  await db
    .update(replicationQueue)
    .set({ status: "pending", lastError: null, nextAttemptAt: null, updatedAt: retriedAt })
    .where(
      and(
        eq(replicationQueue.transactionId, transactionId),
        inArray(replicationQueue.status, ["failed", "awaiting_validation"]),
      ),
    );
  return processReplicationTransaction(db, transactionId, retriedAt);
}
