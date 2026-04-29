# Public-Safe Boundary

## Intent

This repository is a clean-room reference that demonstrates architecture and control logic while remaining safe for public release.

## Included

- domain architecture and bounded contexts
- deterministic transaction and replay concepts
- state machines and validation patterns
- placeholder market and assay workflows
- seeded fictional demo data
- operator workflow UI for explainability
- controlled customer visibility UI using filtered synthetic state

## Excluded

- proprietary source code
- confidential customer or partner data
- real customer portal data, credentials, or production entitlements
- sensitive pricing formulas or trade secrets
- private deployment topology details
- real account identifiers, keys, or secrets

## Data policy

- use synthetic, deterministic demo data only
- avoid real company and user identifiers
- avoid realistic but attributable transaction history
- keep all examples clearly fictional
- state clearly that app surfaces are deterministic demonstrations, not production deployment or real customer data

## Language policy

- do not claim exact production parity
- do not present this as the original private platform
- do present this as architecture-faithful and clean-room
- use public abstractions for replication, Smart Library, funding, ledger, and settlement details

## Security posture for public repo

- no plaintext secrets
- sample env files only
- non-sensitive defaults
- explicit warning against production use without hardening

## Review checklist for public-safe compliance

1. No sensitive names, keys, account numbers, or customer artifacts.
2. No proprietary constants or contract rates.
3. No code comments disclosing private operational details.
4. Readme includes clean-room statement.
5. Seed data is synthetic and deterministic.
