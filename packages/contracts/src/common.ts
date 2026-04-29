import { z } from "zod";

export const idSchema = z.string().min(1).max(64);
export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const moneySchema = z.object({
  amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
  currency: z.literal("USD"),
});

export const geoPointSchema = z.object({
  lat: z.number().gte(-90).lte(90),
  lon: z.number().gte(-180).lte(180),
  accuracyM: z.number().gt(0).lte(1000),
});

export const originSchema = z.object({
  sourceSystem: z.enum(["field_client", "server", "operator_console"]),
  userId: idSchema,
  deviceId: idSchema,
  capturedAt: isoDateTimeSchema,
});

export const evidenceTypeSchema = z.enum(["image", "note", "gps", "video", "document"]);
export const truthStatusSchema = z.enum(["estimated", "provisional", "validated", "finalized"]);
export const confidenceLevelSchema = z.enum(["high", "medium", "low", "unknown"]);
export const dependencyStateSchema = z.enum(["complete", "incomplete"]);
export const traceEntityTypeSchema = z.enum([
  "converter",
  "box",
  "queue",
  "shipment",
  "sample",
  "settlement",
  "ledger_entry",
  "reconciliation_case",
]);

export const traceLinkSchema = z.object({
  entityType: traceEntityTypeSchema,
  entityId: idSchema,
});

export const certaintyEnvelopeSchema = z.object({
  truthStatus: truthStatusSchema,
  confidence: confidenceLevelSchema,
  validationStatus: z.string().min(1).max(128),
  dependencyState: dependencyStateSchema,
  trace: traceLinkSchema,
});

export const evidenceRefSchema = z.object({
  evidenceBundleId: idSchema,
  requiredTypesPresent: z.array(evidenceTypeSchema).min(1),
});

export const dependencyRefSchema = z.object({
  entityType: z.string().min(1).max(64),
  entityId: idSchema,
  requiredState: z.string().min(1).max(64),
});
