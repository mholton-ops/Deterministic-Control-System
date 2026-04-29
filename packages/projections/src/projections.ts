import { eq, sql } from "drizzle-orm";
import type { DcsDb } from "@dcs/db";
import {
  converters,
  hedgePositions,
  invoiceLines,
  invoices,
  ledgerEntries,
  pricingDecisions,
  queues,
  reconciliationCases,
  samples,
  settlementSteps,
  settlements,
} from "@dcs/db";

export interface OperationsOverviewProjection {
  readonly generatedAt: string;
  readonly convertersByState: Record<string, number>;
  readonly queueCount: number;
  readonly openReconciliationCount: number;
  readonly totalEstimatedQueueValueUsd: string;
}

export async function buildOperationsOverviewProjection(
  db: DcsDb,
): Promise<OperationsOverviewProjection> {
  const converterCounts = await db
    .select({ state: converters.state, count: sql<number>`count(*)::int` })
    .from(converters)
    .groupBy(converters.state);

  const queueCountRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(queues);

  const openReconciliationRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reconciliationCases)
    .where(eq(reconciliationCases.status, "open"));

  const totalEstimatedRows = await db
    .select({ total: sql<string>`coalesce(sum(${queues.estimatedValueUsd}), 0)` })
    .from(queues);

  const convertersByState: Record<string, number> = {};
  for (const row of converterCounts) {
    convertersByState[row.state] = row.count;
  }

  return {
    generatedAt: new Date().toISOString(),
    convertersByState,
    queueCount: queueCountRows[0]?.count ?? 0,
    openReconciliationCount: openReconciliationRows[0]?.count ?? 0,
    totalEstimatedQueueValueUsd: totalEstimatedRows[0]?.total ?? "0",
  };
}

export interface QueueExposureProjectionRow {
  readonly queueId: string;
  readonly queueCode: string;
  readonly queueState: string;
  readonly estimatedValueUsd: string | null;
  readonly avgPtPpmCorrected: string;
  readonly avgPdPpmCorrected: string;
  readonly avgRhPpmCorrected: string;
  readonly hedgedPtOz: string;
  readonly hedgedPdOz: string;
  readonly hedgedRhOz: string;
}

export async function buildQueueExposureProjection(
  db: DcsDb,
): Promise<readonly QueueExposureProjectionRow[]> {
  const rows = await db
    .select({
      queueId: queues.queueId,
      queueCode: queues.queueCode,
      queueState: queues.state,
      estimatedValueUsd: queues.estimatedValueUsd,
      avgPtPpmCorrected: sql<string>`coalesce(avg(${samples.ptPpmCorrected}), 0)`,
      avgPdPpmCorrected: sql<string>`coalesce(avg(${samples.pdPpmCorrected}), 0)`,
      avgRhPpmCorrected: sql<string>`coalesce(avg(${samples.rhPpmCorrected}), 0)`,
      hedgedPtOz: sql<string>`coalesce(sum(case when ${hedgePositions.scopeType} = 'queue' then ${hedgePositions.hedgedPtOz} else 0 end), 0)`,
      hedgedPdOz: sql<string>`coalesce(sum(case when ${hedgePositions.scopeType} = 'queue' then ${hedgePositions.hedgedPdOz} else 0 end), 0)`,
      hedgedRhOz: sql<string>`coalesce(sum(case when ${hedgePositions.scopeType} = 'queue' then ${hedgePositions.hedgedRhOz} else 0 end), 0)`,
    })
    .from(queues)
    .leftJoin(samples, eq(samples.queueId, queues.queueId))
    .leftJoin(
      hedgePositions,
      sql`${hedgePositions.scopeType} = 'queue' and ${hedgePositions.scopeId} = (${queues.queueId})::text`,
    )
    .groupBy(queues.queueId, queues.queueCode, queues.state, queues.estimatedValueUsd)
    .orderBy(queues.createdAt);

  return rows;
}

export interface LedgerTraceProjection {
  readonly generatedAt: string;
  readonly entries: readonly {
    ledgerEntryId: string;
    purposeCode: string;
    amountUsd: string;
    sourceOperationalRef: string;
    createdAt: string;
  }[];
}

export async function buildLedgerTraceProjection(
  db: DcsDb,
  sourceOperationalRef?: string,
): Promise<LedgerTraceProjection> {
  const base = db
    .select({
      ledgerEntryId: ledgerEntries.ledgerEntryId,
      purposeCode: ledgerEntries.purposeCode,
      amountUsd: ledgerEntries.amountUsd,
      sourceOperationalRef: ledgerEntries.sourceOperationalRef,
      createdAt: ledgerEntries.createdAt,
    })
    .from(ledgerEntries);

  const rows = sourceOperationalRef
    ? await base.where(eq(ledgerEntries.sourceOperationalRef, sourceOperationalRef))
    : await base;

  return {
    generatedAt: new Date().toISOString(),
    entries: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export interface SettlementDrilldownProjection {
  readonly settlement: {
    settlementId: string;
    status: string;
    estimatedValueUsd: string;
    finalValueUsd: string | null;
    varianceUsd: string | null;
    finalizedAt: string | null;
  };
  readonly steps: readonly {
    stepOrder: number;
    stepName: string;
    recordedAt: string;
  }[];
  readonly invoices: readonly {
    invoiceId: string;
    invoiceNumber: string;
    issuedAt: string;
    lines: readonly {
      sortOrder: number;
      lineType: string;
      description: string;
      amountUsd: string;
    }[];
  }[];
}

export async function buildSettlementDrilldownProjection(
  db: DcsDb,
  settlementId: string,
): Promise<SettlementDrilldownProjection | null> {
  const settlementRows = await db
    .select()
    .from(settlements)
    .where(eq(settlements.settlementId, settlementId))
    .limit(1);

  if (settlementRows.length === 0) {
    return null;
  }

  const stepRows = await db
    .select({
      stepOrder: settlementSteps.stepOrder,
      stepName: settlementSteps.stepName,
      recordedAt: settlementSteps.recordedAt,
    })
    .from(settlementSteps)
    .where(eq(settlementSteps.settlementId, settlementId))
    .orderBy(settlementSteps.stepOrder);

  const invoiceRows = await db
    .select({
      invoiceId: invoices.invoiceId,
      invoiceNumber: invoices.invoiceNumber,
      issuedAt: invoices.issuedAt,
    })
    .from(invoices)
    .where(eq(invoices.settlementId, settlementId));

  const invoicePayload: {
    invoiceId: string;
    invoiceNumber: string;
    issuedAt: string;
    lines: {
      sortOrder: number;
      lineType: string;
      description: string;
      amountUsd: string;
    }[];
  }[] = [];
  for (const invoice of invoiceRows) {
    const lines = await db
      .select({
        sortOrder: invoiceLines.sortOrder,
        lineType: invoiceLines.lineType,
        description: invoiceLines.description,
        amountUsd: invoiceLines.amountUsd,
      })
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoice.invoiceId))
      .orderBy(invoiceLines.sortOrder);

    invoicePayload.push({
      invoiceId: invoice.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      issuedAt: invoice.issuedAt.toISOString(),
      lines,
    });
  }

  return {
    settlement: {
      settlementId: settlementRows[0].settlementId,
      status: settlementRows[0].status,
      estimatedValueUsd: settlementRows[0].estimatedValueUsd,
      finalValueUsd: settlementRows[0].finalValueUsd,
      varianceUsd: settlementRows[0].varianceUsd,
      finalizedAt: settlementRows[0].finalizedAt ? settlementRows[0].finalizedAt.toISOString() : null,
    },
    steps: stepRows.map((step) => ({
      stepOrder: step.stepOrder,
      stepName: step.stepName,
      recordedAt: step.recordedAt.toISOString(),
    })),
    invoices: invoicePayload,
  };
}
