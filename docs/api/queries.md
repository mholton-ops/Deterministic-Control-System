# API Queries

Base URL: `http://localhost:3001`

## GET `/health`

Basic health response.

## GET `/projections/operations-overview`

Returns aggregate operational state:
- converter counts by state
- queue count
- open reconciliation count
- total estimated queue value

Query params:
- `mode=live|materialized` (default `live`)

## GET `/projections/queue-exposure`

Returns queue-level exposure/readiness view:
- queue state
- estimated value
- sample averages
- hedged quantities

Query params:
- `mode=live|materialized` (default `live`)

## GET `/projections/ledger-trace?sourceOperationalRef=<ref>`

Returns ledger entries with optional source operational filtering.

Query params:
- `sourceOperationalRef` (optional)
- `mode=live|materialized` (default `live`)

## GET `/projections/settlement/:settlementId`

Returns settlement drilldown:
- settlement status and values
- settlement step history
- invoice and line detail

Query params:
- `mode=live|materialized` (default `live`)

## GET `/trace/:entityType/:entityId`

Returns an end-to-end chain view anchored on:
- `converter`
- `box`
- `queue`
- `sample`
- `settlement`
- `ledger_entry`

Response includes:
- chronological chain steps
- per-step truth status (`estimated|provisional|validated|finalized`)
- per-step confidence (`high|medium|low|unknown`)
- validation and dependency state
- origin provenance (source/user/device/time)
- evidence snapshot and missing required evidence types
- certainty summary and open proof gaps

## GET `/customer/visibility`

Returns the controlled customer-facing truth surface:
- filtered inventory and lot progress
- customer-visible estimated/final value
- proof/evidence status
- hedge, sale, bid, and report availability
- daily customer-visible activity totals

This endpoint intentionally exposes visibility without internal mutation authority.

## GET `/workbench/replication-sync`

Returns deterministic demo evidence for ALIGN-style replication control:
- local transaction creation and local persistence
- outbound queue and transmission status
- receiver validation, dependency checks, idempotent apply, and acknowledgement
- confirmed, failed, retrying, and dependency-blocked movement states
- image stream and record stream separation
- projection rebuild and replay status
- last sync by site

This endpoint is a public abstraction of controlled transaction movement. It does not expose production topology.

## GET `/workbench/smart-library-detail`

Returns Smart Library detail evidence:
- match method and match hierarchy
- image or artifact reference
- physical characteristics and dimensional attributes
- assay and pricing history
- qualification and override history
- final assay feedback loop and library refinement note

Field capture may start valuation context, but field buyers do not set final value.

## GET `/workbench/funding-control`

Returns funding and money-control evidence:
- funding advances
- approving and executing actors
- buyer or site balance
- linked purchases, boxes, and queues
- provisional vs finalized money state
- offsetting corrections
- separation-of-duty trail
- evidence or notes requirement
- ledger source references

This prevents financial movement from separating from material state and settlement truth.

## GET `/reconstruct/settlement/:settlementId`

Returns settlement replay view:
- before/after estimate vs final comparison
- variance explanation
- step-by-step replay with uncertainty markers
- dependency references
- origin/evidence linkage at each replay step

## GET `/workbench/intake`

Field origination records with origin provenance and evidence references.

Query params:
- `mode=live|materialized` (default `live`)

## GET `/workbench/custody`

Returns grouped custody views:
- boxes (state + converter count)
- queues (state + box count + estimated value)
- shipments (in-transit/received state + box counts)
- box-level representative evidence previews for custody proof context

Query params:
- `mode=live|materialized` (default `live`)

## GET `/workbench/grading`

Grading decisions with method hierarchy, confidence, override visibility, and operator identity.

Query params:
- `mode=live|materialized` (default `live`)

## GET `/workbench/analytics`

Sample-level analytical rows with raw/corrected values and matrix qualification context.

Query params:
- `mode=live|materialized` (default `live`)

## GET `/workbench/pricing-exposure`

Queue-level pricing and exposure view:
- estimate + source method/confidence
- hedge quantities and open hedge counts
- needs-hedged control flag
- linked settlement status

Query params:
- `mode=live|materialized` (default `live`)

## GET `/workbench/reconciliation`

Divergence cases with severity, scope, status, and action counts.

Query params:
- `mode=live|materialized` (default `live`)

## GET `/workbench/settlements`

Settlement artifact list with estimate/final/variance and invoice counts.

Query params:
- `mode=live|materialized` (default `live`)

## GET `/workbench/evidence`

Evidence bundle explorer with:
- operational/financial link counts
- artifact previews (`type`, `uri`, capture time)

Query params:
- `mode=live|materialized` (default `live`)

## GET `/workbench/transactions?limit=<1..500>`

Recent transaction envelope history with origin user/device and validation status.

Query params:
- `limit=<1..500>` (default `100`)
- `mode=live|materialized` (default `live`)

## POST `/projections/rebuild`

Rebuilds materialized projection tables from current operational data.

Implementation references:
- `packages/projections/src/projections.ts`
- `apps/api/src/server.ts`
