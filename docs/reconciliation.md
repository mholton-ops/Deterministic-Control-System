# Reconciliation and Divergence Model

## Position

Divergence is expected in this domain. The system must surface and control it, not hide it.

## Divergence classes

1. Custody divergence
- expected scan state does not match actual scan state
- missing or extra material at transfer boundaries

2. Analytical divergence
- internal estimate vs external/final assay variance outside tolerance
- directional drift by partner/refinery

3. Financial divergence
- ledger movement without complete operational basis
- payout/advance/deposit mismatch at settlement

4. Sequence divergence
- required workflow step skipped or applied out of order

## Reconciliation case lifecycle

`open -> investigating -> resolved | accepted_variance`

Required fields:
- trigger source
- severity
- scope references (queue/lot/box/shipment/ledger)
- evidence references
- owner
- required actions
- closure rationale

## Trigger strategy

Reconciliation cases are opened by rules, not by operator memory.

Examples:
- weight delta > configured threshold
- assay variance > configured threshold
- custody scan miss at shipment receipt
- orphan financial posting detection

## Resolution strategy

Resolution is additive:
- record findings
- append adjustment events
- append financial offset/correction entries as needed
- never rewrite historical source facts

## Operator visibility requirements

Workbench must support:
- queue-level discrepancy dashboard
- case drill-down to source events
- evidence side panel (images/GPS/notes)
- linked financial effect view
- closure audit trail

## Metrics

Track as first-class operational measures:
- open case count by severity
- mean time to resolution
- repeated variance patterns by source
- estimate-to-final accuracy trend
- unresolved financial exposure linked to open cases

## Non-negotiable rule

A closed case must always answer:
- what diverged
- why it diverged
- what correction was applied
- whether residual risk remains
