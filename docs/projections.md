# Projections

Projection builders currently implemented:

- `buildOperationsOverviewProjection`
- `buildQueueExposureProjection`
- `buildLedgerTraceProjection`
- `buildSettlementDrilldownProjection`
- `buildFieldIntakeProjection`
- `buildCustodyProjection`
- `buildGradingWorkbenchProjection`
- `buildAnalyticsWorkbenchProjection`
- `buildPricingExposureWorkbenchProjection`
- `buildReconciliationWorkbenchProjection`
- `buildSettlementListProjection`
- `buildEvidenceExplorerProjection`
- `buildTransactionHistoryProjection`
- `buildCustomerVisibilityProjection`
- `buildReplicationSyncProjection`
- `buildSmartLibraryDetailProjection`
- `buildFundingControlProjection`
- `rebuildMaterializedProjections`
- `getMaterializedOperationsOverview`
- `getMaterializedQueueExposure`
- `getMaterializedLedgerTrace`
- `getMaterializedWorkbenchProjection`
- `getMaterializedSettlementDrilldownProjection`
- `runProjectionWorkerOnce`
- `runProjectionWorkerLoop`

Code location:
- `packages/projections/src/projections.ts`
- `packages/projections/src/materializer.ts`
- `packages/projections/src/rebuild.ts`
- `packages/projections/src/workbench.ts`
- `packages/projections/src/customer-visibility.ts`
- `packages/projections/src/align-control-evidence.ts`

Design note:
Projection rows are read models derived from transaction-linked operational data. A rebuild reads one repeatable database snapshot and records its source-transaction count in the projection checkpoint.

ALIGN alignment note:
- replication/sync integrity is shown from deterministic outbox, receiver-receipt, dependency, retry, acknowledgement, and stream records
- Smart Library detail is shown as centralized valuation authority with match hierarchy, artifact reference, qualification, overrides, assay feedback, and refinement notes
- funding control is shown as money movement tied to material state, ledger source references, separation of duty, evidence notes, corrections, and settlement status

Demo framing:
This app demonstrates implemented control surfaces and API projections using deterministic synthetic data. It does not represent production deployment, real customer data, or proprietary internals.

Current phase:
- query-time projection functions implemented
- materialized projection tables and rebuild function implemented
- checkpoint-based projection worker implemented for incremental rebuild decisions
- materialized workbench view caches implemented for consistent `mode=materialized` reads
- materialized settlement drilldown caches implemented

Implementation boundary:
- projection rebuild is implemented
- receiver application is idempotent per transaction, target, and stream
- generic state-at-time event replay and physical multi-node transport are intentionally not claimed

Rebuild command:
- `npm run projections:rebuild`

Worker command:
- `npm run projections:worker:once`
