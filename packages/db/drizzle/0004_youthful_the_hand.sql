CREATE TYPE "public"."replication_stream" AS ENUM('record', 'image');--> statement-breakpoint
CREATE TABLE "replication_receipts" (
	"replication_receipt_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "replication_receipts_replication_receipt_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"transaction_id" uuid NOT NULL,
	"target_node" varchar(64) NOT NULL,
	"stream_type" "replication_stream" NOT NULL,
	"payload_checksum" varchar(64) NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidence_bundles" ALTER COLUMN "gps_lat" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_bundles" ALTER COLUMN "gps_lon" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_bundles" ALTER COLUMN "gps_accuracy_m" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence_artifacts" ADD COLUMN "synthetic" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "approved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "executed_by_user_id" uuid;--> statement-breakpoint
UPDATE "ledger_entries" AS le
SET "executed_by_user_id" = te."origin_user_id"
FROM "transaction_envelopes" AS te
WHERE te."transaction_id" = le."transaction_id";--> statement-breakpoint
ALTER TABLE "ledger_entries" ALTER COLUMN "executed_by_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "replication_queue" ADD COLUMN "stream_type" "replication_stream" DEFAULT 'record' NOT NULL;--> statement-breakpoint
ALTER TABLE "replication_queue" ADD COLUMN "payload_checksum" varchar(64);--> statement-breakpoint
ALTER TABLE "replication_queue" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "replication_queue" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "replication_queue" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transaction_envelopes" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "replication_receipts" ADD CONSTRAINT "replication_receipts_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "replication_receipts_transaction_target_stream_uq" ON "replication_receipts" USING btree ("transaction_id","target_node","stream_type");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_approved_by_user_id_users_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_executed_by_user_id_users_user_id_fk" FOREIGN KEY ("executed_by_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "box_converters_converter_uq" ON "box_converters" USING btree ("converter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "queue_boxes_box_uq" ON "queue_boxes" USING btree ("box_id");--> statement-breakpoint
CREATE UNIQUE INDEX "replication_queue_transaction_target_stream_uq" ON "replication_queue" USING btree ("transaction_id","target_node","stream_type");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_boxes_box_uq" ON "shipment_boxes" USING btree ("box_id");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_positive_amount_chk" CHECK ("ledger_entries"."amount_usd" > 0);--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_separation_of_duty_chk" CHECK ("ledger_entries"."approved_by_user_id" is null or "ledger_entries"."approved_by_user_id" <> "ledger_entries"."executed_by_user_id");--> statement-breakpoint
ALTER TABLE "replication_queue" ADD CONSTRAINT "replication_queue_retry_count_chk" CHECK ("replication_queue"."retry_count" >= 0);--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_positive_estimate_chk" CHECK ("settlements"."estimated_value_usd" > 0);--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_positive_final_value_chk" CHECK ("settlements"."final_value_usd" is null or "settlements"."final_value_usd" > 0);--> statement-breakpoint

CREATE OR REPLACE FUNCTION "dcs_prevent_append_only_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; use a compensating transaction', TG_TABLE_NAME;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "ledger_entries_append_only"
BEFORE UPDATE OR DELETE ON "ledger_entries"
FOR EACH ROW EXECUTE FUNCTION "dcs_prevent_append_only_mutation"();--> statement-breakpoint
CREATE TRIGGER "ledger_corrections_append_only"
BEFORE UPDATE OR DELETE ON "ledger_corrections"
FOR EACH ROW EXECUTE FUNCTION "dcs_prevent_append_only_mutation"();--> statement-breakpoint
CREATE TRIGGER "invoices_append_only"
BEFORE UPDATE OR DELETE ON "invoices"
FOR EACH ROW EXECUTE FUNCTION "dcs_prevent_append_only_mutation"();--> statement-breakpoint
CREATE TRIGGER "invoice_lines_append_only"
BEFORE UPDATE OR DELETE ON "invoice_lines"
FOR EACH ROW EXECUTE FUNCTION "dcs_prevent_append_only_mutation"();--> statement-breakpoint
CREATE TRIGGER "replication_receipts_append_only"
BEFORE UPDATE OR DELETE ON "replication_receipts"
FOR EACH ROW EXECUTE FUNCTION "dcs_prevent_append_only_mutation"();--> statement-breakpoint
CREATE TRIGGER "evidence_artifacts_append_only"
BEFORE UPDATE OR DELETE ON "evidence_artifacts"
FOR EACH ROW EXECUTE FUNCTION "dcs_prevent_append_only_mutation"();--> statement-breakpoint

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
    OR NEW."payload" IS DISTINCT FROM OLD."payload"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'transaction envelope identity and payload are immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "transaction_envelopes_protected"
BEFORE UPDATE OR DELETE ON "transaction_envelopes"
FOR EACH ROW EXECUTE FUNCTION "dcs_protect_transaction_envelope"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "dcs_protect_finalized_settlement"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'finalized' THEN
    RAISE EXCEPTION 'finalized settlements are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'settlements must be retained';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "settlements_finalized_immutable"
BEFORE UPDATE OR DELETE ON "settlements"
FOR EACH ROW EXECUTE FUNCTION "dcs_protect_finalized_settlement"();
