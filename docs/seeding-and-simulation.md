# Seeding and Simulation

## Migration

Start local Postgres:

```bash
docker compose -f docker/compose.yml up -d postgres
```

Set `DATABASE_URL` explicitly before database commands. The repository does not select an implicit database target.

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
- `packages/db/drizzle/0004_youthful_the_hand.sql`
- `packages/db/drizzle/0005_peaceful_nick_fury.sql`
- `packages/db/drizzle/0006_thin_xavin.sql`
- `packages/db/drizzle/0007_wandering_alice.sql`
- `packages/db/drizzle/0008_lazy_la_nuit.sql`
- `packages/db/drizzle/0009_real_karnak.sql`
- `packages/db/drizzle/0010_talented_piledriver.sql`
- `packages/db/drizzle/0011_outgoing_lady_bullseye.sql`
- `packages/db/drizzle/0012_nappy_sunspot.sql`

## Seed deterministic reference data

```bash
npm run db:seed
```

Seed includes:
- controlled operator, approver, device, assignment, and site records
- deterministic accounts
- qualified Smart Library entries for the supported match hierarchy
- qualified correction matrix
- controlled market snapshots
- controlled terms profiles

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
- converter-to-box assignment and controlled box close
- box-to-queue assignment before queue lock
- queue processing lock
- shipment create + receive
- sample capture
- pricing resolution
- hedge position open
- finance ledger post
- funding separation of duty
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
- transaction/outbox/receipt and checksum consistency
- custody and mass transaction provenance
- funding separation of duty
- exact finalized settlement sequence
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
- unauthorized origin mutation
- failed-command atomic rollback
- dependency-blocked command application before controlled resume
- duplicate receiver receipt creation
- direct mutation of protected ledger and command history
- same-actor funding approval and execution
