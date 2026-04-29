import { desc, eq } from "drizzle-orm";
import type { DcsDb } from "@dcs/db";
import {
  projectionLedgerTrace,
  projectionOperationsOverview,
  projectionQueueExposure,
  projectionSettlementDrilldownCache,
  projectionWorkbenchViewCache,
  settlements,
} from "@dcs/db";

import {
  buildLedgerTraceProjection,
  buildOperationsOverviewProjection,
  buildQueueExposureProjection,
  buildSettlementDrilldownProjection,
  type LedgerTraceProjection,
  type OperationsOverviewProjection,
  type QueueExposureProjectionRow,
  type SettlementDrilldownProjection,
} from "./projections";
import {
  buildAnalyticsWorkbenchProjection,
  buildCustodyProjection,
  buildEvidenceExplorerProjection,
  buildFieldIntakeProjection,
  buildGradingWorkbenchProjection,
  buildPricingExposureWorkbenchProjection,
  buildReconciliationWorkbenchProjection,
  buildSettlementListProjection,
  buildTransactionHistoryProjection,
} from "./workbench";

export type WorkbenchProjectionKey =
  | "intake"
  | "custody"
  | "grading"
  | "analytics"
  | "pricing_exposure"
  | "reconciliation"
  | "settlements"
  | "evidence"
  | "transactions";

export interface RebuildProjectionSummary {
  readonly generatedAt: string;
  readonly operationsOverviewUpdated: boolean;
  readonly queueExposureRows: number;
  readonly ledgerTraceRows: number;
  readonly workbenchViewsUpdated: number;
  readonly settlementDrilldownRows: number;
}

export async function rebuildMaterializedProjections(db: DcsDb): Promise<RebuildProjectionSummary> {
  const generatedAt = new Date();

  const overview = await buildOperationsOverviewProjection(db);
  const queueExposure = await buildQueueExposureProjection(db);
  const ledger = await buildLedgerTraceProjection(db);

  const intake = await buildFieldIntakeProjection(db);
  const custody = await buildCustodyProjection(db);
  const grading = await buildGradingWorkbenchProjection(db);
  const analytics = await buildAnalyticsWorkbenchProjection(db);
  const pricingExposure = await buildPricingExposureWorkbenchProjection(db);
  const reconciliation = await buildReconciliationWorkbenchProjection(db);
  const settlementList = await buildSettlementListProjection(db);
  const evidence = await buildEvidenceExplorerProjection(db);
  const transactions = await buildTransactionHistoryProjection(db, 500);

  const settlementRows = await db
    .select({ settlementId: settlements.settlementId })
    .from(settlements)
    .orderBy(desc(settlements.createdAt));
  const settlementDrilldowns: Array<{ settlementId: string; payload: SettlementDrilldownProjection }> =
    [];
  for (const row of settlementRows) {
    const projection = await buildSettlementDrilldownProjection(db, row.settlementId);
    if (projection) {
      settlementDrilldowns.push({ settlementId: row.settlementId, payload: projection });
    }
  }

  const workbenchPayloads: Array<{ key: WorkbenchProjectionKey; payload: unknown }> = [
    { key: "intake", payload: intake },
    { key: "custody", payload: custody },
    { key: "grading", payload: grading },
    { key: "analytics", payload: analytics },
    { key: "pricing_exposure", payload: pricingExposure },
    { key: "reconciliation", payload: reconciliation },
    { key: "settlements", payload: settlementList },
    { key: "evidence", payload: evidence },
    { key: "transactions", payload: transactions },
  ];

  await db.transaction(async (tx) => {
    await tx
      .insert(projectionOperationsOverview)
      .values({
        projectionKey: "global",
        generatedAt,
        queueCount: overview.queueCount,
        openReconciliationCount: overview.openReconciliationCount,
        totalEstimatedQueueValueUsd: overview.totalEstimatedQueueValueUsd,
        convertersByState: overview.convertersByState,
      })
      .onConflictDoUpdate({
        target: projectionOperationsOverview.projectionKey,
        set: {
          generatedAt,
          queueCount: overview.queueCount,
          openReconciliationCount: overview.openReconciliationCount,
          totalEstimatedQueueValueUsd: overview.totalEstimatedQueueValueUsd,
          convertersByState: overview.convertersByState,
        },
      });

    await tx.delete(projectionQueueExposure);
    if (queueExposure.length > 0) {
      await tx.insert(projectionQueueExposure).values(
        queueExposure.map((row) => ({
          queueId: row.queueId,
          queueCode: row.queueCode,
          queueState: row.queueState as "open" | "processing" | "sampled" | "assay_pending" | "valued" | "settled",
          estimatedValueUsd: row.estimatedValueUsd,
          avgPtPpmCorrected: row.avgPtPpmCorrected,
          avgPdPpmCorrected: row.avgPdPpmCorrected,
          avgRhPpmCorrected: row.avgRhPpmCorrected,
          hedgedPtOz: row.hedgedPtOz,
          hedgedPdOz: row.hedgedPdOz,
          hedgedRhOz: row.hedgedRhOz,
          generatedAt,
        })),
      );
    }

    await tx.delete(projectionLedgerTrace);
    if (ledger.entries.length > 0) {
      await tx.insert(projectionLedgerTrace).values(
        ledger.entries.map((entry) => ({
          ledgerEntryId: entry.ledgerEntryId,
          purposeCode: entry.purposeCode as
            | "funding_advance"
            | "field_purchase"
            | "deposit"
            | "settlement_payout"
            | "adjustment"
            | "wire",
          amountUsd: entry.amountUsd,
          sourceOperationalRef: entry.sourceOperationalRef,
          createdAt: new Date(entry.createdAt),
          generatedAt,
        })),
      );
    }

    for (const view of workbenchPayloads) {
      await tx
        .insert(projectionWorkbenchViewCache)
        .values({
          projectionKey: view.key,
          payload: view.payload,
          generatedAt,
        })
        .onConflictDoUpdate({
          target: projectionWorkbenchViewCache.projectionKey,
          set: {
            payload: view.payload,
            generatedAt,
          },
        });
    }

    await tx.delete(projectionSettlementDrilldownCache);
    if (settlementDrilldowns.length > 0) {
      await tx.insert(projectionSettlementDrilldownCache).values(
        settlementDrilldowns.map((row) => ({
          settlementId: row.settlementId,
          payload: row.payload,
          generatedAt,
        })),
      );
    }
  });

  return {
    generatedAt: generatedAt.toISOString(),
    operationsOverviewUpdated: true,
    queueExposureRows: queueExposure.length,
    ledgerTraceRows: ledger.entries.length,
    workbenchViewsUpdated: workbenchPayloads.length,
    settlementDrilldownRows: settlementDrilldowns.length,
  };
}

export async function getMaterializedOperationsOverview(
  db: DcsDb,
): Promise<OperationsOverviewProjection | null> {
  const rows = await db
    .select()
    .from(projectionOperationsOverview)
    .where(eq(projectionOperationsOverview.projectionKey, "global"))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  return {
    generatedAt: rows[0].generatedAt.toISOString(),
    convertersByState: rows[0].convertersByState,
    queueCount: rows[0].queueCount,
    openReconciliationCount: rows[0].openReconciliationCount,
    totalEstimatedQueueValueUsd: rows[0].totalEstimatedQueueValueUsd,
  };
}

export async function getMaterializedQueueExposure(
  db: DcsDb,
): Promise<readonly QueueExposureProjectionRow[]> {
  const rows = await db.select().from(projectionQueueExposure).orderBy(projectionQueueExposure.queueCode);

  return rows.map((row) => ({
    queueId: row.queueId,
    queueCode: row.queueCode,
    queueState: row.queueState,
    estimatedValueUsd: row.estimatedValueUsd,
    avgPtPpmCorrected: row.avgPtPpmCorrected,
    avgPdPpmCorrected: row.avgPdPpmCorrected,
    avgRhPpmCorrected: row.avgRhPpmCorrected,
    hedgedPtOz: row.hedgedPtOz,
    hedgedPdOz: row.hedgedPdOz,
    hedgedRhOz: row.hedgedRhOz,
  }));
}

export async function getMaterializedLedgerTrace(
  db: DcsDb,
  sourceOperationalRef?: string,
): Promise<LedgerTraceProjection> {
  const query = db
    .select()
    .from(projectionLedgerTrace)
    .orderBy(desc(projectionLedgerTrace.createdAt));

  const rows = sourceOperationalRef
    ? await query.where(eq(projectionLedgerTrace.sourceOperationalRef, sourceOperationalRef))
    : await query;

  return {
    generatedAt: new Date().toISOString(),
    entries: rows.map((row) => ({
      ledgerEntryId: row.ledgerEntryId,
      purposeCode: row.purposeCode,
      amountUsd: row.amountUsd,
      sourceOperationalRef: row.sourceOperationalRef,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export async function getMaterializedWorkbenchProjection<T>(
  db: DcsDb,
  key: WorkbenchProjectionKey,
): Promise<T | null> {
  const rows = await db
    .select()
    .from(projectionWorkbenchViewCache)
    .where(eq(projectionWorkbenchViewCache.projectionKey, key))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  return rows[0].payload as T;
}

export async function getMaterializedSettlementDrilldownProjection(
  db: DcsDb,
  settlementId: string,
): Promise<SettlementDrilldownProjection | null> {
  const rows = await db
    .select()
    .from(projectionSettlementDrilldownCache)
    .where(eq(projectionSettlementDrilldownCache.settlementId, settlementId))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }

  return rows[0].payload as SettlementDrilldownProjection;
}
