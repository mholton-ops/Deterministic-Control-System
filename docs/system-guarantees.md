# System Guarantees

This repository is defined by guarantees that must remain true under normal and failure conditions.

## G1: No Drift

Definition:
- Multiple system views must not silently diverge.

Enforcement:
- append-only transaction history
- deterministic projection rebuild
- idempotent transaction application
- dependency-gated apply rules

Validation approach:
- replay tests produce identical projection checksums
- duplicate transaction replay does not mutate effective state

## G2: Full Reconstructability

Definition:
- Historical state at time T can be derived from transaction history.

Enforcement:
- immutable transaction envelopes
- timestamped origin and dependency metadata
- deterministic projection builders
- trace endpoint and replay endpoint (`/trace/*`, `/reconstruct/settlement/*`) for operator-visible proof chains

Validation approach:
- snapshot-at-time tests for selected workflows

## G3: Immutable Truth with Additive Correction

Definition:
- truth-bearing records are never destructively edited.

Enforcement:
- no update/delete mutation paths for critical history tables
- correction events and offset ledger entries only

Validation approach:
- API rejects destructive mutation commands

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
- same transaction set always yields same effective state.

Enforcement:
- idempotency key uniqueness
- dependency refs in envelope
- pending state for unresolved dependencies

Validation approach:
- shuffled-order apply tests converge on same result

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

Validation approach:
- orphan-ledger detection queries must return zero rows

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
- strict foreign keys and typed reference constraints
- envelope dependency model
- provenance fields on all critical records

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
- `packages/projections`: replay-derived state
- `packages/db`: FK integrity and immutable table policies
- `apps/api`: controlled command entry points and authorization
- `apps/operator-web`: visibility and drill-down, not authoritative state mutation
