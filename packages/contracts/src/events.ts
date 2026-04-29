import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common";

export const eventSchema = z.object({
  eventId: idSchema,
  eventType: z.string().min(1).max(128),
  transactionId: idSchema,
  emittedAt: isoDateTimeSchema,
  payload: z.record(z.string(), z.unknown()),
});

export type EventDto = z.infer<typeof eventSchema>;
