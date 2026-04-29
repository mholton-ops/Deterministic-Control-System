# ALIGN Gap Closure Notes

Source reviewed: `ALIGN!.docx` in the repository base directory.

This app demonstrates implemented control surfaces and API projections using deterministic synthetic data. It does not represent production deployment, real customer data, or proprietary internals.

## Added Or Strengthened

- Replication / Sync route at `/replication`
  - Supports ALIGN Section 3 replication emphasis.
  - Shows local transaction creation, local persistence, outbound queue state, transmission state, receiver validation, dependency checks, idempotent apply, acknowledgement, image stream vs record stream, projection replay, last sync by site, and dependency-blocked movement.
  - API fixture: `data/replication-sync.json`
  - Remains a public abstraction. It does not expose production topology, node details, or infrastructure internals.

- Smart Library detail on `/grading`
  - Supports ALIGN Section 6 grading and Smart Library authority.
  - Shows match method, match hierarchy, artifact reference, physical characteristics, dimensional attributes, assay history, pricing history, qualification status, override history, final assay feedback loop, and library refinement note.
  - API fixture: `data/smart-library-detail.json`
  - Explicitly keeps final valuation authority outside the field buyer role.

- Funding / Money Control detail on `/finance-ledger`
  - Supports ALIGN Section 9 ledger, funding, and financial movement control.
  - Shows funding advance, approving actor, executing actor, buyer or site balance, linked purchases, linked boxes/queues, provisional vs finalized state, offsetting corrections, separation of duty, evidence/notes requirement, and ledger source references.
  - API fixture: `data/funding-control.json`
  - Keeps money tied to material state, valuation confidence, and settlement truth.

- Synthetic/demo framing and Truth Graph definition
  - Shell now states: Deterministic demo data. Public abstraction of the ALIGN control model.
  - Truth graph is defined as the connected chain of evidence, custody state, valuation state, ledger movement, and settlement outcome behind a record.

## Intentionally Abstracted

- Production deployment topology
- Real customer, buyer, partner, or account data
- Proprietary Smart Library internals
- Private pricing and trade parameters
- Live replication infrastructure health
- Authentication, authorization, and compliance policy hardening

## Synthetic / Demo Only

- Retry, failed, and dependency-blocked replication movement states are deterministic demo statuses.
- Smart Library dimensions and refinement notes are public-safe deterministic evidence, not proprietary catalog data.
- Funding balances and actor labels are deterministic control evidence, not real accounting records.
