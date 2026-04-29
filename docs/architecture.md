# Architecture Overview

## Purpose

This system is designed to enforce alignment between physical reality and financial reality in a high-uncertainty operational environment.

It is not modeled as a traditional line-of-business application. It is modeled as a deterministic control platform where:
- truth is captured at origin
- transformation continuity is preserved
- uncertainty is explicit
- financial impact remains tied to operational events

## Source-driven design stance

The source document describes the core problem as a system integrity problem, not a software convenience problem. The implementation therefore prioritizes:
- structural enforcement over user discipline
- additive history over destructive edits
- controlled origin over unrestricted mutation
- deterministic replay over opaque state mutation

## Logical system shape

```text
Field Capture (controlled input)
  -> Transaction Log (append-only, provenance-rich)
  -> Deterministic Application Engine (dependency-aware, idempotent)
  -> Domain State + Projections
  -> Operator Controls (grading, pricing, finance, hedge, settlement)
  -> Reconciliation Loops (variance detection and correction)
```

See [Architecture Diagrams](diagrams.md) for rendered topology and control-loop views.

### Major control loops

1. Origination control loop
- enforce mandatory capture structure
- prevent unusable records from entering operational truth

2. Continuity control loop
- preserve converter -> box -> queue chain through transformation
- maintain custody and mass-balance explainability

3. Value control loop
- central grading + smart library + analytical correction
- enforce confidence hierarchy for pricing decisions

4. Exposure control loop
- represent estimated value, hedge state, and unhedged exposure
- reduce mismatch between committed capital and delayed final truth

5. Settlement control loop
- transition estimate to finalized truth through validated sequence
- produce immutable settlement artifact with full drill-back

6. Reconciliation control loop
- detect divergence by design
- resolve through additive correction, never silent overwrite

## Bounded contexts

### 1) Field Origination
Scope:
- constrained capture commands
- origin identity (user, device)
- evidence requirement (image metadata)
- location and time provenance
- offline-origin command handling

Guarantees served:
- controlled origin
- evidence-backed state
- no orphan data

### 2) Inventory and Custody
Scope:
- converter as atomic origin object
- box as custody boundary
- queue as transformation continuity group
- shipment and material-in-transit states
- custody scan events and audits

Guarantees served:
- full reconstructability
- no drift
- financial-physical alignment

### 3) Grading and Smart Library
Scope:
- centralized grading decisions
- identity hierarchy (VIN, serial, morphology, category)
- controlled override with audit provenance
- library qualification and feedback hooks

Guarantees served:
- system-level enforcement
- controlled origin of valuation
- continuous validation

### 4) Analytical Layer
Scope:
- sample capture and linking
- matrix selection and correction model application
- estimated vs confirmed analytical truth
- confidence scoring and refinement hooks

Guarantees served:
- explicit uncertainty
- continuous validation
- traceable value derivation

### 5) Pricing and Terms
Scope:
- market inputs
- customer terms
- confidence hierarchy resolution
- controlled global pricing behavior
- estimated vs final value state distinctions

Guarantees served:
- centralized control
- no uncontrolled field overrides
- risk-aware valuation

### 6) Financial Control Ledger
Scope:
- immutable transaction entries
- additive correction entries
- controlled money movement interface
- funding, advances, deposits, and settlement linkage

Guarantees served:
- no floating money
- financial-physical alignment
- reconstructability

### 7) Hedging and Exposure
Scope:
- estimated exposure tracking
- internal and external hedge representation
- association to queues/material groups
- need-hedged visibility and lifecycle events

Guarantees served:
- explicit risk state
- operational-financial continuity

### 8) Assay to Settlement
Scope:
- final truth progression sequence
- internal vs external assay comparison
- finalized payout calculation
- immutable settlement and invoice artifact

Guarantees served:
- explainable final numbers
- additive closure of uncertainty

### 9) Reconciliation and Divergence
Scope:
- discrepancy event surfacing
- reconciliation case lifecycle
- additive adjustments with justification
- exception monitoring and closure

Guarantees served:
- continuous validation
- no silent failure
- no hidden divergence

## Data and state strategy

### Transaction spine

All critical state transitions are represented by explicit transaction envelopes with:
- globally unique transaction id
- origin tuple (source system, user, device)
- event type
- payload (typed)
- dependency references
- evidence references
- timestamps
- validation result

### Deterministic application

Application engine rules:
- idempotent apply
- dependency gating (no dependency, no apply)
- append-only history
- additive correction for changes
- explicit failure state capture (no silent drops)

### Projection strategy

Read models are derived from transaction history and can be rebuilt:
- operator workflow projections
- audit and provenance views
- exposure and hedge views
- settlement and variance views
- ledger balance views

## Deployment and execution model (reference)

This public-safe repo will demonstrate:
- local control-plane API
- operator workbench UI
- deterministic simulation runner
- single-node Postgres baseline with replay capability

A multi-node replication demo may be added later as a simulation mode to mirror the source architecture philosophy.

## What this reference intentionally does not do

- Claim exact parity with proprietary internal production systems
- Encode sensitive partner terms or private counterparties
- Expose real customer or transactional data
- Reproduce confidential infrastructure decisions
