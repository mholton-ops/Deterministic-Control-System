# Module Map

## Apps

### `apps/api`
Responsibility:
- command/query API surface
- authorization and origin policy enforcement
- orchestration of domain modules

Does not own:
- core domain invariants (owned by `packages/domain`)
- persistence schema definitions (owned by `packages/db`)

### `apps/operator-web`
Responsibility:
- operator workbench UI
- workflow visualization and drill-down
- reconciliation and evidence exploration

Does not own:
- authoritative state mutation logic

## Packages

### `packages/domain`
Responsibility:
- entities, value objects, state transitions
- invariant checks
- command intent handlers (pure/domain-side)

### `packages/contracts`
Responsibility:
- Zod schemas for commands/events/queries
- request/response contract typing

### `packages/db`
Responsibility:
- Drizzle schema
- migrations
- seed data definitions

### `packages/event-log`
Responsibility:
- append-only transaction envelope persistence
- idempotency key index support

### `packages/replication`
Responsibility:
- dependency-aware application
- queue states: pending/transmitting/awaiting_validation/applied/confirmed
- deterministic retry behavior

### `packages/projections`
Responsibility:
- build query/read models from event stream
- rebuild and checksum support

### `packages/simulation`
Responsibility:
- deterministic scenario runner
- progression scripts from field capture to settlement
- discrepancy injection for reconciliation demo

### `packages/ui-kit`
Responsibility:
- shared operational UI components
- consistent audit/workbench visual language

### `packages/config`
Responsibility:
- shared TypeScript and linting presets

## Domain submodules (`packages/domain/src`)

- `origination`: constrained field capture and origin validity
- `custody`: converter/box/queue/shipment states and custody events
- `grading`: centralized grading and library resolution hierarchy
- `analytics`: sample handling and correction model integration
- `pricing`: controlled pricing and terms resolution
- `finance`: immutable ledger and transaction control rules
- `hedging`: exposure and hedge lifecycle
- `settlement`: assay-to-finalization sequence
- `reconciliation`: divergence case lifecycle
- `guarantees`: cross-context invariant compositions

## Cross-module dependency direction

Preferred direction:

`contracts -> domain -> event-log/replication -> projections -> apps`

Constraints:
- app layer may call domain services but cannot bypass domain invariants
- projection layer is derived-only and never writes source-of-truth events
- finance and settlement modules must consume custody/analytics references
