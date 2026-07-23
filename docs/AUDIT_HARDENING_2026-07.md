# Audit Hardening, July 2026

## Scope

This pass reviewed control mechanics, persistence invariants, API boundaries, deterministic data, projections, operator interaction, responsive layout, documentation, dependencies, and CI. The existing dark operational visual language and route structure were preserved.

All represented records are deterministic synthetic data. This repository demonstrates public control abstractions, not production deployment, real customer data, private infrastructure, or proprietary internals.

## Closed findings

| Area | Finding | Resolution |
| --- | --- | --- |
| Command integrity | Envelope and domain writes could describe different outcomes after partial failure | Command intent, dependencies, outbox rows, and domain effects now share one database transaction; failed attempts record a separate failed envelope only after rollback |
| Idempotency | Reused keys did not prove payload identity | Transaction IDs are deterministic and duplicate payloads are checksum-verified; conflicting reuse fails explicitly |
| Origin control | UUID shape alone did not establish authority | Active user, active device, assignment, role, and source checks now fail closed; captured-at provenance is retained |
| Dependencies | Deferred work lacked a governed apply path | Recognized dependencies are validated, unresolved work is retained, and controlled resume revalidates then applies once |
| Replication | Sync evidence was primarily presentational | Record/image outboxes, checksums, attempts, retry timing, receiver receipts, acknowledgements, site-level convergence, and status projections now come from stored mechanics; the operator movement table remains intentionally bounded |
| Custody | Queue locking and shipment transitions allowed weak material continuity, and current aggregate state did not retain its controlling command | Queue lock requires linked boxes; membership freezes after lock; boxes close before shipment; receipt requires in-transit state; converter, box, queue, shipment, and shipment-membership records retain direct current-state command lineage |
| Measurement | Custody, sample, and mass observations lacked complete command lineage | Typed commands now carry transaction and evidence provenance into custody events, analytical samples, and mass measurements; in-transit sampling and post-lock mass changes fail closed |
| Evidence | Note-only evidence could imply location and artifact proof | GPS is nullable, artifacts carry checksums, and synthetic artifacts are labeled explicitly |
| Smart Library | Demo selection could overstate library authority | Only qualified controlled entries apply, method eligibility is checked, and requested confidence cannot exceed library confidence |
| Pricing | Unknown market, terms, or library identifiers could be normalized silently | Controlled master data is seeded deterministically, grading/pricing decisions retain command lineage, and unknown references fail closed |
| Funding | Funding authority and execution were not structurally separated | Funding advances require an authorized approver distinct from the executor; both are stored with the ledger source |
| Ledger | Critical financial history relied mainly on application discipline | Positive amounts, operational references, separation of duty, and append-only database triggers enforce the covered ledger history |
| Settlement | Finalization could be represented without the complete controlled sequence or direct command lineage | Settlement creation requires a known queue, positive values, final assay, the ordered operator sequence, then system-derived variance and invoice steps; creation, controls, finalization, and invoice records retain source-command foreign keys |
| Reconciliation | Case transitions and actions relied on application-layer origin reconstruction | Open, action, investigation, and closure records retain direct command lineage; database guards reject skipped transitions and closure without rationale or a close command |
| Database history | Several truth-bearing tables remained mutable by direct SQL | Update/delete protection covers command identity/dependencies, evidence, custody links/events, grading, samples, pricing decisions, hedge openings, ledger/corrections, settlement steps, invoices, receipts, mass measurements, and finalized settlements |
| Projections | Incremental state relied on the latest timestamp and UI sync statuses were synthetic | Workers checkpoint a transaction-state fingerprint with deterministic ordering; rebuilds use a repeatable-read snapshot; replication UI reads stored outbox and receipt state |
| API boundary | Mutation routes could run without an explicit authorization posture | Mutations fail closed without a bearer token, with a named isolated-demo bypass; CORS, rate limits, body limits, security headers, readiness, and generic 500 responses were added |
| Demo coherence | Random IDs and command timestamps made comparisons noisy | Controlled sites, accounts, library entries, market snapshots, terms, actors, IDs, and source-data timestamps are deterministic; rebuild time remains honest operational metadata |
| Detail interaction | Truth detail feedback was delayed and close had no transition state | Open feedback begins on pointer intent, requests are abortable and retryable, close has immediate feedback, and focus returns to the invoker |
| Accessibility | Navigation, tables, dialogs, and search lacked several keyboard semantics | Skip navigation, mobile navigation, labeled scroll regions, sticky headers, dialog focus trapping, Escape close, inert background, and combobox keyboard handling were added |
| Narrow layout | Dense tables and action columns were fragile on small screens | Stable action columns, two-axis table scrolling, compact metrics, responsive spacing, and mobile navigation preserve trace/detail access |
| Toolchain | Lint was not a real gate and package manager metadata disagreed with CI | ESLint now runs with zero warnings; npm and Node 22 are the documented and CI toolchain; dependency auditing is gated |
| Public claims | Documentation described generic replay and historical state-at-time behavior not implemented here | Claims now distinguish proof-chain reconstruction, projection rebuild, and receiver idempotency from full event-store replay |

## Verification coverage

The automated gate covers type checking, lint, build, integration flow, API mutation authorization, state-transition audit, guarantee scans, migrations, projection materialization, idempotency, deferred dependency application, receiver deduplication, site-level sync evidence, append-only triggers, funding separation of duty, direct financial/correction lineage, and settlement sequence enforcement.

The reviewer artifact workflow additionally verifies evidence-critical operator routes, a clean browser console, successful truth-detail retrieval, and visible Detail and Trace actions at a 390-pixel viewport. It emits exactly 15 deterministic screenshots.

## Intentionally abstracted

- real customer, counterparty, assay, pricing, and settlement data
- proprietary calculation constants and operating procedures
- production identity provider and fine-grained authorization service
- physical multi-node transport, external message broker, and object storage
- cryptographic device attestation and external timestamp authority
- production telemetry, alert routing, backup, disaster recovery, and high availability
- generic event-store replay and arbitrary historical state-at-time queries

## Known dependency advisory

The supported-runtime dependency gate reports two moderate PostCSS advisories nested under the current stable Next.js release. No high or critical advisory remains in that runtime surface. The operator web does not use Next.js image optimization and explicitly disables it, so the gate omits optional dependencies rather than treating the unused Sharp package as deployed functionality. npm currently offers only unsafe forced downgrade paths for the remaining nested advisory, so the CI gate records the risk and Dependabot watches for compatible upstream resolutions.

## Recommended production follow-up

1. Bind command authorization to an external identity provider with scoped service and operator claims.
2. Exercise migrations against a production-shaped clone, including rollback and legacy-row exception reporting.
3. Add concurrency, retry-storm, network-partition, and sustained-load testing around command and receiver locks.
4. Connect outbox streams to a real transport adapter and verify acknowledgement semantics across separate database nodes.
5. Add OpenTelemetry traces, structured security events, service-level objectives, and operator alert routing.
6. Add automated accessibility scans and tablet-specific visual coverage; the current reviewer workflow covers desktop views, the truth dialog, and narrow mobile action access.
7. Define retention, archival, legal-hold, encryption-key rotation, backup, and recovery objectives.
8. Version projection schemas and rehearse blue/green projection rebuilds before deployment use.
9. Implement controlled hedge application and close commands before representing hedge execution as complete lifecycle coverage.

These are deployment-program concerns. Their abstraction here is deliberate and prevents this public reference from implying a production operating environment.
