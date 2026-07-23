# API App

Fastify control-plane service for command ingestion, validation, and deterministic transaction application.

## Required configuration

- `DATABASE_URL`: explicit PostgreSQL connection string; no implicit database target is selected
- `DCS_CONTROL_API_TOKEN`: bearer token for all mutation routes
- `DCS_CORS_ORIGINS`: comma-separated browser origins, defaulting to the local operator-web origins

`DCS_ALLOW_UNAUTHENTICATED_DEMO=true` is an explicit isolated-demo bypass. It must not be treated as a deployment default.

Health endpoints:
- `GET /health` verifies that the process is running
- `GET /ready` verifies database reachability

Phase status:
- Phase 3 baseline implemented:
  - command ingestion endpoint
  - deterministic command processor integration
  - projection query endpoints
- expanded with workbench read-model endpoints:
  - `/workbench/intake`
  - `/workbench/custody`
  - `/workbench/grading`
  - `/workbench/analytics`
  - `/workbench/pricing-exposure`
  - `/workbench/reconciliation`
  - `/workbench/settlements`
  - `/workbench/evidence`
  - `/workbench/transactions`

Mutation controls include a one-megabyte body limit, rate limiting, controlled CORS, bearer authorization, controlled-origin validation, idempotency conflict detection, and generic internal-error responses.
