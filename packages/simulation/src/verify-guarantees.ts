import { eq, sql } from "drizzle-orm";
import {
  replicationQueue,
  replicationReceipts,
  converters,
  custodyEvents,
  evidenceArtifacts,
  gradingDecisions,
  invoices,
  ledgerEntries,
  massMeasurements,
  projectionLedgerTrace,
  projectionOperationsOverview,
  pricingDecisions,
  queues,
  queueBoxes,
  samples,
  settlements,
  transactionEnvelopes,
  createDb,
  createPool,
} from "@dcs/db";
import { and } from "drizzle-orm";
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
    const steadyProjectionRun = await runProjectionWorkerOnce(db);
    checks.push(
      steadyProjectionRun.reason === "up_to_date"
        ? pass("projection_checkpoint_stability", "A second unchanged projection pass is up to date.")
        : fail(
            "projection_checkpoint_stability",
            `An unchanged projection pass reported ${steadyProjectionRun.reason}.`,
          ),
    );

    const bypassedQueueLinks = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(queueBoxes)
      .innerJoin(
        transactionEnvelopes,
        eq(queueBoxes.assignedByTransactionId, transactionEnvelopes.transactionId),
      )
      .where(sql`${transactionEnvelopes.eventType} <> 'custody.assign_box_to_queue'`);
    const bypassedCustodyEvents = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(custodyEvents)
      .innerJoin(
        transactionEnvelopes,
        eq(custodyEvents.transactionId, transactionEnvelopes.transactionId),
      )
      .where(sql`${transactionEnvelopes.eventType} <> 'custody.record_event'`);
    const bypassedMassMeasurements = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(massMeasurements)
      .innerJoin(
        transactionEnvelopes,
        eq(massMeasurements.transactionId, transactionEnvelopes.transactionId),
      )
      .where(sql`${transactionEnvelopes.eventType} <> 'custody.record_mass_measurement'`);
    const bypassedGradingDecisions = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(gradingDecisions)
      .innerJoin(
        transactionEnvelopes,
        eq(gradingDecisions.transactionId, transactionEnvelopes.transactionId),
      )
      .where(sql`${transactionEnvelopes.eventType} <> 'grading.issue_decision'`);
    const bypassedSamples = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(samples)
      .innerJoin(transactionEnvelopes, eq(samples.transactionId, transactionEnvelopes.transactionId))
      .where(sql`${transactionEnvelopes.eventType} <> 'analytics.record_sample'`);
    const bypassedPricingDecisions = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(pricingDecisions)
      .innerJoin(
        transactionEnvelopes,
        eq(pricingDecisions.transactionId, transactionEnvelopes.transactionId),
      )
      .where(sql`${transactionEnvelopes.eventType} <> 'pricing.resolve_estimate'`);
    const bypassedControlWrites =
      bypassedQueueLinks[0].count +
      bypassedCustodyEvents[0].count +
      bypassedMassMeasurements[0].count +
      bypassedGradingDecisions[0].count +
      bypassedSamples[0].count +
      bypassedPricingDecisions[0].count;
    checks.push(
      bypassedControlWrites === 0
        ? pass(
            "critical_transaction_spine",
            "Custody, mass, grading, sample, and pricing facts use their expected typed commands.",
          )
        : fail(
            "critical_transaction_spine",
            `${bypassedControlWrites} critical facts bypass the expected command envelope.`,
          ),
    );

    const custodyStateLineageViolations = await db.execute(sql`
      select count(*)::int as count
      from (
        select c.converter_id::text as control_id
        from converters c
        join transaction_envelopes te on te.transaction_id = c.last_transition_transaction_id
        where (c.state in ('captured', 'boxed') and te.event_type not in ('field.capture_converter', 'custody.assign_converter_to_box'))
          or (c.state = 'queued' and te.event_type <> 'custody.assign_box_to_queue')
          or (c.state = 'in_transit' and te.event_type <> 'custody.create_shipment')
          or (c.state = 'received' and te.event_type <> 'custody.receive_shipment')
          or (c.state = 'processing' and te.event_type <> 'custody.lock_queue_for_processing')
          or (c.state = 'sampled' and te.event_type <> 'analytics.record_sample')
          or (c.state = 'settled' and te.event_type <> 'settlement.finalize_from_assay')
        union all
        select b.box_id::text
        from boxes b
        join transaction_envelopes te on te.transaction_id = b.last_transition_transaction_id
        where (b.state = 'active' and te.event_type not in ('field.capture_converter', 'custody.assign_converter_to_box'))
          or (b.state = 'closed' and te.event_type <> 'custody.close_box')
          or (b.state = 'shipped' and te.event_type <> 'custody.create_shipment')
          or (b.state = 'received' and te.event_type <> 'custody.receive_shipment')
          or b.state in ('empty', 'retired')
        union all
        select q.queue_id::text
        from queues q
        join transaction_envelopes created on created.transaction_id = q.created_by_transaction_id
        join transaction_envelopes transitioned on transitioned.transaction_id = q.last_transition_transaction_id
        where created.event_type <> 'custody.assign_box_to_queue'
          or (q.state = 'open' and transitioned.event_type <> 'custody.assign_box_to_queue')
          or (q.state = 'processing' and transitioned.event_type not in ('custody.lock_queue_for_processing', 'pricing.resolve_estimate'))
          or (q.state in ('sampled', 'assay_pending') and transitioned.event_type not in ('analytics.record_sample', 'pricing.resolve_estimate'))
          or (q.state = 'valued' and transitioned.event_type <> 'pricing.resolve_estimate')
          or (q.state = 'settled' and transitioned.event_type <> 'settlement.finalize_from_assay')
        union all
        select s.shipment_id::text
        from shipments s
        join transaction_envelopes created on created.transaction_id = s.created_by_transaction_id
        join transaction_envelopes transitioned on transitioned.transaction_id = s.last_transition_transaction_id
        where created.event_type <> 'custody.create_shipment'
          or (s.state = 'in_transit' and transitioned.event_type <> 'custody.create_shipment')
          or (s.state = 'received' and transitioned.event_type <> 'custody.receive_shipment')
          or s.state in ('prepared', 'discrepant', 'closed')
        union all
        select sb.shipment_id::text || ':' || sb.box_id::text
        from shipment_boxes sb
        join transaction_envelopes te on te.transaction_id = sb.assigned_by_transaction_id
        where te.event_type <> 'custody.create_shipment'
      ) violations
    `);
    const custodyStateLineageViolationCount = Number(
      (custodyStateLineageViolations.rows[0] as { count?: number | string } | undefined)?.count ?? 0,
    );
    checks.push(
      custodyStateLineageViolationCount === 0
        ? pass(
            "custody_current_state_lineage",
            "Converter, box, queue, shipment, and shipment-membership state retain their controlling commands.",
          )
        : fail(
            "custody_current_state_lineage",
            `${custodyStateLineageViolationCount} custody aggregates have invalid current-state command lineage.`,
          ),
    );

    const financialLineageViolations = await db.execute(sql`
      select count(*)::int as count
      from (
        select hp.hedge_position_id::text as control_id
        from hedge_positions hp
        join transaction_envelopes te on te.transaction_id = hp.transaction_id
        where te.event_type <> 'hedge.open_position'
        union all
        select s.settlement_id::text
        from settlements s
        join transaction_envelopes te on te.transaction_id = s.created_by_transaction_id
        where te.event_type <> 'settlement.append_step'
        union all
        select s.settlement_id::text
        from settlements s
        left join transaction_envelopes te on te.transaction_id = s.finalized_by_transaction_id
        where s.status = 'finalized' and te.event_type is distinct from 'settlement.finalize_from_assay'
        union all
        select ss.settlement_step_id::text
        from settlement_steps ss
        join transaction_envelopes te on te.transaction_id = ss.transaction_id
        where te.event_type <> case
          when ss.step_name in ('final_value_calculated', 'invoice_finalized')
            then 'settlement.finalize_from_assay'
          else 'settlement.append_step'
        end
        union all
        select i.invoice_id::text
        from invoices i
        join transaction_envelopes te on te.transaction_id = i.transaction_id
        where te.event_type <> 'settlement.finalize_from_assay'
        union all
        select rc.reconciliation_case_id::text
        from reconciliation_cases rc
        join transaction_envelopes opened on opened.transaction_id = rc.opened_by_transaction_id
        left join transaction_envelopes transitioned on transitioned.transaction_id = rc.last_transition_transaction_id
        where opened.event_type <> 'reconciliation.open_case'
          or (rc.status = 'open' and rc.last_transition_transaction_id <> rc.opened_by_transaction_id)
          or (
            rc.status = 'investigating'
            and transitioned.event_type not in ('reconciliation.record_action', 'finance.post_additive_correction')
          )
          or (
            rc.status in ('resolved', 'accepted_variance')
            and (
              rc.closed_by_transaction_id is distinct from rc.last_transition_transaction_id
              or transitioned.event_type is distinct from 'reconciliation.close_case'
            )
          )
        union all
        select ra.reconciliation_action_id::text
        from reconciliation_actions ra
        join transaction_envelopes te on te.transaction_id = ra.transaction_id
        where te.event_type not in ('reconciliation.record_action', 'finance.post_additive_correction')
      ) violations
    `);
    const financialLineageViolationCount = Number(
      (financialLineageViolations.rows[0] as { count?: number | string } | undefined)?.count ?? 0,
    );
    checks.push(
      financialLineageViolationCount === 0
        ? pass(
            "financial_control_lineage",
            "Hedge, settlement, invoice, and reconciliation facts retain their expected source commands.",
          )
        : fail(
            "financial_control_lineage",
            `${financialLineageViolationCount} financial or correction facts have invalid command lineage.`,
          ),
    );

    const samplesWithoutEvidence = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(samples)
      .leftJoin(
        evidenceArtifacts,
        and(
          eq(samples.evidenceBundleId, evidenceArtifacts.evidenceBundleId),
          eq(evidenceArtifacts.evidenceType, "note"),
        ),
      )
      .where(sql`${evidenceArtifacts.artifactId} is null`);
    checks.push(
      samplesWithoutEvidence[0].count === 0
        ? pass("evidence_backed_samples", "Every analytical sample has note evidence provenance.")
        : fail(
            "evidence_backed_samples",
            `${samplesWithoutEvidence[0].count} analytical samples are missing note evidence.`,
          ),
    );

    const acceptedWithoutRecordOutbox = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(transactionEnvelopes)
      .leftJoin(
        replicationQueue,
        and(
          eq(transactionEnvelopes.transactionId, replicationQueue.transactionId),
          eq(replicationQueue.streamType, "record"),
        ),
      )
      .where(
        sql`${transactionEnvelopes.validationState} in ('applied', 'confirmed') and ${replicationQueue.replicationQueueId} is null`,
      );
    checks.push(
      acceptedWithoutRecordOutbox[0].count === 0
        ? pass("accepted_history_has_outbox", "Every applied transaction has a record-stream outbox row.")
        : fail(
            "accepted_history_has_outbox",
            `${acceptedWithoutRecordOutbox[0].count} applied transactions are missing record-stream outbox rows.`,
          ),
    );

    const confirmedWithoutReceipt = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(replicationQueue)
      .leftJoin(
        replicationReceipts,
        and(
          eq(replicationQueue.transactionId, replicationReceipts.transactionId),
          eq(replicationQueue.targetNode, replicationReceipts.targetNode),
          eq(replicationQueue.streamType, replicationReceipts.streamType),
        ),
      )
      .where(
        sql`${replicationQueue.status} = 'confirmed' and ${replicationReceipts.replicationReceiptId} is null`,
      );
    checks.push(
      confirmedWithoutReceipt[0].count === 0
        ? pass("confirmed_replication_has_receipt", "Every confirmed stream has an idempotency receipt.")
        : fail(
            "confirmed_replication_has_receipt",
            `${confirmedWithoutReceipt[0].count} confirmed streams are missing receipts.`,
          ),
    );

    const receiptChecksumMismatch = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(replicationReceipts)
      .innerJoin(
        replicationQueue,
        and(
          eq(replicationReceipts.transactionId, replicationQueue.transactionId),
          eq(replicationReceipts.targetNode, replicationQueue.targetNode),
          eq(replicationReceipts.streamType, replicationQueue.streamType),
        ),
      )
      .where(sql`${replicationReceipts.payloadChecksum} <> ${replicationQueue.payloadChecksum}`);
    checks.push(
      receiptChecksumMismatch[0].count === 0
        ? pass("replication_checksum_alignment", "Receiver receipts match the transmitted payload checksum.")
        : fail(
            "replication_checksum_alignment",
            `${receiptChecksumMismatch[0].count} receiver receipts have mismatched checksums.`,
          ),
    );

    const unhashedEvidence = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(evidenceArtifacts)
      .where(sql`${evidenceArtifacts.sha256} is null or length(${evidenceArtifacts.sha256}) <> 64`);
    checks.push(
      unhashedEvidence[0].count === 0
        ? pass("evidence_content_hashes", "Every evidence artifact carries a SHA-256 content reference.")
        : fail(
            "evidence_content_hashes",
            `${unhashedEvidence[0].count} evidence artifacts are missing valid SHA-256 references.`,
          ),
    );

    const fundingControlViolations = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ledgerEntries)
      .where(
        sql`${ledgerEntries.purposeCode} = 'funding_advance' and (${ledgerEntries.approvedByUserId} is null or ${ledgerEntries.approvedByUserId} = ${ledgerEntries.executedByUserId})`,
      );
    checks.push(
      fundingControlViolations[0].count === 0
        ? pass("funding_separation_of_duty", "Funding advances have distinct approving and executing actors.")
        : fail(
            "funding_separation_of_duty",
            `${fundingControlViolations[0].count} funding advances violate approval separation.`,
          ),
    );

    const finalizedSequenceViolations = await db.execute(sql`
      select count(*)::int as count
      from settlements s
      where s.status = 'finalized'
        and not exists (
          select 1
          from (
            select array_agg(ss.step_name::text order by ss.step_order) as steps
            from settlement_steps ss
            where ss.settlement_id = s.settlement_id
          ) ordered
          where ordered.steps = array[
            'lot_selected',
            'contents_reviewed',
            'sample_data_recorded',
            'adjustments_recorded',
            'weight_basis_locked',
            'hedges_applied',
            'financial_context_applied',
            'final_value_calculated',
            'invoice_finalized'
          ]::text[]
        )
    `);
    const finalizedSequenceViolationCount = Number(
      (finalizedSequenceViolations.rows[0] as { count?: number | string } | undefined)?.count ?? 0,
    );
    checks.push(
      finalizedSequenceViolationCount === 0
        ? pass("finalized_settlement_sequence", "Finalized settlements contain the exact controlled step sequence.")
        : fail(
            "finalized_settlement_sequence",
            `${finalizedSequenceViolationCount} finalized settlements have incomplete or reordered controls.`,
          ),
    );

    const finalizedQueueViolations = await db.execute(sql`
      select count(*)::int as count
      from settlements s
      left join queues q
        on q.queue_code = s.scope_id
        or q.queue_id::text = s.scope_id
      where s.status = 'finalized'
        and (q.queue_id is null or q.state <> 'settled')
    `);
    const finalizedQueueViolationCount = Number(
      (finalizedQueueViolations.rows[0] as { count?: number | string } | undefined)?.count ?? 0,
    );
    checks.push(
      finalizedQueueViolationCount === 0
        ? pass("finalized_queue_state", "Every finalized settlement closes its linked queue state.")
        : fail(
            "finalized_queue_state",
            `${finalizedQueueViolationCount} finalized settlements have an open or missing queue.`,
          ),
    );

    const inTransitSampleViolations = await db.execute(sql`
      select count(distinct s.sample_id)::int as count
      from samples s
      join queue_boxes qb on qb.queue_id = s.queue_id
      join shipment_boxes sb on sb.box_id = qb.box_id
      join shipments sh on sh.shipment_id = sb.shipment_id
      where sh.state = 'in_transit'
    `);
    const inTransitSampleViolationCount = Number(
      (inTransitSampleViolations.rows[0] as { count?: number | string } | undefined)?.count ?? 0,
    );
    checks.push(
      inTransitSampleViolationCount === 0
        ? pass("sample_custody_availability", "No analytical sample is linked to material still in transit.")
        : fail(
            "sample_custody_availability",
            `${inTransitSampleViolationCount} samples are linked to in-transit material.`,
          ),
    );

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
