import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import type { DcsDb } from "@dcs/db";
import { transactionDependencies, transactionEnvelopes, transactionStatusEnum } from "@dcs/db";

export type TransactionStatus = (typeof transactionStatusEnum.enumValues)[number];

export interface AppendEnvelopeInput {
  readonly idempotencyKey: string;
  readonly eventType: string;
  readonly sourceSystem: "field_client" | "server" | "operator_console";
  readonly originUserId: string;
  readonly originDeviceId: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
  readonly dependencies: readonly {
    entityType: string;
    entityId: string;
    requiredState: string;
  }[];
}

export interface StoredEnvelope {
  readonly transactionId: string;
  readonly idempotencyKey: string;
  readonly eventType: string;
  readonly validationState: TransactionStatus;
  readonly createdAt: Date;
  readonly appliedAt: Date | null;
  readonly confirmedAt: Date | null;
}

export class EventLogRepository {
  public constructor(private readonly db: DcsDb) {}

  public async findByIdempotencyKey(idempotencyKey: string): Promise<StoredEnvelope | null> {
    const rows = await this.db
      .select()
      .from(transactionEnvelopes)
      .where(eq(transactionEnvelopes.idempotencyKey, idempotencyKey))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    return rows[0];
  }

  public async appendEnvelope(input: AppendEnvelopeInput): Promise<StoredEnvelope> {
    const transactionId = randomUUID();

    await this.db.transaction(async (tx) => {
      await tx.insert(transactionEnvelopes).values({
        transactionId,
        idempotencyKey: input.idempotencyKey,
        eventType: input.eventType,
        sourceSystem: input.sourceSystem,
        originUserId: input.originUserId,
        originDeviceId: input.originDeviceId,
        payload: input.payload,
        validationState: "pending",
        createdAt: new Date(input.createdAt),
      });

      if (input.dependencies.length > 0) {
        await tx.insert(transactionDependencies).values(
          input.dependencies.map((dependency) => ({
            transactionId,
            dependencyEntityType: dependency.entityType,
            dependencyEntityId: dependency.entityId,
            requiredState: dependency.requiredState,
          })),
        );
      }
    });

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
    },
  ): Promise<void> {
    await this.db
      .update(transactionEnvelopes)
      .set({
        validationState: status,
        appliedAt: options?.appliedAt,
        confirmedAt: options?.confirmedAt,
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

  public async markFailed(transactionId: string): Promise<void> {
    await this.updateStatus(transactionId, "failed");
  }

  public async markApplied(transactionId: string): Promise<void> {
    const now = new Date();
    await this.updateStatus(transactionId, "applied", { appliedAt: now, confirmedAt: now });
  }

  public async markAwaitingValidation(transactionId: string): Promise<void> {
    await this.updateStatus(transactionId, "awaiting_validation");
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
