# Seeding and Simulation

## Migration

Start local Postgres:

```bash
docker compose -f docker/compose.yml up -d postgres
```

Apply migrations:

```bash
npm run db:migrate
```

Generate migration SQL from schema changes:

```bash
npm run db:generate
```

Current generated migrations:
- `packages/db/drizzle/0000_worried_rictor.sql`
- `packages/db/drizzle/0001_lethal_spencer_smythe.sql`
- `packages/db/drizzle/0002_dashing_vindicator.sql`
- `packages/db/drizzle/0003_broad_outlaw_kid.sql`

## Seed deterministic reference data

```bash
npm run db:seed
```

Seed includes:
- operator user/device
- baseline accounts
- qualified correction matrix
- market snapshot
- terms profile

## Reset + reseed

```bash
npm run db:reset
npm run db:seed
```

## Run deterministic simulation scenario

```bash
npm run simulate
```

Scenario emits a sequence of commands through the same command processor used by API.

Current scenario includes:
- field capture with image/gps evidence
- queue processing lock
- shipment create + receive
- sample capture
- pricing resolution
- hedge position open
- finance ledger post
- reconciliation case open
- assay-to-settlement finalization

## Refresh materialized projections

```bash
npm run projections:worker:once
```

## Verify guarantee checks

```bash
npm run verify:guarantees
```

This script verifies core invariant examples:
- evidence linked to captures
- immutable invoice behavior
- settlement/invoice linkage
- projection and source consistency checks

## Run field-to-settlement integration workflow test

```bash
npm run test:integration
```

This executes an end-to-end command chain with assertions for:
- shipment custody transition correctness
- pricing decision linkage to queue continuity scope
- ledger operational reference binding
- reconciliation action recording
- settlement finalization and invoice artifact creation

## Run API-level integration workflow test

```bash
npm run test:api-integration
```

This drives the same lifecycle over HTTP through `/commands` and validates
`/workbench/*` plus projection query consistency.

## Run state-transition audit test

```bash
npm run test:state-audit
```

This asserts forbidden transitions are rejected, including:
- reconciliation direct close without investigation
- out-of-order settlement step append
- zero-delta additive correction
- shipment creation from a received box state
