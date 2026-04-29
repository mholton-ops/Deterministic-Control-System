# API Commands

Base URL: `http://localhost:3001`

## POST `/commands`

Submit one command envelope to the deterministic command processor.

Request shape:

```json
{
  "idempotencyKey": "string-min-8",
  "origin": {
    "sourceSystem": "field_client | server | operator_console",
    "userId": "string",
    "deviceId": "string",
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
- `custody.lock_queue_for_processing`
- `custody.assign_box_to_queue`
- `custody.create_shipment`
- `custody.receive_shipment`
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
- `analytics.record_sample` is rejected unless the target queue has custody-linked material and every linked box is in a milled form (`processed_catalyst`, `dust_recovery`, or equivalent milled aliases).

Implementation references:
- `packages/contracts/src/commands.ts`
- `packages/replication/src/command-processor.ts`
- `apps/api/src/server.ts`
