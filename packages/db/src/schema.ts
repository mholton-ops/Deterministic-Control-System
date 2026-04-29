import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  decimal,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const sourceSystemEnum = pgEnum("source_system", [
  "field_client",
  "server",
  "operator_console",
]);

export const evidenceTypeEnum = pgEnum("evidence_type", ["image", "note", "gps", "video", "document"]);
export const transactionStatusEnum = pgEnum("transaction_status", [
  "pending",
  "awaiting_validation",
  "applied",
  "confirmed",
  "failed",
]);

export const converterStateEnum = pgEnum("converter_state", [
  "captured",
  "boxed",
  "queued",
  "in_transit",
  "received",
  "processing",
  "sampled",
  "settled",
]);

export const boxStateEnum = pgEnum("box_state", ["empty", "active", "closed", "shipped", "received", "retired"]);
export const queueStateEnum = pgEnum("queue_state", [
  "open",
  "processing",
  "sampled",
  "assay_pending",
  "valued",
  "settled",
]);

export const shipmentStateEnum = pgEnum("shipment_state", [
  "prepared",
  "in_transit",
  "received",
  "discrepant",
  "closed",
]);

export const identificationMethodEnum = pgEnum("identification_method", [
  "vin",
  "serial",
  "library_match",
  "category_fallback",
]);

export const confidenceBandEnum = pgEnum("confidence_band", ["high", "medium", "low"]);

export const sampleSourceEnum = pgEnum("sample_source", ["internal_xrf", "external_xrf", "icp_final"]);
export const accountTypeEnum = pgEnum("account_type", ["buyer", "warehouse", "bank", "customer", "internal"]);
export const ledgerPurposeEnum = pgEnum("ledger_purpose", [
  "funding_advance",
  "field_purchase",
  "deposit",
  "settlement_payout",
  "adjustment",
  "wire",
]);

export const hedgeLayerEnum = pgEnum("hedge_layer", ["internal", "external"]);
export const hedgeStatusEnum = pgEnum("hedge_status", ["open", "partially_applied", "closed"]);
export const settlementStatusEnum = pgEnum("settlement_status", ["draft", "validated", "finalized"]);

export const reconciliationSeverityEnum = pgEnum("reconciliation_severity", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const reconciliationStatusEnum = pgEnum("reconciliation_status", [
  "open",
  "investigating",
  "resolved",
  "accepted_variance",
]);

export const scopeTypeEnum = pgEnum("scope_type", ["queue", "lot", "shipment", "ledger", "material_group"]);

export const users = pgTable(
  "users",
  {
    userId: uuid("user_id").primaryKey().defaultRandom(),
    externalRef: varchar("external_ref", { length: 64 }).notNull().unique(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    role: varchar("role", { length: 64 }).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("users_role_idx").on(table.role)],
);

export const devices = pgTable(
  "devices",
  {
    deviceId: uuid("device_id").primaryKey().defaultRandom(),
    externalRef: varchar("external_ref", { length: 64 }).notNull().unique(),
    assignedUserId: uuid("assigned_user_id").references(() => users.userId),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("devices_assigned_user_idx").on(table.assignedUserId)],
);

export const sites = pgTable("sites", {
  siteId: uuid("site_id").primaryKey().defaultRandom(),
  siteCode: varchar("site_code", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  siteType: varchar("site_type", { length: 32 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const evidenceBundles = pgTable("evidence_bundles", {
  evidenceBundleId: uuid("evidence_bundle_id").primaryKey().defaultRandom(),
  createdByUserId: uuid("created_by_user_id")
    .notNull()
    .references(() => users.userId),
  createdByDeviceId: uuid("created_by_device_id")
    .notNull()
    .references(() => devices.deviceId),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  gpsLat: numeric("gps_lat", { precision: 9, scale: 6 }).notNull(),
  gpsLon: numeric("gps_lon", { precision: 9, scale: 6 }).notNull(),
  gpsAccuracyM: decimal("gps_accuracy_m", { precision: 8, scale: 3 }).notNull(),
});

export const evidenceArtifacts = pgTable(
  "evidence_artifacts",
  {
    artifactId: uuid("artifact_id").primaryKey().defaultRandom(),
    evidenceBundleId: uuid("evidence_bundle_id")
      .notNull()
      .references(() => evidenceBundles.evidenceBundleId),
    evidenceType: evidenceTypeEnum("evidence_type").notNull(),
    uri: text("uri").notNull(),
    sha256: varchar("sha256", { length: 64 }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("evidence_artifacts_bundle_idx").on(table.evidenceBundleId),
    index("evidence_artifacts_type_idx").on(table.evidenceType),
  ],
);

export const transactionEnvelopes = pgTable(
  "transaction_envelopes",
  {
    transactionId: uuid("transaction_id").primaryKey().defaultRandom(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    sourceSystem: sourceSystemEnum("source_system").notNull(),
    originUserId: uuid("origin_user_id")
      .notNull()
      .references(() => users.userId),
    originDeviceId: uuid("origin_device_id")
      .notNull()
      .references(() => devices.deviceId),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    validationState: transactionStatusEnum("validation_state").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("transaction_envelopes_idempotency_uq").on(table.idempotencyKey),
    index("transaction_envelopes_event_type_idx").on(table.eventType),
    index("transaction_envelopes_created_at_idx").on(table.createdAt),
  ],
);

export const transactionDependencies = pgTable(
  "transaction_dependencies",
  {
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactionEnvelopes.transactionId),
    dependencyEntityType: varchar("dependency_entity_type", { length: 64 }).notNull(),
    dependencyEntityId: varchar("dependency_entity_id", { length: 64 }).notNull(),
    requiredState: varchar("required_state", { length: 64 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.transactionId, table.dependencyEntityType, table.dependencyEntityId] })],
);

export const replicationQueue = pgTable(
  "replication_queue",
  {
    replicationQueueId: bigint("replication_queue_id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactionEnvelopes.transactionId),
    targetNode: varchar("target_node", { length: 64 }).notNull(),
    status: transactionStatusEnum("status").notNull().default("pending"),
    lastError: text("last_error"),
    retryCount: integer("retry_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("replication_queue_status_idx").on(table.status)],
);

export const converters = pgTable(
  "converters",
  {
    converterId: uuid("converter_id").primaryKey().defaultRandom(),
    state: converterStateEnum("state").notNull().default("captured"),
    originTransactionId: uuid("origin_transaction_id")
      .notNull()
      .references(() => transactionEnvelopes.transactionId),
    evidenceBundleId: uuid("evidence_bundle_id")
      .notNull()
      .references(() => evidenceBundles.evidenceBundleId),
    currentBoxId: uuid("current_box_id"),
    vinOrSerial: varchar("vin_or_serial", { length: 64 }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    capturedSiteId: uuid("captured_site_id")
      .notNull()
      .references(() => sites.siteId),
  },
  (table) => [index("converters_state_idx").on(table.state)],
);

export const boxes = pgTable(
  "boxes",
  {
    boxId: uuid("box_id").primaryKey().defaultRandom(),
    externalCode: varchar("external_code", { length: 64 }).notNull().unique(),
    materialType: varchar("material_type", { length: 64 }).notNull(),
    state: boxStateEnum("state").notNull().default("empty"),
    createdByTransactionId: uuid("created_by_transaction_id")
      .notNull()
      .references(() => transactionEnvelopes.transactionId),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("boxes_state_idx").on(table.state)],
);

export const boxConverters = pgTable(
  "box_converters",
  {
    boxId: uuid("box_id")
      .notNull()
      .references(() => boxes.boxId),
    converterId: uuid("converter_id")
      .notNull()
      .references(() => converters.converterId),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    assignedByTransactionId: uuid("assigned_by_transaction_id")
      .notNull()
      .references(() => transactionEnvelopes.transactionId),
  },
  (table) => [primaryKey({ columns: [table.boxId, table.converterId] })],
);

export const queues = pgTable(
  "queues",
  {
    queueId: uuid("queue_id").primaryKey().defaultRandom(),
    queueCode: varchar("queue_code", { length: 64 }).notNull().unique(),
    state: queueStateEnum("state").notNull().default("open"),
    lockedForProcessing: boolean("locked_for_processing").notNull().default(false),
    estimatedValueUsd: decimal("estimated_value_usd", { precision: 14, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("queues_state_idx").on(table.state)],
);

export const queueBoxes = pgTable(
  "queue_boxes",
  {
    queueId: uuid("queue_id")
      .notNull()
      .references(() => queues.queueId),
    boxId: uuid("box_id")
      .notNull()
      .references(() => boxes.boxId),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    assignedByTransactionId: uuid("assigned_by_transaction_id")
      .notNull()
      .references(() => transactionEnvelopes.transactionId),
  },
  (table) => [primaryKey({ columns: [table.queueId, table.boxId] })],
);

export const shipments = pgTable(
  "shipments",
  {
    shipmentId: uuid("shipment_id").primaryKey().defaultRandom(),
    shipmentCode: varchar("shipment_code", { length: 64 }).notNull().unique(),
    state: shipmentStateEnum("state").notNull().default("prepared"),
    originSiteId: uuid("origin_site_id")
      .notNull()
      .references(() => sites.siteId),
    destinationSiteId: uuid("destination_site_id")
      .notNull()
      .references(() => sites.siteId),
    departedAt: timestamp("departed_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
  },
  (table) => [index("shipments_state_idx").on(table.state)],
);

export const shipmentBoxes = pgTable(
  "shipment_boxes",
  {
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.shipmentId),
    boxId: uuid("box_id")
      .notNull()
      .references(() => boxes.boxId),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.shipmentId, table.boxId] })],
);

export const custodyEvents = pgTable(
  "custody_events",
  {
    custodyEventId: uuid("custody_event_id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactionEnvelopes.transactionId),
    scopeType: scopeTypeEnum("scope_type").notNull(),
    scopeId: varchar("scope_id", { length: 64 }).notNull(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    evidenceBundleId: uuid("evidence_bundle_id")
      .notNull()
      .references(() => evidenceBundles.evidenceBundleId),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("custody_events_scope_idx").on(table.scopeType, table.scopeId)],
);

export const massMeasurements = pgTable(
  "mass_measurements",
  {
    massMeasurementId: uuid("mass_measurement_id").primaryKey().defaultRandom(),
    queueId: uuid("queue_id")
      .notNull()
      .references(() => queues.queueId),
    stage: varchar("stage", { length: 32 }).notNull(),
    inputWeightKg: decimal("input_weight_kg", { precision: 12, scale: 3 }).notNull(),
    outputWeightKg: decimal("output_weight_kg", { precision: 12, scale: 3 }).notNull(),
    explainedLossKg: decimal("explained_loss_kg", { precision: 12, scale: 3 }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("mass_measurements_queue_idx").on(table.queueId)],
);

export const libraryEntries = pgTable(
  "library_entries",
  {
    libraryEntryId: uuid("library_entry_id").primaryKey().defaultRandom(),
    qualificationStatus: varchar("qualification_status", { length: 32 }).notNull(),
    vinPattern: varchar("vin_pattern", { length: 32 }),
    serialPattern: varchar("serial_pattern", { length: 64 }),
    morphologicalSignature: jsonb("morphological_signature").$type<Record<string, unknown>>().notNull(),
    confidenceBand: confidenceBandEnum("confidence_band").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("library_entries_confidence_idx").on(table.confidenceBand)],
);

export const gradingDecisions = pgTable(
  "grading_decisions",
  {
    gradingDecisionId: uuid("grading_decision_id").primaryKey().defaultRandom(),
    converterId: uuid("converter_id")
      .notNull()
      .references(() => converters.converterId),
    libraryEntryId: uuid("library_entry_id")
      .notNull()
      .references(() => libraryEntries.libraryEntryId),
    method: identificationMethodEnum("method").notNull(),
    confidenceBand: confidenceBandEnum("confidence_band").notNull(),
    estimatedValueUsd: decimal("estimated_value_usd", { precision: 14, scale: 2 }).notNull(),
    overridden: boolean("overridden").notNull().default(false),
    overrideReason: text("override_reason"),
    decidedByUserId: uuid("decided_by_user_id")
      .notNull()
      .references(() => users.userId),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("grading_decisions_converter_idx").on(table.converterId)],
);

export const correctionMatrices = pgTable(
  "correction_matrices",
  {
    matrixId: uuid("matrix_id").primaryKey().defaultRandom(),
    materialFingerprint: varchar("material_fingerprint", { length: 128 }).notNull(),
    qualificationStatus: varchar("qualification_status", { length: 32 }).notNull(),
    ptMultiplier: decimal("pt_multiplier", { precision: 12, scale: 6 }).notNull(),
    pdMultiplier: decimal("pd_multiplier", { precision: 12, scale: 6 }).notNull(),
    rhMultiplier: decimal("rh_multiplier", { precision: 12, scale: 6 }).notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("correction_matrices_fingerprint_version_uq").on(table.materialFingerprint, table.version)],
);

export const samples = pgTable(
  "samples",
  {
    sampleId: uuid("sample_id").primaryKey().defaultRandom(),
    queueId: uuid("queue_id")
      .notNull()
      .references(() => queues.queueId),
    source: sampleSourceEnum("source").notNull(),
    matrixId: uuid("matrix_id").references(() => correctionMatrices.matrixId),
    ptPpmRaw: decimal("pt_ppm_raw", { precision: 14, scale: 4 }).notNull(),
    pdPpmRaw: decimal("pd_ppm_raw", { precision: 14, scale: 4 }).notNull(),
    rhPpmRaw: decimal("rh_ppm_raw", { precision: 14, scale: 4 }).notNull(),
    ptPpmCorrected: decimal("pt_ppm_corrected", { precision: 14, scale: 4 }),
    pdPpmCorrected: decimal("pd_ppm_corrected", { precision: 14, scale: 4 }),
    rhPpmCorrected: decimal("rh_ppm_corrected", { precision: 14, scale: 4 }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("samples_queue_source_idx").on(table.queueId, table.source)],
);

export const marketSnapshots = pgTable(
  "market_snapshots",
  {
    marketSnapshotId: uuid("market_snapshot_id").primaryKey().defaultRandom(),
    ptUsdPerOz: decimal("pt_usd_per_oz", { precision: 12, scale: 4 }).notNull(),
    pdUsdPerOz: decimal("pd_usd_per_oz", { precision: 12, scale: 4 }).notNull(),
    rhUsdPerOz: decimal("rh_usd_per_oz", { precision: 12, scale: 4 }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("market_snapshots_captured_at_idx").on(table.capturedAt)],
);

export const termsProfiles = pgTable("terms_profiles", {
  termsProfileId: uuid("terms_profile_id").primaryKey().defaultRandom(),
  customerAccountId: uuid("customer_account_id").notNull(),
  payoutFactor: decimal("payout_factor", { precision: 8, scale: 4 }).notNull(),
  processingChargeUsd: decimal("processing_charge_usd", { precision: 12, scale: 2 }).notNull(),
  treatmentChargeUsd: decimal("treatment_charge_usd", { precision: 12, scale: 2 }).notNull(),
  activeFrom: timestamp("active_from", { withTimezone: true }).notNull(),
  activeTo: timestamp("active_to", { withTimezone: true }),
});

export const pricingDecisions = pgTable(
  "pricing_decisions",
  {
    pricingDecisionId: uuid("pricing_decision_id").primaryKey().defaultRandom(),
    queueId: uuid("queue_id")
      .notNull()
      .references(() => queues.queueId),
    marketSnapshotId: uuid("market_snapshot_id")
      .notNull()
      .references(() => marketSnapshots.marketSnapshotId),
    termsProfileId: uuid("terms_profile_id")
      .notNull()
      .references(() => termsProfiles.termsProfileId),
    sourceMethod: identificationMethodEnum("source_method").notNull(),
    estimateUsd: decimal("estimate_usd", { precision: 14, scale: 2 }).notNull(),
    confidenceBand: confidenceBandEnum("confidence_band").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("pricing_decisions_queue_idx").on(table.queueId)],
);

export const accounts = pgTable(
  "accounts",
  {
    accountId: uuid("account_id").primaryKey().defaultRandom(),
    accountCode: varchar("account_code", { length: 64 }).notNull().unique(),
    accountType: accountTypeEnum("account_type").notNull(),
    ownerRef: varchar("owner_ref", { length: 64 }).notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("accounts_type_idx").on(table.accountType)],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    ledgerEntryId: uuid("ledger_entry_id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactionEnvelopes.transactionId),
    debitAccountId: uuid("debit_account_id")
      .notNull()
      .references(() => accounts.accountId),
    creditAccountId: uuid("credit_account_id")
      .notNull()
      .references(() => accounts.accountId),
    purposeCode: ledgerPurposeEnum("purpose_code").notNull(),
    amountUsd: decimal("amount_usd", { precision: 14, scale: 2 }).notNull(),
    sourceOperationalRef: varchar("source_operational_ref", { length: 128 }).notNull(),
    evidenceBundleId: uuid("evidence_bundle_id")
      .notNull()
      .references(() => evidenceBundles.evidenceBundleId),
    notes: text("notes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("ledger_entries_distinct_accounts_chk", sql`${table.debitAccountId} <> ${table.creditAccountId}`),
    index("ledger_entries_source_ref_idx").on(table.sourceOperationalRef),
  ],
);

export const ledgerCorrections = pgTable(
  "ledger_corrections",
  {
    correctionId: uuid("correction_id").primaryKey().defaultRandom(),
    targetLedgerEntryId: uuid("target_ledger_entry_id")
      .notNull()
      .references(() => ledgerEntries.ledgerEntryId),
    correctionLedgerEntryId: uuid("correction_ledger_entry_id")
      .notNull()
      .references(() => ledgerEntries.ledgerEntryId),
    reasonCode: varchar("reason_code", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("ledger_corrections_entry_uq").on(table.correctionLedgerEntryId)],
);

export const hedgePositions = pgTable(
  "hedge_positions",
  {
    hedgePositionId: uuid("hedge_position_id").primaryKey().defaultRandom(),
    layer: hedgeLayerEnum("layer").notNull(),
    scopeType: scopeTypeEnum("scope_type").notNull(),
    scopeId: varchar("scope_id", { length: 64 }).notNull(),
    hedgedPtOz: decimal("hedged_pt_oz", { precision: 14, scale: 6 }).notNull(),
    hedgedPdOz: decimal("hedged_pd_oz", { precision: 14, scale: 6 }).notNull(),
    hedgedRhOz: decimal("hedged_rh_oz", { precision: 14, scale: 6 }).notNull(),
    status: hedgeStatusEnum("status").notNull().default("open"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [index("hedge_positions_scope_idx").on(table.scopeType, table.scopeId)],
);

export const hedgeApplications = pgTable(
  "hedge_applications",
  {
    hedgeApplicationId: uuid("hedge_application_id").primaryKey().defaultRandom(),
    hedgePositionId: uuid("hedge_position_id")
      .notNull()
      .references(() => hedgePositions.hedgePositionId),
    settlementId: uuid("settlement_id"),
    appliedRatio: decimal("applied_ratio", { precision: 6, scale: 4 }).notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("hedge_applications_ratio_chk", sql`${table.appliedRatio} > 0 and ${table.appliedRatio} <= 1`)],
);

export const settlements = pgTable(
  "settlements",
  {
    settlementId: uuid("settlement_id").primaryKey().defaultRandom(),
    scopeType: scopeTypeEnum("scope_type").notNull(),
    scopeId: varchar("scope_id", { length: 64 }).notNull(),
    status: settlementStatusEnum("status").notNull().default("draft"),
    estimatedValueUsd: decimal("estimated_value_usd", { precision: 14, scale: 2 }).notNull(),
    finalValueUsd: decimal("final_value_usd", { precision: 14, scale: 2 }),
    varianceUsd: decimal("variance_usd", { precision: 14, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  },
  (table) => [index("settlements_scope_idx").on(table.scopeType, table.scopeId)],
);

export const settlementSteps = pgTable(
  "settlement_steps",
  {
    settlementStepId: uuid("settlement_step_id").primaryKey().defaultRandom(),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => settlements.settlementId),
    stepOrder: integer("step_order").notNull(),
    stepName: varchar("step_name", { length: 64 }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    recordedByUserId: uuid("recorded_by_user_id")
      .notNull()
      .references(() => users.userId),
  },
  (table) => [uniqueIndex("settlement_steps_order_uq").on(table.settlementId, table.stepOrder)],
);

export const invoices = pgTable(
  "invoices",
  {
    invoiceId: uuid("invoice_id").primaryKey().defaultRandom(),
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => settlements.settlementId),
    invoiceNumber: varchar("invoice_number", { length: 64 }).notNull().unique(),
    status: varchar("status", { length: 16 }).notNull().default("final"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    immutable: boolean("immutable").notNull().default(true),
  },
  (table) => [check("invoices_immutable_chk", sql`${table.immutable} = true`)],
);

export const invoiceLines = pgTable(
  "invoice_lines",
  {
    invoiceLineId: uuid("invoice_line_id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.invoiceId),
    lineType: varchar("line_type", { length: 64 }).notNull(),
    description: text("description").notNull(),
    amountUsd: decimal("amount_usd", { precision: 14, scale: 2 }).notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [uniqueIndex("invoice_lines_sort_order_uq").on(table.invoiceId, table.sortOrder)],
);

export const reconciliationCases = pgTable(
  "reconciliation_cases",
  {
    reconciliationCaseId: uuid("reconciliation_case_id").primaryKey().defaultRandom(),
    triggerType: varchar("trigger_type", { length: 64 }).notNull(),
    severity: reconciliationSeverityEnum("severity").notNull(),
    status: reconciliationStatusEnum("status").notNull().default("open"),
    scopeType: scopeTypeEnum("scope_type").notNull(),
    scopeId: varchar("scope_id", { length: 64 }).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closureRationale: text("closure_rationale"),
  },
  (table) => [index("reconciliation_cases_status_idx").on(table.status)],
);

export const reconciliationActions = pgTable(
  "reconciliation_actions",
  {
    reconciliationActionId: uuid("reconciliation_action_id").primaryKey().defaultRandom(),
    reconciliationCaseId: uuid("reconciliation_case_id")
      .notNull()
      .references(() => reconciliationCases.reconciliationCaseId),
    actionType: varchar("action_type", { length: 64 }).notNull(),
    actionPayload: jsonb("action_payload").$type<Record<string, unknown>>().notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.userId),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("reconciliation_actions_case_idx").on(table.reconciliationCaseId)],
);

export const projectionOperationsOverview = pgTable(
  "projection_operations_overview",
  {
    projectionKey: varchar("projection_key", { length: 32 }).primaryKey(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    queueCount: integer("queue_count").notNull(),
    openReconciliationCount: integer("open_reconciliation_count").notNull(),
    totalEstimatedQueueValueUsd: decimal("total_estimated_queue_value_usd", {
      precision: 16,
      scale: 2,
    }).notNull(),
    convertersByState: jsonb("converters_by_state").$type<Record<string, number>>().notNull(),
  },
  (table) => [check("projection_operations_overview_key_chk", sql`${table.projectionKey} = 'global'`)],
);

export const projectionQueueExposure = pgTable(
  "projection_queue_exposure",
  {
    queueId: uuid("queue_id")
      .notNull()
      .references(() => queues.queueId)
      .primaryKey(),
    queueCode: varchar("queue_code", { length: 64 }).notNull(),
    queueState: queueStateEnum("queue_state").notNull(),
    estimatedValueUsd: decimal("estimated_value_usd", { precision: 14, scale: 2 }),
    avgPtPpmCorrected: decimal("avg_pt_ppm_corrected", { precision: 16, scale: 6 }).notNull(),
    avgPdPpmCorrected: decimal("avg_pd_ppm_corrected", { precision: 16, scale: 6 }).notNull(),
    avgRhPpmCorrected: decimal("avg_rh_ppm_corrected", { precision: 16, scale: 6 }).notNull(),
    hedgedPtOz: decimal("hedged_pt_oz", { precision: 16, scale: 6 }).notNull(),
    hedgedPdOz: decimal("hedged_pd_oz", { precision: 16, scale: 6 }).notNull(),
    hedgedRhOz: decimal("hedged_rh_oz", { precision: 16, scale: 6 }).notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("projection_queue_exposure_state_idx").on(table.queueState)],
);

export const projectionLedgerTrace = pgTable(
  "projection_ledger_trace",
  {
    ledgerEntryId: uuid("ledger_entry_id")
      .notNull()
      .references(() => ledgerEntries.ledgerEntryId)
      .primaryKey(),
    purposeCode: ledgerPurposeEnum("purpose_code").notNull(),
    amountUsd: decimal("amount_usd", { precision: 14, scale: 2 }).notNull(),
    sourceOperationalRef: varchar("source_operational_ref", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("projection_ledger_trace_source_idx").on(table.sourceOperationalRef)],
);

export const projectionWorkbenchViewCache = pgTable("projection_workbench_view_cache", {
  projectionKey: varchar("projection_key", { length: 64 }).primaryKey(),
  payload: jsonb("payload").$type<unknown>().notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
});

export const projectionSettlementDrilldownCache = pgTable(
  "projection_settlement_drilldown_cache",
  {
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => settlements.settlementId)
      .primaryKey(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("projection_settlement_drilldown_generated_idx").on(table.generatedAt)],
);

export const projectionRebuildCheckpoint = pgTable(
  "projection_rebuild_checkpoint",
  {
    checkpointKey: varchar("checkpoint_key", { length: 32 }).primaryKey(),
    lastAppliedAt: timestamp("last_applied_at", { withTimezone: true }),
    lastTransactionId: uuid("last_transaction_id"),
    projectionGeneratedAt: timestamp("projection_generated_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("projection_rebuild_checkpoint_key_chk", sql`${table.checkpointKey} = 'global'`)],
);

export const schema = {
  users,
  devices,
  sites,
  evidenceBundles,
  evidenceArtifacts,
  transactionEnvelopes,
  transactionDependencies,
  replicationQueue,
  converters,
  boxes,
  boxConverters,
  queues,
  queueBoxes,
  shipments,
  shipmentBoxes,
  custodyEvents,
  massMeasurements,
  libraryEntries,
  gradingDecisions,
  correctionMatrices,
  samples,
  marketSnapshots,
  termsProfiles,
  pricingDecisions,
  accounts,
  ledgerEntries,
  ledgerCorrections,
  hedgePositions,
  hedgeApplications,
  settlements,
  settlementSteps,
  invoices,
  invoiceLines,
  reconciliationCases,
  reconciliationActions,
  projectionOperationsOverview,
  projectionQueueExposure,
  projectionLedgerTrace,
  projectionWorkbenchViewCache,
  projectionSettlementDrilldownCache,
  projectionRebuildCheckpoint,
};
