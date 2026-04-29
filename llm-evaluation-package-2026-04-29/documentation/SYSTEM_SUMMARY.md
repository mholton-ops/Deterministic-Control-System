# System Summary

HALDN CONTROL is a deterministic operational control workbench for catalytic-converter/material operations. The system models field intake, replication/sync integrity, custody, grading, Smart Library authority, assay analytics, pricing/exposure, funding control, finance ledger linkage, reconciliation, settlements, traceability, and customer-visible reporting.

This app demonstrates implemented control surfaces and API projections using deterministic synthetic data. It does not represent production deployment, real customer data, or proprietary internals.

## Architectural Shape

- API service exposes projections for operational workbenches and truth graph views.
- Postgres stores deterministic operational state and projection data.
- Operator web app renders server-backed workbenches from API projections.
- Trace/detail panels expose entity-level provenance, dependencies, evidence, financial records, and value lineage.
- Customer visibility is separated from internal control by a filtered projection.
- Replication / Sync, Smart Library Detail, and Funding / Money Control are public abstraction surfaces added to make ALIGN control evidence explicit without exposing private internals.

## What The Screenshots Demonstrate

- The app is not a landing page; it is an operational workbench with dense system state.
- Each major process has a dedicated route and data-backed table or summary surface.
- Replication is shown as controlled transaction movement with local persistence, queue state, validation, dependency checks, idempotent apply, acknowledgement, stream separation, and replay status.
- Smart Library detail shows match hierarchy, artifact reference, physical and dimensional traits, qualification, overrides, assay feedback, and library refinement while preserving central valuation authority.
- Funding control shows advances, approvals, execution, balances, linked purchases and queues, provisional/finalized state, corrections, evidence notes, and separation of duty.
- Entity-level trace/detail views connect operational records to evidence and financial state.
- The system exposes both internal controls and customer-safe filtered visibility.
- Narrow-screen behavior keeps row actions accessible while preserving dense data in scrollable tables.

## Known Framing Limits

- Screenshots use deterministic demo/simulation data.
- Replication statuses for retrying, failed, and dependency-blocked movement are deterministic demo evidence, not live infrastructure health claims.
- Smart Library and funding detail use public abstractions and synthetic values where proprietary internals would normally exist.
- A reviewer should distinguish represented workflow capability from production policy/compliance readiness.
