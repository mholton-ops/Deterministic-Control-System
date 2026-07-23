ALTER TABLE "transaction_envelopes" ADD COLUMN "origin_captured_at" timestamp with time zone;--> statement-breakpoint
UPDATE "transaction_envelopes"
SET "origin_captured_at" = "created_at"
WHERE "origin_captured_at" IS NULL;--> statement-breakpoint
ALTER TABLE "transaction_envelopes" ALTER COLUMN "origin_captured_at" SET NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "dcs_protect_transaction_envelope"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'transaction_envelopes is append-only';
  END IF;
  IF NEW."transaction_id" IS DISTINCT FROM OLD."transaction_id"
    OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
    OR NEW."event_type" IS DISTINCT FROM OLD."event_type"
    OR NEW."source_system" IS DISTINCT FROM OLD."source_system"
    OR NEW."origin_user_id" IS DISTINCT FROM OLD."origin_user_id"
    OR NEW."origin_device_id" IS DISTINCT FROM OLD."origin_device_id"
    OR NEW."origin_captured_at" IS DISTINCT FROM OLD."origin_captured_at"
    OR NEW."payload" IS DISTINCT FROM OLD."payload"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'transaction envelope identity and payload are immutable';
  END IF;
  IF NEW."validation_state" IS DISTINCT FROM OLD."validation_state" THEN
    IF NOT (
      (OLD."validation_state" = 'pending' AND NEW."validation_state" IN ('awaiting_validation', 'applied', 'failed'))
      OR (OLD."validation_state" = 'awaiting_validation' AND NEW."validation_state" IN ('applied', 'failed'))
      OR (OLD."validation_state" = 'applied' AND NEW."validation_state" = 'confirmed')
    ) THEN
      RAISE EXCEPTION 'invalid transaction status transition: % -> %', OLD."validation_state", NEW."validation_state";
    END IF;

    IF NEW."validation_state" IN ('applied', 'confirmed') AND NEW."applied_at" IS NULL THEN
      RAISE EXCEPTION 'applied transaction status requires applied_at';
    END IF;
    IF NEW."validation_state" = 'confirmed' AND NEW."confirmed_at" IS NULL THEN
      RAISE EXCEPTION 'confirmed transaction status requires confirmed_at';
    END IF;
    IF NEW."validation_state" = 'failed' AND NULLIF(BTRIM(NEW."failure_reason"), '') IS NULL THEN
      RAISE EXCEPTION 'failed transaction status requires failure_reason';
    END IF;
  ELSIF NEW."applied_at" IS DISTINCT FROM OLD."applied_at"
    OR NEW."confirmed_at" IS DISTINCT FROM OLD."confirmed_at"
    OR NEW."failure_reason" IS DISTINCT FROM OLD."failure_reason" THEN
    RAISE EXCEPTION 'transaction status metadata requires a valid status transition';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "transaction_dependencies_append_only"
BEFORE UPDATE OR DELETE ON "transaction_dependencies"
FOR EACH ROW EXECUTE FUNCTION "dcs_prevent_append_only_mutation"();--> statement-breakpoint
CREATE TRIGGER "evidence_bundles_append_only"
BEFORE UPDATE OR DELETE ON "evidence_bundles"
FOR EACH ROW EXECUTE FUNCTION "dcs_prevent_append_only_mutation"();--> statement-breakpoint
CREATE TRIGGER "box_converters_append_only"
BEFORE UPDATE OR DELETE ON "box_converters"
FOR EACH ROW EXECUTE FUNCTION "dcs_prevent_append_only_mutation"();--> statement-breakpoint
CREATE TRIGGER "queue_boxes_append_only"
BEFORE UPDATE OR DELETE ON "queue_boxes"
FOR EACH ROW EXECUTE FUNCTION "dcs_prevent_append_only_mutation"();--> statement-breakpoint
CREATE TRIGGER "shipment_boxes_append_only"
BEFORE UPDATE OR DELETE ON "shipment_boxes"
FOR EACH ROW EXECUTE FUNCTION "dcs_prevent_append_only_mutation"();--> statement-breakpoint
CREATE TRIGGER "custody_events_append_only"
BEFORE UPDATE OR DELETE ON "custody_events"
FOR EACH ROW EXECUTE FUNCTION "dcs_prevent_append_only_mutation"();--> statement-breakpoint
CREATE TRIGGER "settlement_steps_append_only"
BEFORE UPDATE OR DELETE ON "settlement_steps"
FOR EACH ROW EXECUTE FUNCTION "dcs_prevent_append_only_mutation"();--> statement-breakpoint
CREATE TRIGGER "reconciliation_actions_append_only"
BEFORE UPDATE OR DELETE ON "reconciliation_actions"
FOR EACH ROW EXECUTE FUNCTION "dcs_prevent_append_only_mutation"();
