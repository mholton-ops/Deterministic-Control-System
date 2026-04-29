# Deterministic Control System (Clean-Room ALIGN Reference)

A public-safe, clean-room reference implementation of a deterministic operational control platform that preserves truth across field capture, custody, transformation, analysis, pricing, financial state, hedging, and final settlement.

This repository is based on architectural principles described in the source document by Mike Holton. It is not proprietary source code and does not claim to be an exact internal implementation.

This app demonstrates implemented control surfaces and API projections using deterministic synthetic data. It does not represent production deployment, real customer data, or proprietary internals.

## Why this exists

Most software models fail this domain because they assume:
- clean inputs
- stable identity of physical assets
- finalized value at data entry time
- accounting detached from operations

This domain has the opposite characteristics:
- money moves before truth is finalized
- material transforms and original identity is destroyed
- uncertainty must be represented and controlled
- operational and financial chains must remain bound

The system is therefore designed as an integrity engine, not a CRUD app.

## Clean-room/public-safe intent

This repo intentionally preserves architecture and guarantees while avoiding confidential implementation details.

What it does preserve:
- control philosophy
- domain boundaries
- state discipline
- deterministic transaction and reconstruction model
- evidence/provenance requirements
- financial-operational binding

What it intentionally abstracts:
- private partner integrations
- sensitive trade parameters
- proprietary customer data
- confidential infrastructure specifics

See [Public-Safe Boundary](docs/public-safe-boundary.md).

## Core guarantees

The reference architecture is defined by guarantees, not features:
- no drift
- full reconstructability
- immutable truth with additive correction
- controlled origin
- deterministic replication/application
- evidence-backed critical state
- financial-physical alignment
- continuous validation
- no orphan data
- system enforcement over user discipline

See [System Guarantees](docs/system-guarantees.md).

## Bounded context map

The system is split into bounded contexts:
- Field Origination
- Inventory and Custody
- Grading and Smart Library
- Analytical Layer
- Pricing and Terms
- Financial Control Ledger
- Hedging and Exposure
- Assay to Settlement
- Reconciliation and Divergence

See [Architecture](docs/architecture.md) and [Domain Model](docs/domain-model.md).
See [Module Map](docs/module-map.md) for ownership boundaries.

## 5-minute walkthrough

1. Read [Architecture](docs/architecture.md) for system shape and transaction model.
2. Read [System Guarantees](docs/system-guarantees.md) for non-negotiable invariants.
3. Read [Architecture Diagrams](docs/diagrams.md) for control topology and lifecycle flow visuals.
4. Read [Field to Settlement Workflow](docs/workflows/field-to-settlement.md) for end-to-end lifecycle.
5. Read [Reconciliation](docs/reconciliation.md) for divergence handling and control loops.
6. Review [Implementation Plan](docs/implementation-plan.md) for staged build status.

## Local Runtime (End-to-End Demo)

1. Start Docker Desktop.
2. Start Postgres: `docker compose -f docker/compose.yml up -d postgres`
3. Apply migrations: `npm run db:migrate`
4. Seed deterministic reference data: `npm run db:seed`
5. Run simulation: `npm run simulate`
6. Materialize projections: `npm run projections:worker:once`
7. Run integration workflow test: `npm run test:integration`
8. Run API integration workflow test: `npm run test:api-integration`
9. Run state-transition audit test: `npm run test:state-audit`
10. Verify baseline guarantees: `npm run verify:guarantees`
11. Start API: `npm run dev:api`
12. Start operator workbench: `npm run dev:web`

## Repository structure

```text
apps/
  api/                 Fastify control-plane API
  operator-web/        Next.js operator workbench
packages/
  domain/              Core domain logic and state machines
  contracts/           Zod contracts for command/event/query schemas
  db/                  PostgreSQL + Drizzle schema/migrations/seeds
  event-log/           Append-only transaction envelopes
  replication/         Dependency-aware deterministic application
  projections/         Read-model builders
  simulation/          Deterministic scenario runner
  ui-kit/              Shared operator UI primitives
  config/              Shared TS/lint/runtime config
docs/
  architecture.md
  diagrams.md
  domain-model.md
  state-machines.md
  event-taxonomy.md
  schema-guide.md
  glossary.md
  projections.md
  seeding-and-simulation.md
  api/commands.md
  api/queries.md
  system-guarantees.md
  workflows/field-to-settlement.md
  reconciliation.md
  public-safe-boundary.md
  docs-plan.md
  implementation-plan.md
```

## Current status

This repository now contains completed **Phase 1**, **Phase 2**, **Phase 3**, and a substantial **Phase 4 baseline**:
- monorepo structure
- architecture and module map
- guarantee model
- docs plan and implementation plan
- typed domain invariants and state machines
- Zod command and transaction contracts
- Drizzle schema for provenance, evidence, custody, analytics, pricing, finance, hedge, settlement, and reconciliation
- Fastify command/query API with deterministic command processor
- checkpoint-based projection worker and materialized projection support
- workbench query endpoints for intake, custody, grading, analytics, pricing/exposure, reconciliation, settlements, audit, and customer visibility
- ALIGN alignment surfaces for replication/sync integrity, Smart Library detail, and funding/money control
- trace and reconstruction endpoints for chain proof (`/trace/:entityType/:entityId`, `/reconstruct/settlement/:settlementId`)
- Next.js operator workbench with multi-page operational views and settlement drilldown
- global trace navigation from converter/box/queue/sample/settlement/ledger rows
- settlement reconstruction page with replay and uncertainty surfacing
- deterministic seed/simulation scripts with guarantee verification checks
- deterministic field-to-settlement integration workflow test script
- customer-facing controlled visibility surface (source Section 12) implemented as a public-safe, read-only filtered view that exposes inventory/value/proof/report status without internal control authority

Phase 5 portfolio hardening is in progress with ongoing docs and demonstration polish.

For deterministic reviewer artifacts (fixtures + optional screenshots), see [Reviewer Runbook](docs/reviewer-runbook.md).

## CI Gate

GitHub Actions workflow: `.github/workflows/ci.yml`

The gate runs:
- migrations and deterministic seed/simulation bootstrapping
- projection materialization
- typecheck
- processor + API integration tests
- state-transition audit tests
- guarantee verification
- workspace build

Reviewer artifact workflow: `.github/workflows/review-artifacts.yml`

This manual workflow generates and uploads:
- `fixtures-<run_id>` from `docs/fixtures/latest`
- `screenshots-<run_id>` from `docs/screenshots/latest`

## Important files for reviewers

- [README.md](README.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/diagrams.md](docs/diagrams.md)
- [docs/domain-model.md](docs/domain-model.md)
- [docs/module-map.md](docs/module-map.md)
- [docs/system-guarantees.md](docs/system-guarantees.md)
- [docs/state-machines.md](docs/state-machines.md)
- [docs/event-taxonomy.md](docs/event-taxonomy.md)
- [docs/schema-guide.md](docs/schema-guide.md)
- [docs/glossary.md](docs/glossary.md)
- [docs/api/commands.md](docs/api/commands.md)
- [docs/api/queries.md](docs/api/queries.md)
- [docs/projections.md](docs/projections.md)
- [docs/seeding-and-simulation.md](docs/seeding-and-simulation.md)
- [docs/workflows/field-to-settlement.md](docs/workflows/field-to-settlement.md)
- [docs/reconciliation.md](docs/reconciliation.md)
- [docs/implementation-plan.md](docs/implementation-plan.md)
- [docs/reviewer-runbook.md](docs/reviewer-runbook.md)
- [docs/public-safe-boundary.md](docs/public-safe-boundary.md)
- [packages/domain/src/index.ts](packages/domain/src/index.ts)
- [packages/contracts/src/commands.ts](packages/contracts/src/commands.ts)
- [packages/db/src/schema.ts](packages/db/src/schema.ts)
- [packages/db/drizzle/0000_worried_rictor.sql](packages/db/drizzle/0000_worried_rictor.sql)
- [packages/db/drizzle/0001_lethal_spencer_smythe.sql](packages/db/drizzle/0001_lethal_spencer_smythe.sql)
- [packages/db/drizzle/0002_dashing_vindicator.sql](packages/db/drizzle/0002_dashing_vindicator.sql)
- [packages/db/drizzle/0003_broad_outlaw_kid.sql](packages/db/drizzle/0003_broad_outlaw_kid.sql)
- [packages/replication/src/command-processor.ts](packages/replication/src/command-processor.ts)
- [packages/projections/src/workbench.ts](packages/projections/src/workbench.ts)
- [packages/projections/src/customer-visibility.ts](packages/projections/src/customer-visibility.ts)
- [apps/api/src/server.ts](apps/api/src/server.ts)
- [apps/operator-web/src/app/page.tsx](apps/operator-web/src/app/page.tsx)
- [apps/operator-web/src/app/customer/page.tsx](apps/operator-web/src/app/customer/page.tsx)
