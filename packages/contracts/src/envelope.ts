import { z } from "zod";
import { dependencyRefSchema, idSchema, isoDateTimeSchema, originSchema } from "./common";

export const transactionEnvelopeSchema = z.object({
  transactionId: idSchema,
  eventType: z.string().min(1).max(128),
  origin: originSchema,
  payload: z.record(z.string(), z.unknown()),
  dependencies: z.array(dependencyRefSchema),
  createdAt: isoDateTimeSchema,
  idempotencyKey: z.string().min(8).max(128),
});

export type TransactionEnvelopeDto = z.infer<typeof transactionEnvelopeSchema>;
