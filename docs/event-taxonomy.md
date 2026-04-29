# Event Taxonomy

This taxonomy separates implemented event types from extension targets.

## Implemented command/event types

### Origination
- `field.capture_converter`

### Custody
- `custody.assign_converter_to_box`
- `custody.lock_queue_for_processing`
- `custody.create_shipment`
- `custody.receive_shipment`

### Grading and Library
- `grading.issue_decision`

### Analytics
- `analytics.record_sample`

### Pricing
- `pricing.resolve_estimate`

### Finance
- `finance.post_ledger_entry`
- `finance.post_additive_correction`

### Hedging
- `hedge.open_position`

### Settlement
- `settlement.append_step`
- `settlement.finalize_from_assay`

### Reconciliation
- `reconciliation.open_case`
- `reconciliation.record_action`
- `reconciliation.close_case`

## Extension targets (not yet implemented)

These remain in-scope for future depth, but are intentionally not represented as active commands yet:
- `field.submit_for_grading`
- `custody.mass_measurement_recorded`
- `grading.override_decision`
- `analytics.compare_estimate_vs_final`
- `hedge.apply_position`
- `hedge.close_position`

## Envelope-level metadata

Every command is written through a transaction envelope carrying:
- transaction id
- idempotency key
- origin tuple (source/user/device)
- dependency references
- payload
- validation status
- application/confirmation timestamps
