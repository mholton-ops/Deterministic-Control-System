# System Guarantees

This repository is defined by guarantees that must remain true under normal and failure conditions.

## G1: No Drift

Definition:
- Multiple system views must not silently diverge.

Enforcement:
- atomic persistence of command intent and domain effects
- deterministic projection rebuild from transaction-linked operational state
- idempotent command submission and receiver application
- fail-closed dependency gating and controlled resume

Validation approach:
- a second projection-worker pass reports no additional source work
- duplicate command submission does not mutate effective state
- duplicate receiver delivery produces one receipt and no duplicate acknowledgement

## G2: Full Reconstructability

Definition:
- Every represented critical state can be explained through its linked command, origin, evidence, custody, valuation, ledger, and settlement chain.

Enforcement:
- immutable transaction envelopes
- timestamped origin and dependency metadata
- current-state command pointers on converter, box, queue, and shipment aggregates
- deterministic projection builders over a repeatable-read database snapshot
- trace and settlement-reconstruction endpoints (`/trace/*`, `/reconstruct/settlement/*`) for operator-visible proof chains

Validation approach:
- guarantee scans verify transaction, current custody state, evidence, mass, valuation, hedge, ledger, settlement, invoice, and reconciliation lineage
- trace and reconstruction projections are exercised by the API integration workflow

Implementation boundary:
- this public implementation does not claim generic event-store replay or arbitrary state-at-time reconstruction

## G3: Immutable Truth with Additive Correction

Definition:
- truth-bearing records are never destructively edited.

Enforcement:
- database triggers reject update/delete operations on protected history tables
- accepted command payload, origin, and idempotency identity are protected after insertion
- correction events and offset ledger entries only

Validation approach:
- state audit verifies protected ledger history and command payloads cannot be changed, and reconciliation cannot skip its investigation transition

## G4: Controlled Origin

Definition:
- every state change has a valid, permissioned origin.

Enforcement:
- origin tuple required on commands/events
- role and source-context policy checks
- device/user binding checks for field origination

Validation approach:
- unauthorized origin tests fail predictably

## G5: Deterministic Replication/Application

Definition:
- the same accepted command is applied at most once locally and at most once per receiver stream.

Enforcement:
- deterministic transaction identity from idempotency key
- payload checksum conflict detection for reused idempotency keys
- dependency references in the envelope
- awaiting-validation state for unresolved dependencies
- unique receiver receipts and stream acknowledgements

Validation approach:
- unresolved work is blocked, resumed after its dependency exists, and applied exactly once
- receipt redelivery does not create a second receiver application

## G6: Evidence-backed Critical State

Definition:
- critical operational/financial states cannot exist without required evidence.

Enforcement:
- evidence requirements by transition type
- evidence presence checks in command handlers
- evidence-first operator rendering (artifact previews + capture provenance), not count-only summaries

Validation approach:
- missing-evidence commands rejected

## G7: Financial-Physical Alignment

Definition:
- money movement must tie to physical/operational origin and purpose.

Enforcement:
- required source operational ref on ledger postings
- settlement references queue/lot scope and assay basis
- account pairing and purpose-code controls
- distinct approving and executing actors for funding advances
- hedge openings, settlement controls, final invoices, and reconciliation transitions retain direct source-command foreign keys

Validation approach:
- orphan-ledger and financial-control lineage queries must return zero rows

## G8: Continuous Validation

Definition:
- the system continuously surfaces inconsistency and variance.

Enforcement:
- reconciliation case generators
- discrepancy events from custody/assay/ledger mismatches
- analytical estimate-vs-final comparisons

Validation approach:
- seeded scenarios trigger expected reconciliation cases

## G9: No Orphan Data

Definition:
- no data exists without contextual chain linkage.

Enforcement:
- foreign keys, uniqueness constraints, and typed reference constraints on covered critical records
- envelope dependency model
- transaction and evidence provenance on custody and mass records

Validation approach:
- periodic orphan scans in CI checks

## G10: System Enforcement over User Discipline

Definition:
- correctness is structurally enforced regardless of user behavior.

Enforcement:
- constrained command model
- explicit state machine transition checks
- control-point interfaces for pricing and finance

Validation approach:
- transition-guard tests for invalid command sequences

## Guarantee to module mapping

- `packages/domain`: transition and invariant rules
- `packages/contracts`: strict command/event schema validation
- `packages/event-log`: immutable envelope persistence
- `packages/replication`: deterministic apply and dependency management
- `packages/projections`: rebuildable read models and proof-chain reconstruction
- `packages/db`: FK integrity and immutable table policies
- `apps/api`: controlled command entry points and authorization
- `apps/operator-web`: visibility and drill-down, not authoritative state mutation
