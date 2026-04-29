# ALIGN Evaluation Brief

Generated: 2026-04-29T21:11:59.813Z

## Purpose

This package gives another LLM enough visual and textual evidence to evaluate whether HALDN CONTROL demonstrates the ALIGN control model. It is intentionally limited to 15 files and uses deterministic synthetic data only.

## Core Framing

HALDN CONTROL is an operational control workbench, not a generic dashboard. It shows deterministic state, evidence, custody, valuation, funding, ledger movement, reconciliation, settlement, and controlled customer visibility as connected system surfaces.

Truth graph definition: the connected chain of evidence, custody state, valuation state, ledger movement, and settlement outcome behind a record.

## Implemented Evidence

| ALIGN Requirement Area | App Evidence | Screenshot Evidence | Data Signal |
|---|---|---|---|
| Command surface and control state | Capital, material, risk, chain completeness, aging risk | 01_overview_command_surface.png | chain 377/506, active sites 8 |
| Field origination | Converter capture, origin user/device, evidence proof, GPS/image requirements | 02_field_intake.png | 278 capture rows |
| Replication and sync integrity | Local creation, persistence, outbound queue, transmission, receiver validation, dependency checks, idempotent apply, acknowledgement, replay | 03_replication_sync.png | 120 movement rows, 8 sites, 7 dependency blocked |
| Inventory and custody | Boxes, queues, shipments, locked processing, chain completeness | 04_custody_queues_shipments.png | 46 queues, 96 boxes, 29 shipments |
| Grading and Smart Library | Match hierarchy, confidence, qualification, override history, assay feedback loop | 05_grading_smart_library.png | 188 decisions |
| Analytics and assay matrix | Raw and corrected values, matrix qualification, sample state | 06_analytics_assay_matrix.png | 22 analytical rows |
| Pricing and exposure | Estimates, variance, hedge coverage, ledger linkage | 07_pricing_exposure.png | 46 pricing exposure rows |
| Funding and money control | Advances, approving/executing actor, balances, corrections, source references | 08_finance_funding_control.png | 80 funding control rows, 41 advances |
| Reconciliation | Divergence cases, severity, expected/observed values, financial impact | 09_reconciliation.png | 28 reconciliation rows |
| Settlement lifecycle | Estimate-to-final status, chain completeness, invoices, replayable settlement state | 10_settlements.png | 28 settlement rows |
| Customer controlled visibility | Filtered inventory/value/proof/report state without internal mutation authority | 11_customer_visibility.png | 46 visible inventory units |
| Entity truth detail | Detail panel ties record identity to origin, evidence, dependencies, value, and financial links | 12_truth_detail_panel.png | representative converter d8e19446-d8e8-485c-8008-01371c0f7ab6 |

## What Remains Abstracted

- Production deployment topology
- Real customers, buyers, partners, accounts, and files
- Proprietary Smart Library internals
- Private pricing formulas and trade parameters
- Authentication, permissions, and compliance hardening
- Live replication infrastructure health

## Evaluator Notes

Look for whether the app makes control relationships inspectable. The strongest evidence is not the existence of tables alone, but that operational state, evidence, money, valuation, and settlement remain connected through trace/detail surfaces and API-backed projections.
