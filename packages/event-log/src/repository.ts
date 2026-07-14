import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import type { DcsDb } from "@dcs/db";
import {
  replicationQueue,
  transactionDependencies,
  transactionEnvelopes,
  transactionStatusEnum,
} from "@dcs/db";

export type TransactionStatus = (typeof transactionStatusEnum.enumValues)[number];

export interface AppendEnvelopeInput {
  readonly idempotencyKey: string;
  readonly eventType: string;
  readonly sourceSystem: "field_client" | "server" | "operator_console";
  readonly originUserId: string;
  readonly originDeviceId: string;
  readonly originCapturedAt: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
  readonly dependencies: readonly {
    entityType: string;
    entityId: string;
    requiredState: string;
  }[];
  readonly streams: readonly ("record" | "image")[];
}

export interface StoredEnvelope {
  readonly transactionId: string;
  readonly idempotencyKey: string;
  readonly eventType: string;
  readonly sourceSystem: "field_client" | "server" | "operator_console";
  readonly originUserId: string;
  readonly originDeviceId: string;
  readonly originCapturedAt: Date;
  readonly payload: Record<string, unknown>;
  readonly validationState: TransactionStatus;
  readonly createdAt: Date;
  readonly appliedAt: Date | null;
  readonly confirmedAt: Date | null;
  readonly failureReason: string | null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }

  return value;
}

export function checksumPayload(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(payload))).digest("hex");
}

export function deterministicTransactionId(idempotencyKey: string): string {
  const hex = createHash("sha256").update(`dcs-transaction:${idempotencyKey}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export class EventLogRepository {
  public constructor(private readonly db: DcsDb) {}

  public async findByIdempotencyKey(idempotencyKey: string): Promise<StoredEnvelope | null> {
    const rows = await this.db
      .select()
      .from(transactionEnvelopes)
      .where(eq(transactionEnvelopes.idempotencyKey, idempotencyKey))
      .limit(1);

    return rows[0] ?? null;
  }

  public async appendEnvelope(input: AppendEnvelopeInput): Promise<StoredEnvelope> {
    const transactionId = deterministicTransactionId(input.idempotencyKey);
    const payloadChecksum = checksumPayload(input.payload);
    const createdAt = new Date(input.createdAt);

    await this.db.insert(transactionEnvelopes).values({
      transactionId,
      idempotencyKey: input.idempotencyKey,
      eventType: input.eventType,
      sourceSystem: input.sourceSystem,
      originUserId: input.originUserId,
      originDeviceId: input.originDeviceId,
      originCapturedAt: new Date(input.originCapturedAt),
      payload: input.payload,
      validationState: "pending",
      createdAt,
    });

    if (input.dependencies.length > 0) {
      await this.db.insert(transactionDependencies).values(
        input.dependencies.map((dependency) => ({
          transactionId,
          dependencyEntityType: dependency.entityType,
          dependencyEntityId: dependency.entityId,
          requiredState: dependency.requiredState,
        })),
      );
    }

    await this.db.insert(replicationQueue).values(
      [...new Set(input.streams)].map((streamType) => ({
        transactionId,
        targetNode: streamType === "image" ? "evidence-receiver" : "control-receiver",
        streamType,
        payloadChecksum,
        status: "pending" as const,
        updatedAt: createdAt,
      })),
    );

    const inserted = await this.db
      .select()
      .from(transactionEnvelopes)
      .where(eq(transactionEnvelopes.transactionId, transactionId))
      .limit(1);

    return inserted[0];
  }

  public async updateStatus(
    transactionId: string,
    status: TransactionStatus,
    options?: {
      appliedAt?: Date;
      confirmedAt?: Date;
      failureReason?: string | null;
    },
  ): Promise<void> {
    await this.db
      .update(transactionEnvelopes)
      .set({
        validationState: status,
        appliedAt: options?.appliedAt,
        confirmedAt: options?.confirmedAt,
        failureReason: options?.failureReason,
      })
      .where(eq(transactionEnvelopes.transactionId, transactionId));
  }

  public async listDependencies(transactionId: string): Promise<readonly {
    dependencyEntityType: string;
    dependencyEntityId: string;
    requiredState: string;
  }[]> {
    return this.db
      .select({
        dependencyEntityType: transactionDependencies.dependencyEntityType,
        dependencyEntityId: transactionDependencies.dependencyEntityId,
        requiredState: transactionDependencies.requiredState,
      })
      .from(transactionDependencies)
      .where(eq(transactionDependencies.transactionId, transactionId));
  }

  public async markFailed(transactionId: string, reason: string, failedAt: Date): Promise<void> {
    await this.updateStatus(transactionId, "failed", { failureReason: reason });
    await this.db
      .update(replicationQueue)
      .set({ status: "failed", lastError: reason, updatedAt: failedAt })
      .where(eq(replicationQueue.transactionId, transactionId));
  }

  public async markApplied(transactionId: string, appliedAt: Date): Promise<void> {
    await this.updateStatus(transactionId, "applied", { appliedAt });
    await this.db
      .update(replicationQueue)
      .set({
        status: "pending",
        lastError: null,
        nextAttemptAt: null,
        updatedAt: appliedAt,
      })
      .where(
        and(
          eq(replicationQueue.transactionId, transactionId),
          eq(replicationQueue.status, "awaiting_validation"),
        ),
      );
  }

  public async markAwaitingValidation(transactionId: string, reason: string, blockedAt: Date): Promise<void> {
    await this.updateStatus(transactionId, "awaiting_validation");
    await this.db
      .update(replicationQueue)
      .set({ status: "awaiting_validation", lastError: reason, updatedAt: blockedAt })
      .where(eq(replicationQueue.transactionId, transactionId));
  }

  public async markConfirmed(transactionId: string, confirmedAt: Date): Promise<void> {
    await this.db
      .update(transactionEnvelopes)
      .set({ validationState: "confirmed", confirmedAt })
      .where(
        and(
          eq(transactionEnvelopes.transactionId, transactionId),
          eq(transactionEnvelopes.validationState, "applied"),
        ),
      );
  }

  public async existsTransaction(transactionId: string): Promise<boolean> {
    const rows = await this.db
      .select({ transactionId: transactionEnvelopes.transactionId })
      .from(transactionEnvelopes)
      .where(and(eq(transactionEnvelopes.transactionId, transactionId)))
      .limit(1);

    return rows.length > 0;
  }
}
