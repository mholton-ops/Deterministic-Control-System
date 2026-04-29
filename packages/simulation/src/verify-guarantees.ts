import { eq, sql } from "drizzle-orm";
import {
  converters,
  evidenceArtifacts,
  invoices,
  ledgerEntries,
  projectionLedgerTrace,
  projectionOperationsOverview,
  queues,
  settlements,
  createDb,
  createPool,
} from "@dcs/db";
import { runProjectionWorkerOnce } from "@dcs/projections";

interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

function pass(name: string, detail: string): CheckResult {
  return { name, ok: true, detail };
}

function fail(name: string, detail: string): CheckResult {
  return { name, ok: false, detail };
}

export async function verifyGuarantees(): Promise<void> {
  const pool = createPool();
  const db = createDb(pool);

  const checks: CheckResult[] = [];

  try {
    await runProjectionWorkerOnce(db);

    const orphanLedgerRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ledgerEntries)
      .where(sql`${ledgerEntries.sourceOperationalRef} is null or btrim(${ledgerEntries.sourceOperationalRef}) = ''`);
    checks.push(
      orphanLedgerRows[0].count === 0
        ? pass("no_floating_money_refs", "All ledger entries carry non-empty operational references.")
        : fail("no_floating_money_refs", `${orphanLedgerRows[0].count} ledger entries missing operational refs.`),
    );

    const convertersWithoutImage = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(converters)
      .leftJoin(
        evidenceArtifacts,
        sql`${evidenceArtifacts.evidenceBundleId} = ${converters.evidenceBundleId} and ${evidenceArtifacts.evidenceType} = 'image'`,
      )
      .where(sql`${evidenceArtifacts.artifactId} is null`);
    checks.push(
      convertersWithoutImage[0].count === 0
        ? pass("evidence_backed_converters", "All converters have image evidence artifacts.")
        : fail(
            "evidence_backed_converters",
            `${convertersWithoutImage[0].count} converters do not have image evidence.`,
          ),
    );

    const nonImmutableInvoices = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .where(sql`${invoices.immutable} = false`);
    checks.push(
      nonImmutableInvoices[0].count === 0
        ? pass("immutable_invoices", "All invoice records are immutable=true.")
        : fail("immutable_invoices", `${nonImmutableInvoices[0].count} invoices are mutable.`),
    );

    const projectionOrphans = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectionLedgerTrace)
      .leftJoin(ledgerEntries, eq(projectionLedgerTrace.ledgerEntryId, ledgerEntries.ledgerEntryId))
      .where(sql`${ledgerEntries.ledgerEntryId} is null`);
    checks.push(
      projectionOrphans[0].count === 0
        ? pass("projection_ledger_lineage", "All materialized ledger trace rows map to ledger entries.")
        : fail(
            "projection_ledger_lineage",
            `${projectionOrphans[0].count} materialized ledger trace rows are orphaned.`,
          ),
    );

    const liveQueueCountRows = await db.select({ count: sql<number>`count(*)::int` }).from(queues);
    const materializedRows = await db
      .select({ queueCount: projectionOperationsOverview.queueCount })
      .from(projectionOperationsOverview)
      .where(eq(projectionOperationsOverview.projectionKey, "global"))
      .limit(1);
    const liveQueueCount = liveQueueCountRows[0]?.count ?? 0;
    const matQueueCount = materializedRows[0]?.queueCount ?? -1;
    checks.push(
      matQueueCount === liveQueueCount
        ? pass("materialized_queue_alignment", `Materialized queue count ${matQueueCount} matches live count.`)
        : fail(
            "materialized_queue_alignment",
            `Materialized queue count ${matQueueCount} does not match live count ${liveQueueCount}.`,
          ),
    );

    const finalizedWithoutInvoice = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(settlements)
      .leftJoin(invoices, eq(settlements.settlementId, invoices.settlementId))
      .where(sql`${settlements.status} = 'finalized' and ${invoices.invoiceId} is null`);
    checks.push(
      finalizedWithoutInvoice[0].count === 0
        ? pass("finalized_settlement_has_invoice", "Every finalized settlement has an invoice artifact.")
        : fail(
            "finalized_settlement_has_invoice",
            `${finalizedWithoutInvoice[0].count} finalized settlements are missing invoices.`,
          ),
    );

    for (const check of checks) {
      console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
    }

    const failed = checks.filter((check) => !check.ok);
    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

verifyGuarantees().catch((error) => {
  console.error("Guarantee verification failed:", error);
  process.exit(1);
});
