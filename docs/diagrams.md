# Architecture Diagrams

These diagrams are public-safe abstractions of the deterministic control platform.
They are intended to clarify control flow, not to expose proprietary implementation details.
Mermaid source files are versioned under `docs/diagrams/*.mmd`.

## 1) Control Plane Topology

```mermaid
flowchart LR
  subgraph F[Field Origination]
    FC[Field Capture Device]
    EV[Evidence Bundle<br/>image + geo + device]
  end

  subgraph C[Control Plane]
    API[Fastify Command API]
    CP[Deterministic Command Processor]
    EL[(Append-Only Transaction Log)]
    ST[(Operational State Tables)]
    FIN[(Financial Ledger Tables)]
  end

  subgraph R[Read and Operator Plane]
    PJ[Projection Materializer]
    WB[Operator Workbench UI]
    AUD[Audit and Evidence Explorer]
  end

  FC --> API
  EV --> API
  API --> CP
  CP --> EL
  CP --> ST
  CP --> FIN
  EL --> PJ
  ST --> PJ
  FIN --> PJ
  PJ --> WB
  PJ --> AUD
  WB --> API
```

## 2) Field-to-Settlement Control Flow

```mermaid
flowchart TD
  C1[field.capture_converter] --> C2[custody.assign_converter_to_box]
  C2 --> C3[custody.lock_queue_for_processing]
  C3 --> C4[custody.create_shipment]
  C4 --> C5[custody.receive_shipment]
  C5 --> C6[grading.issue_decision]
  C6 --> C7[analytics.record_sample]
  C7 --> C8[pricing.resolve_estimate]
  C8 --> C9[finance.post_ledger_entry]
  C9 --> C10[hedge.open_position]
  C10 --> C11[reconciliation.open_case]
  C11 --> C12[reconciliation.record_action]
  C12 --> C13[finance.post_additive_correction]
  C13 --> C14[settlement.finalize_from_assay]
  C14 --> C15[reconciliation.close_case]

  C1 -. requires .-> G1[Evidence + Origin Provenance]
  C8 -. constrained by .-> G2[Pricing Confidence Hierarchy]
  C9 -. enforces .-> G3[Operational Ref on Every Dollar]
  C14 -. outputs .-> G4[Immutable Invoice + Variance]
```

## 3) Divergence and Reconciliation Loop

```mermaid
sequenceDiagram
  autonumber
  participant OP as Operator
  participant API as Control API
  participant PROC as Command Processor
  participant REC as Reconciliation
  participant FIN as Financial Ledger
  participant SET as Settlement

  OP->>API: reconciliation.open_case(trigger, severity, scope)
  API->>PROC: validate + apply
  PROC->>REC: case created (open)

  OP->>API: reconciliation.record_action(action, findings)
  API->>PROC: validate + apply
  PROC->>REC: append action, status -> investigating

  OP->>API: finance.post_additive_correction(delta, targetEntry)
  API->>PROC: validate non-zero delta + linked target
  PROC->>FIN: append correction entry + linkage
  PROC->>REC: append case action (optional link)

  OP->>API: settlement.finalize_from_assay(finalValue)
  API->>PROC: enforce sequence + calculate variance
  PROC->>SET: finalize settlement + immutable invoice

  OP->>API: reconciliation.close_case(resolution)
  API->>PROC: enforce allowed transition
  PROC->>REC: case closed (additive history retained)
```
