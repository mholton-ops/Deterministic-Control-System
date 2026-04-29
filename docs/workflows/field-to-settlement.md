# Workflow: Field to Settlement

This is the deterministic demo path implemented in the reference repository.

## Step 1: Field capture (truth at origin)

Command:
- `field.capture_converter`

Required controls:
- structured capture payload
- image and GPS evidence presence
- origin identity (user + device)
- capture time/location provenance

State impact:
- converter created
- evidence bundle/artifacts linked
- converter assigned to custody box boundary

## Step 2: Queue control (processing lock)

Command:
- `custody.lock_queue_for_processing`

Required controls:
- explicit queue identity
- lock transition enforced through state machine guard

State impact:
- queue transitions to processing
- continuity grouping becomes operationally constrained

## Step 3: Custody transfer in transit

Commands:
- `custody.create_shipment`
- `custody.receive_shipment`

Required controls:
- origin/destination sites
- explicit box membership in shipment
- receive-site validation against shipment destination

State impact:
- boxes and converters transition `in_transit -> received`
- shipment artifact anchors custody boundary transition

## Step 4: Analytical estimate

Command:
- `analytics.record_sample`

Required controls:
- queue-linked sample
- queue custody must be milled material form (sampling rejects whole/unmilled queue contents)
- raw and corrected readings
- optional qualified correction matrix reference

State impact:
- sample rows attached to queue
- analytical basis for value estimation becomes explicit

## Step 5: Pricing resolution

Command:
- `pricing.resolve_estimate`

Required controls:
- market snapshot reference
- terms profile reference
- source hierarchy enforcement
- no uncontrolled field override path

State impact:
- queue estimated value updated
- pricing decision recorded with confidence context

## Step 6: Financial movement tied to operations

Command:
- `finance.post_ledger_entry`

Required controls:
- debit/credit account pairing
- purpose code
- source operational reference
- note evidence requirement

State impact:
- immutable ledger entry created
- financial state tied to queue context (`sourceOperationalRef`)

## Step 7: Hedge/exposure linkage

Command:
- `hedge.open_position`

Required controls:
- layer (`internal` or `external`)
- explicit operational scope link (`queue`, `lot`, `material_group`)

State impact:
- open hedge position contributes to queue-level exposure view

## Step 8: Divergence surfaced early

Command:
- `reconciliation.open_case`
- `reconciliation.record_action`
- `finance.post_additive_correction`

Required controls:
- trigger type
- severity
- related operational scope

State impact:
- divergence case opened and visible before finalization closes uncertainty
- investigation actions are logged additively on the case
- financial variance can be corrected through additive ledger correction linked to target entry

## Step 9: Final truth transition

Command:
- `settlement.finalize_from_assay`

Required controls:
- strict settlement sequence completion (auto-appended if missing)
- final value input
- variance calculation against estimate
- immutable invoice artifact generation

State impact:
- settlement finalized
- estimated vs final variance recorded
- final payout artifact available for drill-back

## Step 10: Audit and reconstructability

Queryable paths:
- `/workbench/transactions`
- `/workbench/evidence`
- `/projections/settlement/:settlementId`
- `/projections/ledger-trace?sourceOperationalRef=<scope>`

Outcome:
- each critical transition has provenance
- evidence is linked and queryable
- operations and finance remain bound through scope references
