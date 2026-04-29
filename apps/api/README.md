# API App

Fastify control-plane service for command ingestion, validation, and deterministic transaction application.

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
