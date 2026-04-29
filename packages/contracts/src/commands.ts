import { z } from "zod";
import {
  evidenceRefSchema,
  geoPointSchema,
  idSchema,
  isoDateTimeSchema,
  moneySchema,
} from "./common";

export const fieldCaptureConverterCommandSchema = z.object({
  commandType: z.literal("field.capture_converter"),
  commandId: idSchema,
  yardId: idSchema,
  boxId: idSchema,
  vinOrSerial: z.string().max(32).nullable(),
  capturedAt: isoDateTimeSchema,
  location: geoPointSchema,
  evidence: evidenceRefSchema.refine((value) => value.requiredTypesPresent.includes("image"), {
    message: "field.capture_converter requires image evidence",
  }),
});

export const custodyAssignConverterToBoxCommandSchema = z.object({
  commandType: z.literal("custody.assign_converter_to_box"),
  commandId: idSchema,
  converterId: idSchema,
  boxId: idSchema,
});

export const custodyLockQueueCommandSchema = z.object({
  commandType: z.literal("custody.lock_queue_for_processing"),
  commandId: idSchema,
  queueId: idSchema,
});

export const custodyAssignBoxToQueueCommandSchema = z.object({
  commandType: z.literal("custody.assign_box_to_queue"),
  commandId: idSchema,
  boxId: idSchema,
  queueId: idSchema,
});

export const custodyCreateShipmentCommandSchema = z.object({
  commandType: z.literal("custody.create_shipment"),
  commandId: idSchema,
  shipmentCode: z.string().min(3).max(64),
  originSiteId: idSchema,
  destinationSiteId: idSchema,
  boxCodes: z.array(z.string().min(3).max(64)).min(1),
});

export const custodyReceiveShipmentCommandSchema = z.object({
  commandType: z.literal("custody.receive_shipment"),
  commandId: idSchema,
  shipmentRef: idSchema,
  receivingSiteId: idSchema,
});

export const gradingIssueDecisionCommandSchema = z.object({
  commandType: z.literal("grading.issue_decision"),
  commandId: idSchema,
  converterId: idSchema,
  candidateId: idSchema,
  identificationMethod: z.enum(["vin", "serial", "library_match", "category_fallback"]),
  confidence: z.enum(["high", "medium", "low"]),
  overrideReason: z.string().min(3).max(256).nullable(),
});

export const analyticsRecordSampleCommandSchema = z.object({
  commandType: z.literal("analytics.record_sample"),
  commandId: idSchema,
  queueId: idSchema,
  source: z.enum(["internal_xrf", "external_xrf", "icp_final"]),
  ptPpm: z.number().gte(0),
  pdPpm: z.number().gte(0),
  rhPpm: z.number().gte(0),
  matrixId: idSchema.nullable(),
});

export const pricingResolveEstimateCommandSchema = z.object({
  commandType: z.literal("pricing.resolve_estimate"),
  commandId: idSchema,
  queueId: idSchema,
  marketSnapshotId: idSchema,
  termsProfileId: idSchema,
  sourceCandidates: z.array(z.enum(["vin", "serial", "library_match", "category_fallback"])).min(1),
  attemptedFieldOverride: z.boolean(),
});

export const financePostLedgerEntryCommandSchema = z.object({
  commandType: z.literal("finance.post_ledger_entry"),
  commandId: idSchema,
  debitAccountId: idSchema,
  creditAccountId: idSchema,
  amount: moneySchema,
  purposeCode: z.enum([
    "funding_advance",
    "field_purchase",
    "deposit",
    "settlement_payout",
    "adjustment",
    "wire",
  ]),
  sourceOperationalRef: z.string().min(1).max(128),
  notes: z.string().min(3).max(1000),
  evidence: evidenceRefSchema.refine((value) => value.requiredTypesPresent.includes("note"), {
    message: "finance.post_ledger_entry requires note evidence",
  }),
});

export const financePostAdditiveCorrectionCommandSchema = z.object({
  commandType: z.literal("finance.post_additive_correction"),
  commandId: idSchema,
  targetLedgerEntryId: idSchema,
  reasonCode: z.enum(["estimate_adjustment", "reconciliation", "operator_error"]),
  deltaUsd: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
  notes: z.string().min(3).max(1000),
  reconciliationCaseId: idSchema.nullable().optional(),
  evidence: evidenceRefSchema.refine((value) => value.requiredTypesPresent.includes("note"), {
    message: "finance.post_additive_correction requires note evidence",
  }),
});

export const hedgeOpenPositionCommandSchema = z.object({
  commandType: z.literal("hedge.open_position"),
  commandId: idSchema,
  layer: z.enum(["internal", "external"]),
  scopeType: z.enum(["queue", "lot", "material_group"]),
  scopeId: idSchema,
  hedgedPtOz: z.number().gte(0),
  hedgedPdOz: z.number().gte(0),
  hedgedRhOz: z.number().gte(0),
});

export const settlementAppendStepCommandSchema = z.object({
  commandType: z.literal("settlement.append_step"),
  commandId: idSchema,
  settlementId: idSchema,
  step: z.enum([
    "lot_selected",
    "contents_reviewed",
    "sample_data_recorded",
    "adjustments_recorded",
    "weight_basis_locked",
    "hedges_applied",
    "financial_context_applied",
    "final_value_calculated",
    "invoice_finalized",
  ]),
});

export const settlementFinalizeFromAssayCommandSchema = z.object({
  commandType: z.literal("settlement.finalize_from_assay"),
  commandId: idSchema,
  settlementId: idSchema,
  finalValueUsd: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
});

export const reconciliationOpenCaseCommandSchema = z.object({
  commandType: z.literal("reconciliation.open_case"),
  commandId: idSchema,
  triggerType: z.enum([
    "weight_delta",
    "assay_variance",
    "custody_mismatch",
    "ledger_orphan",
    "sequence_violation",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  relatedScopeType: z.enum(["queue", "lot", "shipment", "ledger"]),
  relatedScopeId: idSchema,
});

export const reconciliationCloseCaseCommandSchema = z.object({
  commandType: z.literal("reconciliation.close_case"),
  commandId: idSchema,
  caseId: idSchema,
  status: z.enum(["resolved", "accepted_variance"]),
  closureRationale: z.string().min(3).max(1000),
});

export const reconciliationRecordActionCommandSchema = z.object({
  commandType: z.literal("reconciliation.record_action"),
  commandId: idSchema,
  caseId: idSchema,
  actionType: z.string().min(3).max(64),
  actionPayload: z.record(z.string(), z.unknown()),
});

export const commandSchema = z.discriminatedUnion("commandType", [
  fieldCaptureConverterCommandSchema,
  custodyAssignConverterToBoxCommandSchema,
  custodyLockQueueCommandSchema,
  custodyAssignBoxToQueueCommandSchema,
  custodyCreateShipmentCommandSchema,
  custodyReceiveShipmentCommandSchema,
  gradingIssueDecisionCommandSchema,
  analyticsRecordSampleCommandSchema,
  pricingResolveEstimateCommandSchema,
  financePostLedgerEntryCommandSchema,
  financePostAdditiveCorrectionCommandSchema,
  hedgeOpenPositionCommandSchema,
  settlementAppendStepCommandSchema,
  settlementFinalizeFromAssayCommandSchema,
  reconciliationOpenCaseCommandSchema,
  reconciliationCloseCaseCommandSchema,
  reconciliationRecordActionCommandSchema,
]);

export type CommandDto = z.infer<typeof commandSchema>;
