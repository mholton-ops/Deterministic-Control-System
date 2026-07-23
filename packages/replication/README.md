# Replication Package

Owns dependency-aware, idempotent deterministic transaction application behavior.

Implemented controls:
- command intent, dependencies, outbox streams, and domain effects commit atomically
- deterministic transaction identity and payload checksums prevent ambiguous key reuse
- unknown or unresolved dependencies remain `awaiting_validation`
- controlled resume revalidates dependencies and origin before one-time application
- record and image streams carry independent checksums and acknowledgement state
- receiver receipts enforce idempotency per transaction, target, and stream
- transient transport failure records attempts, retry timing, and failure reason
- failed domain commands are not reclassified as transport retries

The public implementation models replication mechanics in one PostgreSQL control plane. Physical multi-node networking, external brokers, and production identity infrastructure remain abstracted.
