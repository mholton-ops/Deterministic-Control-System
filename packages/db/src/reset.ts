import { sql } from "drizzle-orm";

import { createDb, createPool } from "./index";

export async function resetDemoData(): Promise<void> {
  const pool = createPool();
  const db = createDb(pool);

  try {
    await db.execute(sql`
      TRUNCATE TABLE
        reconciliation_actions,
        reconciliation_cases,
        invoice_lines,
        invoices,
        settlement_steps,
        settlements,
        hedge_applications,
        hedge_positions,
        ledger_corrections,
        ledger_entries,
        accounts,
        pricing_decisions,
        terms_profiles,
        market_snapshots,
        samples,
        correction_matrices,
        grading_decisions,
        library_entries,
        mass_measurements,
        custody_events,
        shipment_boxes,
        shipments,
        queue_boxes,
        queues,
        box_converters,
        boxes,
        converters,
        replication_queue,
        transaction_dependencies,
        transaction_envelopes,
        evidence_artifacts,
        evidence_bundles,
        devices,
        users,
        sites
      RESTART IDENTITY CASCADE;
    `);

    console.log("Demo data reset complete.");
  } finally {
    await pool.end();
  }
}

resetDemoData().catch((error) => {
  console.error("Reset failed:", error);
  process.exit(1);
});
