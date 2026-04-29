# Reviewer Runbook

This runbook generates deterministic review artifacts for portfolio evaluation.

## Objective

Produce a reproducible package of:
- deterministic JSON fixtures from API/query endpoints
- optional operator UI screenshots
- a known-good state for walkthrough and technical review

## Prerequisites

- Docker Desktop running
- Postgres container available via `docker/compose.yml`
- Node dependencies installed (`npm install`)

Optional for screenshots:
- Chromium browser install:
  - `npm run playwright:install`

## One-command artifact generation

```bash
npm run review:artifacts
```

This command performs:
1. `db:reset`
2. `db:seed`
3. `simulate`
4. `projections:worker:once`
5. starts API + operator web on isolated ports
6. exports fixtures from materialized endpoints
7. captures screenshots when Playwright is available

## GitHub Actions artifact generation

Manual workflow:
- `.github/workflows/review-artifacts.yml`

How to run:
1. Open GitHub Actions.
2. Run `Reviewer Artifacts` via `workflow_dispatch`.
3. Download:
   - `fixtures-<run_id>`
   - `screenshots-<run_id>`

## Output paths

- Fixtures:
  - `docs/fixtures/latest/*.json`
- Screenshots (if Playwright available):
  - `docs/screenshots/latest/*.png`
  - includes `settlement-detail.png` when a deterministic settlement exists
  - includes `settlement-reconstruct.png` and `trace-settlement.png` for replay/trace proof views
  - includes `replication-sync.png` for controlled transaction movement and stream integrity
  - includes `customer-visibility.png` for the controlled customer-facing visibility surface

## Recommended review sequence

1. Open `docs/fixtures/latest/operations-overview.json`
2. Open `docs/fixtures/latest/replication-sync.json`
3. Open `docs/fixtures/latest/smart-library-detail.json`
4. Open `docs/fixtures/latest/funding-control.json`
5. Open `docs/fixtures/latest/reconciliation.json`
6. Open `docs/fixtures/latest/settlement-drilldown.json`
7. Open `docs/fixtures/latest/customer-visibility.json`
8. Inspect UI screenshots under `docs/screenshots/latest/` (when generated)
9. Validate enforcement tests:
   - `npm run test:integration`
   - `npm run test:api-integration`
   - `npm run test:state-audit`
10. Cross-check commands and guarantees in:
   - `docs/api/commands.md`
   - `docs/system-guarantees.md`
   - `docs/workflows/field-to-settlement.md`
