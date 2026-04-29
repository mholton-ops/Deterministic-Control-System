CREATE TABLE "projection_ledger_trace" (
	"ledger_entry_id" uuid PRIMARY KEY NOT NULL,
	"purpose_code" "ledger_purpose" NOT NULL,
	"amount_usd" numeric(14, 2) NOT NULL,
	"source_operational_ref" varchar(128) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"generated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projection_operations_overview" (
	"projection_key" varchar(32) PRIMARY KEY NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"queue_count" integer NOT NULL,
	"open_reconciliation_count" integer NOT NULL,
	"total_estimated_queue_value_usd" numeric(16, 2) NOT NULL,
	"converters_by_state" jsonb NOT NULL,
	CONSTRAINT "projection_operations_overview_key_chk" CHECK ("projection_operations_overview"."projection_key" = 'global')
);
--> statement-breakpoint
CREATE TABLE "projection_queue_exposure" (
	"queue_id" uuid PRIMARY KEY NOT NULL,
	"queue_code" varchar(64) NOT NULL,
	"queue_state" "queue_state" NOT NULL,
	"estimated_value_usd" numeric(14, 2),
	"avg_pt_ppm_corrected" numeric(16, 6) NOT NULL,
	"avg_pd_ppm_corrected" numeric(16, 6) NOT NULL,
	"avg_rh_ppm_corrected" numeric(16, 6) NOT NULL,
	"hedged_pt_oz" numeric(16, 6) NOT NULL,
	"hedged_pd_oz" numeric(16, 6) NOT NULL,
	"hedged_rh_oz" numeric(16, 6) NOT NULL,
	"generated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projection_ledger_trace" ADD CONSTRAINT "projection_ledger_trace_ledger_entry_id_ledger_entries_ledger_entry_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("ledger_entry_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection_queue_exposure" ADD CONSTRAINT "projection_queue_exposure_queue_id_queues_queue_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("queue_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projection_ledger_trace_source_idx" ON "projection_ledger_trace" USING btree ("source_operational_ref");--> statement-breakpoint
CREATE INDEX "projection_queue_exposure_state_idx" ON "projection_queue_exposure" USING btree ("queue_state");