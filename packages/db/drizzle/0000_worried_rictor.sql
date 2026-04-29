CREATE TYPE "public"."account_type" AS ENUM('buyer', 'warehouse', 'bank', 'customer', 'internal');--> statement-breakpoint
CREATE TYPE "public"."box_state" AS ENUM('empty', 'active', 'closed', 'shipped', 'received', 'retired');--> statement-breakpoint
CREATE TYPE "public"."confidence_band" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."converter_state" AS ENUM('captured', 'boxed', 'queued', 'in_transit', 'received', 'processing', 'sampled', 'settled');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('image', 'note', 'gps', 'video', 'document');--> statement-breakpoint
CREATE TYPE "public"."hedge_layer" AS ENUM('internal', 'external');--> statement-breakpoint
CREATE TYPE "public"."hedge_status" AS ENUM('open', 'partially_applied', 'closed');--> statement-breakpoint
CREATE TYPE "public"."identification_method" AS ENUM('vin', 'serial', 'library_match', 'category_fallback');--> statement-breakpoint
CREATE TYPE "public"."ledger_purpose" AS ENUM('funding_advance', 'field_purchase', 'deposit', 'settlement_payout', 'adjustment', 'wire');--> statement-breakpoint
CREATE TYPE "public"."queue_state" AS ENUM('open', 'processing', 'sampled', 'assay_pending', 'valued', 'settled');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_status" AS ENUM('open', 'investigating', 'resolved', 'accepted_variance');--> statement-breakpoint
CREATE TYPE "public"."sample_source" AS ENUM('internal_xrf', 'external_xrf', 'icp_final');--> statement-breakpoint
CREATE TYPE "public"."scope_type" AS ENUM('queue', 'lot', 'shipment', 'ledger', 'material_group');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('draft', 'validated', 'finalized');--> statement-breakpoint
CREATE TYPE "public"."shipment_state" AS ENUM('prepared', 'in_transit', 'received', 'discrepant', 'closed');--> statement-breakpoint
CREATE TYPE "public"."source_system" AS ENUM('field_client', 'server', 'operator_console');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'awaiting_validation', 'applied', 'confirmed', 'failed');--> statement-breakpoint
CREATE TABLE "accounts" (
	"account_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_code" varchar(64) NOT NULL,
	"account_type" "account_type" NOT NULL,
	"owner_ref" varchar(64) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_account_code_unique" UNIQUE("account_code")
);
--> statement-breakpoint
CREATE TABLE "box_converters" (
	"box_id" uuid NOT NULL,
	"converter_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by_transaction_id" uuid NOT NULL,
	CONSTRAINT "box_converters_box_id_converter_id_pk" PRIMARY KEY("box_id","converter_id")
);
--> statement-breakpoint
CREATE TABLE "boxes" (
	"box_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_code" varchar(64) NOT NULL,
	"material_type" varchar(64) NOT NULL,
	"state" "box_state" DEFAULT 'empty' NOT NULL,
	"created_by_transaction_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boxes_external_code_unique" UNIQUE("external_code")
);
--> statement-breakpoint
CREATE TABLE "converters" (
	"converter_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" "converter_state" DEFAULT 'captured' NOT NULL,
	"origin_transaction_id" uuid NOT NULL,
	"evidence_bundle_id" uuid NOT NULL,
	"current_box_id" uuid,
	"vin_or_serial" varchar(64),
	"captured_at" timestamp with time zone NOT NULL,
	"captured_site_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correction_matrices" (
	"matrix_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_fingerprint" varchar(128) NOT NULL,
	"qualification_status" varchar(32) NOT NULL,
	"pt_multiplier" numeric(12, 6) NOT NULL,
	"pd_multiplier" numeric(12, 6) NOT NULL,
	"rh_multiplier" numeric(12, 6) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custody_events" (
	"custody_event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"scope_type" "scope_type" NOT NULL,
	"scope_id" varchar(64) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"evidence_bundle_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"device_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_ref" varchar(64) NOT NULL,
	"assigned_user_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_external_ref_unique" UNIQUE("external_ref")
);
--> statement-breakpoint
CREATE TABLE "evidence_artifacts" (
	"artifact_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_bundle_id" uuid NOT NULL,
	"evidence_type" "evidence_type" NOT NULL,
	"uri" text NOT NULL,
	"sha256" varchar(64),
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_bundles" (
	"evidence_bundle_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_by_device_id" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"gps_lat" numeric(9, 6) NOT NULL,
	"gps_lon" numeric(9, 6) NOT NULL,
	"gps_accuracy_m" numeric(8, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grading_decisions" (
	"grading_decision_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"converter_id" uuid NOT NULL,
	"library_entry_id" uuid NOT NULL,
	"method" "identification_method" NOT NULL,
	"confidence_band" "confidence_band" NOT NULL,
	"estimated_value_usd" numeric(14, 2) NOT NULL,
	"overridden" boolean DEFAULT false NOT NULL,
	"override_reason" text,
	"decided_by_user_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hedge_applications" (
	"hedge_application_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hedge_position_id" uuid NOT NULL,
	"settlement_id" uuid,
	"applied_ratio" numeric(6, 4) NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hedge_applications_ratio_chk" CHECK ("hedge_applications"."applied_ratio" > 0 and "hedge_applications"."applied_ratio" <= 1)
);
--> statement-breakpoint
CREATE TABLE "hedge_positions" (
	"hedge_position_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"layer" "hedge_layer" NOT NULL,
	"scope_type" "scope_type" NOT NULL,
	"scope_id" varchar(64) NOT NULL,
	"hedged_pt_oz" numeric(14, 6) NOT NULL,
	"hedged_pd_oz" numeric(14, 6) NOT NULL,
	"hedged_rh_oz" numeric(14, 6) NOT NULL,
	"status" "hedge_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"invoice_line_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_type" varchar(64) NOT NULL,
	"description" text NOT NULL,
	"amount_usd" numeric(14, 2) NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"invoice_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"invoice_number" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'final' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"immutable" boolean DEFAULT true NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number"),
	CONSTRAINT "invoices_immutable_chk" CHECK ("invoices"."immutable" = true)
);
--> statement-breakpoint
CREATE TABLE "ledger_corrections" (
	"correction_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_ledger_entry_id" uuid NOT NULL,
	"correction_ledger_entry_id" uuid NOT NULL,
	"reason_code" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"ledger_entry_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"debit_account_id" uuid NOT NULL,
	"credit_account_id" uuid NOT NULL,
	"purpose_code" "ledger_purpose" NOT NULL,
	"amount_usd" numeric(14, 2) NOT NULL,
	"source_operational_ref" varchar(128) NOT NULL,
	"evidence_bundle_id" uuid NOT NULL,
	"notes" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_distinct_accounts_chk" CHECK ("ledger_entries"."debit_account_id" <> "ledger_entries"."credit_account_id")
);
--> statement-breakpoint
CREATE TABLE "library_entries" (
	"library_entry_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"qualification_status" varchar(32) NOT NULL,
	"vin_pattern" varchar(32),
	"serial_pattern" varchar(64),
	"morphological_signature" jsonb NOT NULL,
	"confidence_band" "confidence_band" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_snapshots" (
	"market_snapshot_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pt_usd_per_oz" numeric(12, 4) NOT NULL,
	"pd_usd_per_oz" numeric(12, 4) NOT NULL,
	"rh_usd_per_oz" numeric(12, 4) NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mass_measurements" (
	"mass_measurement_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue_id" uuid NOT NULL,
	"stage" varchar(32) NOT NULL,
	"input_weight_kg" numeric(12, 3) NOT NULL,
	"output_weight_kg" numeric(12, 3) NOT NULL,
	"explained_loss_kg" numeric(12, 3) NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_decisions" (
	"pricing_decision_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue_id" uuid NOT NULL,
	"market_snapshot_id" uuid NOT NULL,
	"terms_profile_id" uuid NOT NULL,
	"source_method" "identification_method" NOT NULL,
	"estimate_usd" numeric(14, 2) NOT NULL,
	"confidence_band" "confidence_band" NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_boxes" (
	"queue_id" uuid NOT NULL,
	"box_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by_transaction_id" uuid NOT NULL,
	CONSTRAINT "queue_boxes_queue_id_box_id_pk" PRIMARY KEY("queue_id","box_id")
);
--> statement-breakpoint
CREATE TABLE "queues" (
	"queue_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue_code" varchar(64) NOT NULL,
	"state" "queue_state" DEFAULT 'open' NOT NULL,
	"locked_for_processing" boolean DEFAULT false NOT NULL,
	"estimated_value_usd" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "queues_queue_code_unique" UNIQUE("queue_code")
);
--> statement-breakpoint
CREATE TABLE "reconciliation_actions" (
	"reconciliation_action_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reconciliation_case_id" uuid NOT NULL,
	"action_type" varchar(64) NOT NULL,
	"action_payload" jsonb NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_cases" (
	"reconciliation_case_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger_type" varchar(64) NOT NULL,
	"severity" "reconciliation_severity" NOT NULL,
	"status" "reconciliation_status" DEFAULT 'open' NOT NULL,
	"scope_type" "scope_type" NOT NULL,
	"scope_id" varchar(64) NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closure_rationale" text
);
--> statement-breakpoint
CREATE TABLE "replication_queue" (
	"replication_queue_id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "replication_queue_replication_queue_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"transaction_id" uuid NOT NULL,
	"target_node" varchar(64) NOT NULL,
	"status" "transaction_status" DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "samples" (
	"sample_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue_id" uuid NOT NULL,
	"source" "sample_source" NOT NULL,
	"matrix_id" uuid,
	"pt_ppm_raw" numeric(14, 4) NOT NULL,
	"pd_ppm_raw" numeric(14, 4) NOT NULL,
	"rh_ppm_raw" numeric(14, 4) NOT NULL,
	"pt_ppm_corrected" numeric(14, 4),
	"pd_ppm_corrected" numeric(14, 4),
	"rh_ppm_corrected" numeric(14, 4),
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_steps" (
	"settlement_step_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"step_name" varchar(64) NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by_user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"settlement_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_type" "scope_type" NOT NULL,
	"scope_id" varchar(64) NOT NULL,
	"status" "settlement_status" DEFAULT 'draft' NOT NULL,
	"estimated_value_usd" numeric(14, 2) NOT NULL,
	"final_value_usd" numeric(14, 2),
	"variance_usd" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shipment_boxes" (
	"shipment_id" uuid NOT NULL,
	"box_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_boxes_shipment_id_box_id_pk" PRIMARY KEY("shipment_id","box_id")
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"shipment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_code" varchar(64) NOT NULL,
	"state" "shipment_state" DEFAULT 'prepared' NOT NULL,
	"origin_site_id" uuid NOT NULL,
	"destination_site_id" uuid NOT NULL,
	"departed_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	CONSTRAINT "shipments_shipment_code_unique" UNIQUE("shipment_code")
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"site_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_code" varchar(32) NOT NULL,
	"name" varchar(120) NOT NULL,
	"site_type" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_site_code_unique" UNIQUE("site_code")
);
--> statement-breakpoint
CREATE TABLE "terms_profiles" (
	"terms_profile_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_account_id" uuid NOT NULL,
	"payout_factor" numeric(8, 4) NOT NULL,
	"processing_charge_usd" numeric(12, 2) NOT NULL,
	"treatment_charge_usd" numeric(12, 2) NOT NULL,
	"active_from" timestamp with time zone NOT NULL,
	"active_to" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transaction_dependencies" (
	"transaction_id" uuid NOT NULL,
	"dependency_entity_type" varchar(64) NOT NULL,
	"dependency_entity_id" varchar(64) NOT NULL,
	"required_state" varchar(64) NOT NULL,
	CONSTRAINT "transaction_dependencies_transaction_id_dependency_entity_type_dependency_entity_id_pk" PRIMARY KEY("transaction_id","dependency_entity_type","dependency_entity_id")
);
--> statement-breakpoint
CREATE TABLE "transaction_envelopes" (
	"transaction_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"source_system" "source_system" NOT NULL,
	"origin_user_id" uuid NOT NULL,
	"origin_device_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"validation_state" "transaction_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_ref" varchar(64) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"role" varchar(64) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_external_ref_unique" UNIQUE("external_ref")
);
--> statement-breakpoint
ALTER TABLE "box_converters" ADD CONSTRAINT "box_converters_box_id_boxes_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."boxes"("box_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_converters" ADD CONSTRAINT "box_converters_converter_id_converters_converter_id_fk" FOREIGN KEY ("converter_id") REFERENCES "public"."converters"("converter_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_converters" ADD CONSTRAINT "box_converters_assigned_by_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("assigned_by_transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boxes" ADD CONSTRAINT "boxes_created_by_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("created_by_transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "converters" ADD CONSTRAINT "converters_origin_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("origin_transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "converters" ADD CONSTRAINT "converters_evidence_bundle_id_evidence_bundles_evidence_bundle_id_fk" FOREIGN KEY ("evidence_bundle_id") REFERENCES "public"."evidence_bundles"("evidence_bundle_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "converters" ADD CONSTRAINT "converters_captured_site_id_sites_site_id_fk" FOREIGN KEY ("captured_site_id") REFERENCES "public"."sites"("site_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_evidence_bundle_id_evidence_bundles_evidence_bundle_id_fk" FOREIGN KEY ("evidence_bundle_id") REFERENCES "public"."evidence_bundles"("evidence_bundle_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_assigned_user_id_users_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_artifacts" ADD CONSTRAINT "evidence_artifacts_evidence_bundle_id_evidence_bundles_evidence_bundle_id_fk" FOREIGN KEY ("evidence_bundle_id") REFERENCES "public"."evidence_bundles"("evidence_bundle_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_bundles" ADD CONSTRAINT "evidence_bundles_created_by_user_id_users_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_bundles" ADD CONSTRAINT "evidence_bundles_created_by_device_id_devices_device_id_fk" FOREIGN KEY ("created_by_device_id") REFERENCES "public"."devices"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_decisions" ADD CONSTRAINT "grading_decisions_converter_id_converters_converter_id_fk" FOREIGN KEY ("converter_id") REFERENCES "public"."converters"("converter_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_decisions" ADD CONSTRAINT "grading_decisions_library_entry_id_library_entries_library_entry_id_fk" FOREIGN KEY ("library_entry_id") REFERENCES "public"."library_entries"("library_entry_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grading_decisions" ADD CONSTRAINT "grading_decisions_decided_by_user_id_users_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hedge_applications" ADD CONSTRAINT "hedge_applications_hedge_position_id_hedge_positions_hedge_position_id_fk" FOREIGN KEY ("hedge_position_id") REFERENCES "public"."hedge_positions"("hedge_position_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("invoice_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_settlement_id_settlements_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("settlement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_corrections" ADD CONSTRAINT "ledger_corrections_target_ledger_entry_id_ledger_entries_ledger_entry_id_fk" FOREIGN KEY ("target_ledger_entry_id") REFERENCES "public"."ledger_entries"("ledger_entry_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_corrections" ADD CONSTRAINT "ledger_corrections_correction_ledger_entry_id_ledger_entries_ledger_entry_id_fk" FOREIGN KEY ("correction_ledger_entry_id") REFERENCES "public"."ledger_entries"("ledger_entry_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_debit_account_id_accounts_account_id_fk" FOREIGN KEY ("debit_account_id") REFERENCES "public"."accounts"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_credit_account_id_accounts_account_id_fk" FOREIGN KEY ("credit_account_id") REFERENCES "public"."accounts"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_evidence_bundle_id_evidence_bundles_evidence_bundle_id_fk" FOREIGN KEY ("evidence_bundle_id") REFERENCES "public"."evidence_bundles"("evidence_bundle_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mass_measurements" ADD CONSTRAINT "mass_measurements_queue_id_queues_queue_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("queue_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_decisions" ADD CONSTRAINT "pricing_decisions_queue_id_queues_queue_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("queue_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_decisions" ADD CONSTRAINT "pricing_decisions_market_snapshot_id_market_snapshots_market_snapshot_id_fk" FOREIGN KEY ("market_snapshot_id") REFERENCES "public"."market_snapshots"("market_snapshot_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_decisions" ADD CONSTRAINT "pricing_decisions_terms_profile_id_terms_profiles_terms_profile_id_fk" FOREIGN KEY ("terms_profile_id") REFERENCES "public"."terms_profiles"("terms_profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_boxes" ADD CONSTRAINT "queue_boxes_queue_id_queues_queue_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("queue_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_boxes" ADD CONSTRAINT "queue_boxes_box_id_boxes_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."boxes"("box_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_boxes" ADD CONSTRAINT "queue_boxes_assigned_by_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("assigned_by_transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_actions" ADD CONSTRAINT "reconciliation_actions_reconciliation_case_id_reconciliation_cases_reconciliation_case_id_fk" FOREIGN KEY ("reconciliation_case_id") REFERENCES "public"."reconciliation_cases"("reconciliation_case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_actions" ADD CONSTRAINT "reconciliation_actions_created_by_user_id_users_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replication_queue" ADD CONSTRAINT "replication_queue_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_queue_id_queues_queue_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("queue_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_matrix_id_correction_matrices_matrix_id_fk" FOREIGN KEY ("matrix_id") REFERENCES "public"."correction_matrices"("matrix_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_steps" ADD CONSTRAINT "settlement_steps_settlement_id_settlements_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("settlement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_steps" ADD CONSTRAINT "settlement_steps_recorded_by_user_id_users_user_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_boxes" ADD CONSTRAINT "shipment_boxes_shipment_id_shipments_shipment_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("shipment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_boxes" ADD CONSTRAINT "shipment_boxes_box_id_boxes_box_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."boxes"("box_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_origin_site_id_sites_site_id_fk" FOREIGN KEY ("origin_site_id") REFERENCES "public"."sites"("site_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_destination_site_id_sites_site_id_fk" FOREIGN KEY ("destination_site_id") REFERENCES "public"."sites"("site_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_dependencies" ADD CONSTRAINT "transaction_dependencies_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_envelopes" ADD CONSTRAINT "transaction_envelopes_origin_user_id_users_user_id_fk" FOREIGN KEY ("origin_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_envelopes" ADD CONSTRAINT "transaction_envelopes_origin_device_id_devices_device_id_fk" FOREIGN KEY ("origin_device_id") REFERENCES "public"."devices"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_type_idx" ON "accounts" USING btree ("account_type");--> statement-breakpoint
CREATE INDEX "boxes_state_idx" ON "boxes" USING btree ("state");--> statement-breakpoint
CREATE INDEX "converters_state_idx" ON "converters" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "correction_matrices_fingerprint_version_uq" ON "correction_matrices" USING btree ("material_fingerprint","version");--> statement-breakpoint
CREATE INDEX "custody_events_scope_idx" ON "custody_events" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "devices_assigned_user_idx" ON "devices" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE INDEX "evidence_artifacts_bundle_idx" ON "evidence_artifacts" USING btree ("evidence_bundle_id");--> statement-breakpoint
CREATE INDEX "evidence_artifacts_type_idx" ON "evidence_artifacts" USING btree ("evidence_type");--> statement-breakpoint
CREATE INDEX "grading_decisions_converter_idx" ON "grading_decisions" USING btree ("converter_id");--> statement-breakpoint
CREATE INDEX "hedge_positions_scope_idx" ON "hedge_positions" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_sort_order_uq" ON "invoice_lines" USING btree ("invoice_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_corrections_entry_uq" ON "ledger_corrections" USING btree ("correction_ledger_entry_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_source_ref_idx" ON "ledger_entries" USING btree ("source_operational_ref");--> statement-breakpoint
CREATE INDEX "library_entries_confidence_idx" ON "library_entries" USING btree ("confidence_band");--> statement-breakpoint
CREATE INDEX "market_snapshots_captured_at_idx" ON "market_snapshots" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "mass_measurements_queue_idx" ON "mass_measurements" USING btree ("queue_id");--> statement-breakpoint
CREATE INDEX "pricing_decisions_queue_idx" ON "pricing_decisions" USING btree ("queue_id");--> statement-breakpoint
CREATE INDEX "queues_state_idx" ON "queues" USING btree ("state");--> statement-breakpoint
CREATE INDEX "reconciliation_actions_case_idx" ON "reconciliation_actions" USING btree ("reconciliation_case_id");--> statement-breakpoint
CREATE INDEX "reconciliation_cases_status_idx" ON "reconciliation_cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "replication_queue_status_idx" ON "replication_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "samples_queue_source_idx" ON "samples" USING btree ("queue_id","source");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_steps_order_uq" ON "settlement_steps" USING btree ("settlement_id","step_order");--> statement-breakpoint
CREATE INDEX "settlements_scope_idx" ON "settlements" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "shipments_state_idx" ON "shipments" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_envelopes_idempotency_uq" ON "transaction_envelopes" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "transaction_envelopes_event_type_idx" ON "transaction_envelopes" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "transaction_envelopes_created_at_idx" ON "transaction_envelopes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");