# Domain Model (Phase 1 Baseline)

## Modeling posture

The model prioritizes:
- explicit lifecycle state
- immutable history
- provenance and evidence as first-class fields
- operational and financial chain continuity

## Core entities

### Converter
Atomic origin unit captured in field.

Key fields:
- converter_id
- origin_event_id
- capture_timestamp
- capture_location
- captured_by_user_id
- captured_by_device_id
- identification_state
- grading_state
- current_box_id
- evidence_bundle_id

### Box
First custody boundary and grouping container.

Key fields:
- box_id (globally unique)
- material_type
- state (`empty`, `active`, `closed`, `shipped`, `received`)
- created_at
- created_by

### Queue
Continuity group through transformation and settlement.

Key fields:
- queue_id
- queue_state (`open`, `processing`, `sampled`, `assay_pending`, `settled`)
- estimated_value
- estimated_pgm_content
- hedge_state

### Shipment
Material-in-transit unit tying custody transfer boundaries.

Key fields:
- shipment_id
- state (`prepared`, `in_transit`, `received`, `discrepant`, `closed`)
- origin_site_id
- destination_site_id

### LibraryEntry (Smart Library)
Qualified knowledge object for converter identification and value inference.

Key fields:
- library_entry_id
- confidence_level
- identity_signatures (VIN/serial/morphology)
- historical_assay_profile
- qualification_status

### Sample
Analytical sample linked to queue and capture point.

Key fields:
- sample_id
- queue_id
- sample_point
- raw_readings
- corrected_readings
- correction_matrix_id
- source_type (`internal_xrf`, `external_xrf`, `icp`)

### PricingDecision
Controlled pricing resolution result.

Key fields:
- pricing_decision_id
- source_hierarchy_level
- market_snapshot_id
- terms_profile_id
- estimate_amount
- confidence_band

### LedgerEntry
Immutable financial movement record.

Key fields:
- ledger_entry_id
- debit_account_id
- credit_account_id
- amount
- currency
- purpose_code
- source_operational_ref
- evidence_bundle_id

### HedgePosition
Exposure management artifact.

Key fields:
- hedge_position_id
- hedge_layer (`internal`, `external`)
- instrument_type
- associated_scope_type (`queue`, `lot`, `group`)
- associated_scope_id
- hedged_quantity
- hedged_price
- status

### Settlement
Finalized valuation closure artifact.

Key fields:
- settlement_id
- scope_type (`lot`, `queue`)
- scope_id
- estimated_value_total
- final_value_total
- variance_total
- final_invoice_id
- finalized_at

### EvidenceBundle
Required proof metadata attached to critical transitions.

Key fields:
- evidence_bundle_id
- image_refs
- note_refs
- gps_ref
- capture_context_ref

### ReconciliationCase
Structured divergence handling unit.

Key fields:
- reconciliation_case_id
- trigger_type
- related_scope
- severity
- status (`open`, `investigating`, `resolved`, `accepted_variance`)
- resolution_entry_ref

## Value objects

- `OriginRef`: `{source_system, user_id, device_id, captured_at}`
- `GeoPoint`: `{lat, lon, accuracy_m}`
- `MassBalance`: `{input_weight, output_weight, explained_loss, delta}`
- `Money`: `{amount, currency}`
- `PriceConfidence`: `{band, rationale}`
- `DependencyRef`: `{entity_type, entity_id, required_state}`
- `EvidenceRef`: `{bundle_id, required_types_present}`
- `CorrectionRef`: `{correction_event_id, reason_code}`

## Certainty model (truth cannot be implied)

Every critical operational/financial representation is assessed with a certainty envelope:
- `truth_status`: `estimated | provisional | validated | finalized`
- `confidence`: `high | medium | low | unknown`
- `validation_status`: explicit reason (for example `awaiting_assay`, `origin_verified`, `invoice_immutable`)
- `dependency_state`: `complete | incomplete`
- `trace_link`: `{entity_type, entity_id}` for deterministic drill-back

The certainty envelope is intentionally separate from raw state labels.
State answers "where it is"; certainty answers "how much can we trust it and why."

## Lifecycle/state machines

### Converter lifecycle
`captured -> graded -> boxed -> queued -> transformed -> sampled -> settled`

Rules:
- cannot leave `captured` without required evidence
- cannot enter `boxed` without active box
- cannot enter `settled` without queue settlement closure

### Box lifecycle
`empty -> active -> closed -> shipped -> received -> retired`

Rules:
- only `active` boxes accept converters
- `closed` required before shipment assignment
- custody scans required at shipment and receipt boundaries

### Queue lifecycle
`open -> processing -> sampled -> assay_pending -> valued -> settled`

Rules:
- queue membership is append-only until processing lock
- no split after processing lock
- hedge application must occur before settlement finalization

### Settlement lifecycle
`draft -> validated -> finalized`

Rules:
- sequence enforced: lot contents, sample data, adjustments, reconciliation basis, hedge application, financial context, value calc, invoice finalization
- finalized settlement is immutable; corrections require additive adjustment artifacts

## Event/history model

History is append-only and represented by transaction envelopes.

Example event families:
- `field.converter_captured`
- `custody.box_created`
- `custody.converter_boxed`
- `custody.queue_locked`
- `analytics.sample_recorded`
- `analytics.reading_corrected`
- `pricing.decision_issued`
- `finance.ledger_entry_posted`
- `hedge.position_opened`
- `settlement.finalized`
- `reconciliation.case_opened`
- `reconciliation.adjustment_posted`

## Relationship boundaries

- Field capture can create origination facts, not final valuation.
- Pricing decisions originate only from grading/pricing context.
- Financial entries must reference operational source objects.
- Settlement consumes analytical and financial context; it does not mutate historical source facts.
- Reconciliation can append corrective financial/operational events; it cannot overwrite origin events.

## Validation rules (baseline)

1. Critical operational transitions require evidence bundle presence.
2. Dependency references must exist and satisfy required state before apply.
3. Idempotency key uniqueness enforced per transaction envelope.
4. Financial posting requires valid account pairing + purpose code + source reference.
5. Settlement finalization requires completed sequence and locked valuation basis.
6. Every read model row must link to at least one source transaction id.
7. Critical rows must expose a trace link so operators can navigate to chain proof.
8. Estimated values must never be presented as finalized truth without assay/finalization proof.

## Glossary

- **Truth at origin**: capture at time of occurrence, not later reconstruction.
- **Queue continuity**: preserved grouping through transformation for reconciliation.
- **Estimated truth**: best currently available valuation prior to assay finalization.
- **Finalized truth**: post-assay, reconciled, settlement-closed valuation.
- **Additive correction**: new entries/events that adjust prior outcomes without deleting history.
- **Need hedged**: remaining unhedged exposure associated with material scope.
- **No floating money**: no financial state disconnected from operational origin and purpose.
