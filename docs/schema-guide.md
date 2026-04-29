# Schema Guide (Drizzle / PostgreSQL)

Primary implementation file:
- `packages/db/src/schema.ts`

## Design goals encoded in schema

- append-only transaction history with explicit status
- provenance and evidence modeled as first-class records
- custody continuity through converter/box/queue/shipment links
- analytical, pricing, finance, hedge, and settlement linkage
- reconciliation modeled as lifecycle records with action trail

## Core table groups

### Origin and provenance
- `users`
- `devices`
- `sites`

### Evidence
- `evidence_bundles`
- `evidence_artifacts`

### Transaction and replication spine
- `transaction_envelopes`
- `transaction_dependencies`
- `replication_queue`

### Custody and transformation continuity
- `converters`
- `boxes`
- `box_converters`
- `queues`
- `queue_boxes`
- `shipments`
- `shipment_boxes`
- `custody_events`
- `mass_measurements`

### Grading and smart library
- `library_entries`
- `grading_decisions`

### Analytical layer
- `correction_matrices`
- `samples`

### Pricing
- `market_snapshots`
- `terms_profiles`
- `pricing_decisions`

### Finance
- `accounts`
- `ledger_entries`
- `ledger_corrections`

### Hedging
- `hedge_positions`
- `hedge_applications`

### Settlement
- `settlements`
- `settlement_steps`
- `invoices`
- `invoice_lines`

### Reconciliation
- `reconciliation_cases`
- `reconciliation_actions`

### Materialized projections
- `projection_operations_overview`
- `projection_queue_exposure`
- `projection_ledger_trace`

## Notable constraints already encoded

- transaction idempotency uniqueness (`transaction_envelopes.idempotency_key`)
- ledger debit/credit account inequality check
- hedge application ratio check `(0,1]`
- settlement step uniqueness per sequence order
- invoice immutability check

## Planned next schema increments

- additional checks for stronger no-orphan guarantees
- projection rebuild metadata and checkpoints
- materialized settlement drilldown model
