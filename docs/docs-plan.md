# Documentation Plan

## Goal

Documentation should make the system understandable as an integrity architecture, not just as code.

## Required docs (phase targets)

### Phase 1 (current)
- `docs/architecture.md`
- `docs/domain-model.md`
- `docs/system-guarantees.md`
- `docs/workflows/field-to-settlement.md`
- `docs/reconciliation.md`
- `docs/public-safe-boundary.md`
- `docs/implementation-plan.md`

### Phase 2
- `docs/state-machines.md`
- `docs/event-taxonomy.md`
- `docs/schema-guide.md`
- `docs/glossary.md`

Status:
- `state-machines.md` complete
- `event-taxonomy.md` complete
- `schema-guide.md` complete
- `glossary.md` complete

### Phase 3
- `docs/api/commands.md`
- `docs/api/queries.md`
- `docs/projections.md`
- `docs/seeding-and-simulation.md`

Status:
- `docs/api/commands.md` complete
- `docs/api/queries.md` complete
- `docs/projections.md` complete
- `docs/seeding-and-simulation.md` complete

### Phase 4
- `docs/demo-scenarios.md`
- `docs/replay-and-reconstruction.md`
- `docs/reconciliation-examples.md`

### Phase 5
- architecture diagrams (context, sequence, data lineage)
- screenshot-backed walkthrough
- reviewer quickstart package

## Documentation quality rules

- all workflow docs must name control points and invariants
- all state changes must describe required evidence/provenance
- all financial docs must link to operational source chain
- no hand-wavy "eventually consistent" language without exact behavior
