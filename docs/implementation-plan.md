# Implementation Plan

## Phase 1: Design and structure (complete)

Deliverables:
- monorepo folder skeleton
- architecture overview
- bounded context/module map
- README and reviewer entry points
- docs plan and execution phases

Status:
- baseline complete in this iteration

## Phase 2: Domain model and schema spine

Deliverables:
- explicit entity/value object definitions in code
- state machine guards
- transaction envelope contracts (Zod)
- Drizzle schema for append-only event log and core entities
- validation rule tests

Exit criteria:
- invalid transitions rejected
- dependency violations rejected
- evidence requirements enforced at command boundary

Status:
- baseline complete in this iteration

## Phase 3: API and projection core

Deliverables:
- Fastify command endpoints by context
- deterministic apply engine with idempotency + dependency gating
- projection builders for operator read models
- seed data and local bootstrap path

Exit criteria:
- replay of seeded transaction stream reconstructs projections identically

Status:
- baseline implementation complete:
  - Fastify API command/query routes
  - deterministic command processor skeleton
  - projection query builders
  - materialized projection rebuild pipeline and tables
  - initial migration generation and seed/simulation scripts
  - expanded command coverage including shipment and reconciliation action commands
- remaining:
  - periodic/incremental projection worker scheduling

## Phase 4: Operator UI and deterministic simulation

Deliverables:
- Next.js operator workbench pages
- drill-down audit and evidence explorer
- discrepancy and reconciliation views
- scripted deterministic scenario progression

Exit criteria:
- field-to-settlement demo path reproducible end-to-end

Status:
- baseline implementation complete:
  - Next.js operator workbench with operational pages and settlement drilldown
  - workbench query API endpoints (`/workbench/*`)
  - deterministic simulation includes shipment and settlement finalization path
  - guarantee verification script for seeded demo

## Phase 5: Portfolio hardening

Deliverables:
- final docs polish and diagrams
- scenario walkthroughs and screenshots
- architecture rationale and tradeoff notes
- guarantee-focused integration tests

Exit criteria:
- technical reviewer can assess guarantees quickly
- repository communicates serious operational systems design

Status:
- in progress:
  - API/query docs updated to match implemented endpoints
  - simulation and projection docs updated
  - README refreshed with CI gate coverage and reviewer artifact pointers
  - guarantee-focused integration workflow tests implemented:
    - processor-level deterministic workflow test
    - API-level HTTP command/query workflow test
  - state-transition audit test implemented for forbidden transition enforcement
  - reviewer artifact generation script + runbook added
  - architecture diagrams added with source-controlled Mermaid assets
  - screenshot artifact generation now captures operator pages plus settlement drilldown
  - GitHub Actions CI gate added (`.github/workflows/ci.yml`)
  - GitHub Actions reviewer artifact workflow added (`.github/workflows/review-artifacts.yml`)
  - trace-first UX refactor implemented:
    - global `[Trace]` navigation on converter/box/queue/sample/settlement/ledger rows
    - `/trace/:entityType/:entityId` chain proof endpoint and full trace page
    - `/reconstruct/settlement/:settlementId` replay endpoint and reconstruction page
    - lifecycle certainty layer (`truth status`, `confidence`, `validation`) across workbench pages
    - evidence-first field/custody displays with visible artifact previews
    - reconciliation page upgraded with estimate-vs-actual and financial impact context
  - source Section 12 alignment implemented:
    - `/customer/visibility` read-only projection for controlled customer visibility
    - `/customer` operator-web page showing filtered inventory, lot progress, customer-visible value, proof status, hedge/sale/bid/report availability, and daily activity totals
    - reviewer artifacts include customer visibility JSON and screenshot
