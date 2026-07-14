# API Commands

Base URL: `http://127.0.0.1:3001`

All mutation routes require `Authorization: Bearer <token>`. Configure the token with `DCS_CONTROL_API_TOKEN`. The explicit `DCS_ALLOW_UNAUTHENTICATED_DEMO=true` bypass is limited to isolated demonstration use.

## POST `/commands`

Submit one command envelope to the deterministic command processor.

Request shape:

```json
{
  "idempotencyKey": "string-min-8",
  "origin": {
    "sourceSystem": "field_client | server | operator_console",
    "userId": "uuid",
    "deviceId": "uuid",
    "capturedAt": "ISO-8601"
  },
  "createdAt": "ISO-8601 (optional)",
  "dependencies": [
    {
      "entityType": "converter | box | queue | settlement | ...",
      "entityId": "string",
      "requiredState": "string"
    }
  ],
  "command": { "commandType": "...", "...": "..." }
}
```

Response shape:

```json
{
  "transactionId": "uuid",
  "status": "duplicate | awaiting_validation | applied",
  "eventType": "commandType",
  "effects": { "...": "..." }
}
```

## Supported command types

- `field.capture_converter`
- `custody.assign_converter_to_box`
- `custody.close_box`
- `custody.lock_queue_for_processing`
- `custody.assign_box_to_queue`
- `custody.create_shipment`
- `custody.receive_shipment`
- `custody.record_event`
- `custody.record_mass_measurement`
- `grading.issue_decision`
- `analytics.record_sample`
- `pricing.resolve_estimate`
- `finance.post_ledger_entry`
- `finance.post_additive_correction`
- `hedge.open_position`
- `settlement.append_step`
- `settlement.finalize_from_assay`
- `reconciliation.open_case`
- `reconciliation.record_action`
- `reconciliation.close_case`

Sampling guard:
- `analytics.record_sample` requires note evidence and is rejected unless the queue is locked for processing, linked material is available rather than in transit, and every linked box is in a milled form (`processed_catalyst`, `dust_recovery`, or equivalent milled aliases).

Control guards:
- origin users and devices must be active, assigned, and authorized for the command source
- queue lock requires custody-linked boxes, and queue membership cannot change after lock
- shipment creation requires closed boxes, and receipt requires in-transit state
- custody and mass observations require transaction and evidence provenance
- grading cannot claim more confidence than its qualified Smart Library entry supports
- funding advances require distinct authorized approving and executing actors
- settlement must reference a known queue and follow the controlled operator sequence before system-derived finalization
- mass observations are rejected after settlement or weight-basis lock
- unknown dependencies, master data, terms, market snapshots, library entries, and financial accounts fail closed

Idempotency behavior:
- an exact repeat returns `duplicate` and does not apply a second effect
- reusing an idempotency key for a different payload returns HTTP 409
- a corrected intent after a failed command requires a new idempotency key

Other protected mutation routes:
- `POST /projections/rebuild`
- `POST /projections/worker/run-once`
- `POST /replication/worker/run-once`
- `POST /replication/:transactionId/retry`

Implementation references:
- `packages/contracts/src/commands.ts`
- `packages/replication/src/command-processor.ts`
- `apps/api/src/server.ts`
