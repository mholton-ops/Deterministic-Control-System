# State Machines

This document maps implemented lifecycle guards to bounded contexts.

## Converter (`packages/domain/src/custody/model.ts`)

Lifecycle:
`captured -> boxed -> queued -> in_transit -> received -> processing -> sampled -> settled`

Key guards:
- converter can be boxed only from `captured`
- converter assignment requires target box in `active`

## Box (`packages/domain/src/custody/model.ts`)

Lifecycle:
`empty -> active -> closed -> shipped -> received -> retired`

Key guards:
- transitions are strict and ordered
- no reverse transitions

## Queue (`packages/domain/src/custody/model.ts`)

Lifecycle:
`open -> processing -> sampled -> assay_pending -> valued -> settled`

Key guards:
- queue lock allowed only from `open`
- lock operation sets `lockedForProcessing=true`
- sample capture is only allowed when queue-linked custody is in milled material form

## Origination (`packages/domain/src/origination/model.ts`)

Lifecycle:
`captured -> submitted_for_grading`

Key guards:
- image + GPS evidence required for valid capture
- low-confidence GPS capture is rejected

## Settlement (`packages/domain/src/settlement/model.ts`)

Strict step order:
1. `lot_selected`
2. `contents_reviewed`
3. `sample_data_recorded`
4. `adjustments_recorded`
5. `weight_basis_locked`
6. `hedges_applied`
7. `financial_context_applied`
8. `final_value_calculated`
9. `invoice_finalized`

Key guards:
- out-of-order step append rejected
- finalized settlement cannot be mutated

## Reconciliation (`packages/domain/src/reconciliation/model.ts`)

Lifecycle:
`open -> investigating -> resolved | accepted_variance`

Key guards:
- only allowed transitions apply
- case closure requires rationale

## Cross-context checks

- mass balance drift check in custody model
- pricing blocks field override attempts
- finance enforces operational source reference and note evidence
- guarantee helpers enforce no drift, evidence-backed critical state, and financial-physical alignment
