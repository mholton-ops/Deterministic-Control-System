ALTER TABLE "hedge_positions" ADD COLUMN "transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "reconciliation_actions" ADD COLUMN "transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "reconciliation_cases" ADD COLUMN "opened_by_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "reconciliation_cases" ADD COLUMN "last_transition_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "reconciliation_cases" ADD COLUMN "closed_by_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "settlement_steps" ADD COLUMN "transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "created_by_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "finalized_by_transaction_id" uuid;--> statement-breakpoint

ALTER TABLE "invoices" DISABLE TRIGGER "invoices_append_only";--> statement-breakpoint
ALTER TABLE "reconciliation_actions" DISABLE TRIGGER "reconciliation_actions_append_only";--> statement-breakpoint
ALTER TABLE "settlement_steps" DISABLE TRIGGER "settlement_steps_append_only";--> statement-breakpoint
ALTER TABLE "settlements" DISABLE TRIGGER "settlements_finalized_immutable";--> statement-breakpoint

WITH matched AS (
  SELECT DISTINCT ON (hp."hedge_position_id")
    hp."hedge_position_id",
    te."transaction_id"
  FROM "hedge_positions" hp
  JOIN "transaction_envelopes" te
    ON te."event_type" = 'hedge.open_position'
   AND te."payload" ->> 'scopeId' = hp."scope_id"
   AND te."payload" ->> 'layer' = hp."layer"::text
  ORDER BY
    hp."hedge_position_id",
    ABS(EXTRACT(EPOCH FROM (te."created_at" - hp."opened_at"))),
    te."transaction_id"
)
UPDATE "hedge_positions" hp
SET "transaction_id" = matched."transaction_id"
FROM matched
WHERE hp."hedge_position_id" = matched."hedge_position_id";--> statement-breakpoint

WITH matched AS (
  SELECT DISTINCT ON (s."settlement_id")
    s."settlement_id",
    te."transaction_id"
  FROM "settlements" s
  JOIN "transaction_envelopes" te
    ON te."event_type" = 'settlement.append_step'
   AND te."payload" ->> 'settlementId' IN (s."settlement_id"::text, s."scope_id")
  ORDER BY s."settlement_id", te."created_at", te."transaction_id"
)
UPDATE "settlements" s
SET "created_by_transaction_id" = matched."transaction_id"
FROM matched
WHERE s."settlement_id" = matched."settlement_id";--> statement-breakpoint

WITH matched AS (
  SELECT DISTINCT ON (s."settlement_id")
    s."settlement_id",
    te."transaction_id"
  FROM "settlements" s
  JOIN "transaction_envelopes" te
    ON te."event_type" = 'settlement.finalize_from_assay'
   AND te."payload" ->> 'settlementId' IN (s."settlement_id"::text, s."scope_id")
  WHERE s."status" = 'finalized'
  ORDER BY
    s."settlement_id",
    ABS(EXTRACT(EPOCH FROM (te."created_at" - s."finalized_at"))),
    te."transaction_id"
)
UPDATE "settlements" s
SET "finalized_by_transaction_id" = matched."transaction_id"
FROM matched
WHERE s."settlement_id" = matched."settlement_id";--> statement-breakpoint

WITH matched AS (
  SELECT DISTINCT ON (ss."settlement_step_id")
    ss."settlement_step_id",
    te."transaction_id"
  FROM "settlement_steps" ss
  JOIN "settlements" s ON s."settlement_id" = ss."settlement_id"
  JOIN "transaction_envelopes" te ON (
    te."event_type" = 'settlement.append_step'
    AND te."payload" ->> 'settlementId' IN (s."settlement_id"::text, s."scope_id")
    AND te."payload" ->> 'step' = ss."step_name"
  ) OR (
    te."event_type" = 'settlement.finalize_from_assay'
    AND te."payload" ->> 'settlementId' IN (s."settlement_id"::text, s."scope_id")
    AND ss."step_name" IN ('final_value_calculated', 'invoice_finalized')
  )
  ORDER BY
    ss."settlement_step_id",
    ABS(EXTRACT(EPOCH FROM (te."created_at" - ss."recorded_at"))),
    te."transaction_id"
)
UPDATE "settlement_steps" ss
SET "transaction_id" = matched."transaction_id"
FROM matched
WHERE ss."settlement_step_id" = matched."settlement_step_id";--> statement-breakpoint

WITH matched AS (
  SELECT DISTINCT ON (i."invoice_id")
    i."invoice_id",
    te."transaction_id"
  FROM "invoices" i
  JOIN "settlements" s ON s."settlement_id" = i."settlement_id"
  JOIN "transaction_envelopes" te
    ON te."event_type" = 'settlement.finalize_from_assay'
   AND te."payload" ->> 'settlementId' IN (s."settlement_id"::text, s."scope_id")
  ORDER BY
    i."invoice_id",
    ABS(EXTRACT(EPOCH FROM (te."created_at" - i."issued_at"))),
    te."transaction_id"
)
UPDATE "invoices" i
SET "transaction_id" = matched."transaction_id"
FROM matched
WHERE i."invoice_id" = matched."invoice_id";--> statement-breakpoint

WITH matched AS (
  SELECT DISTINCT ON (rc."reconciliation_case_id")
    rc."reconciliation_case_id",
    te."transaction_id"
  FROM "reconciliation_cases" rc
  JOIN "transaction_envelopes" te
    ON te."event_type" = 'reconciliation.open_case'
   AND te."payload" ->> 'relatedScopeId' = rc."scope_id"
   AND te."payload" ->> 'triggerType' = rc."trigger_type"
  ORDER BY
    rc."reconciliation_case_id",
    ABS(EXTRACT(EPOCH FROM (te."created_at" - rc."opened_at"))),
    te."transaction_id"
)
UPDATE "reconciliation_cases" rc
SET
  "opened_by_transaction_id" = matched."transaction_id",
  "last_transition_transaction_id" = matched."transaction_id"
FROM matched
WHERE rc."reconciliation_case_id" = matched."reconciliation_case_id";--> statement-breakpoint

WITH matched AS (
  SELECT DISTINCT ON (ra."reconciliation_action_id")
    ra."reconciliation_action_id",
    te."transaction_id"
  FROM "reconciliation_actions" ra
  JOIN "transaction_envelopes" te ON (
    te."event_type" = 'reconciliation.record_action'
    AND te."payload" ->> 'caseId' = ra."reconciliation_case_id"::text
    AND te."payload" ->> 'actionType' = ra."action_type"
  ) OR (
    te."event_type" = 'finance.post_additive_correction'
    AND te."payload" ->> 'reconciliationCaseId' = ra."reconciliation_case_id"::text
    AND ra."action_type" = 'financial_correction_posted'
  )
  ORDER BY
    ra."reconciliation_action_id",
    ABS(EXTRACT(EPOCH FROM (te."created_at" - ra."created_at"))),
    te."transaction_id"
)
UPDATE "reconciliation_actions" ra
SET "transaction_id" = matched."transaction_id"
FROM matched
WHERE ra."reconciliation_action_id" = matched."reconciliation_action_id";--> statement-breakpoint

WITH latest_action AS (
  SELECT DISTINCT ON (ra."reconciliation_case_id")
    ra."reconciliation_case_id",
    ra."transaction_id"
  FROM "reconciliation_actions" ra
  WHERE ra."transaction_id" IS NOT NULL
  ORDER BY ra."reconciliation_case_id", ra."created_at" DESC, ra."reconciliation_action_id"
)
UPDATE "reconciliation_cases" rc
SET "last_transition_transaction_id" = latest_action."transaction_id"
FROM latest_action
WHERE rc."reconciliation_case_id" = latest_action."reconciliation_case_id"
  AND rc."status" = 'investigating';--> statement-breakpoint

WITH matched AS (
  SELECT DISTINCT ON (rc."reconciliation_case_id")
    rc."reconciliation_case_id",
    te."transaction_id"
  FROM "reconciliation_cases" rc
  JOIN "transaction_envelopes" te
    ON te."event_type" = 'reconciliation.close_case'
   AND te."payload" ->> 'caseId' = rc."reconciliation_case_id"::text
  WHERE rc."status" IN ('resolved', 'accepted_variance')
  ORDER BY
    rc."reconciliation_case_id",
    ABS(EXTRACT(EPOCH FROM (te."created_at" - rc."closed_at"))),
    te."transaction_id"
)
UPDATE "reconciliation_cases" rc
SET
  "closed_by_transaction_id" = matched."transaction_id",
  "last_transition_transaction_id" = matched."transaction_id"
FROM matched
WHERE rc."reconciliation_case_id" = matched."reconciliation_case_id";--> statement-breakpoint

ALTER TABLE "invoices" ENABLE TRIGGER "invoices_append_only";--> statement-breakpoint
ALTER TABLE "reconciliation_actions" ENABLE TRIGGER "reconciliation_actions_append_only";--> statement-breakpoint
ALTER TABLE "settlement_steps" ENABLE TRIGGER "settlement_steps_append_only";--> statement-breakpoint
ALTER TABLE "settlements" ENABLE TRIGGER "settlements_finalized_immutable";--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "hedge_positions" WHERE "transaction_id" IS NULL) THEN
    RAISE EXCEPTION 'Existing hedge positions lack opening transaction provenance';
  END IF;
  IF EXISTS (SELECT 1 FROM "settlements" WHERE "created_by_transaction_id" IS NULL) THEN
    RAISE EXCEPTION 'Existing settlements lack creation transaction provenance';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "settlements"
    WHERE "status" = 'finalized' AND "finalized_by_transaction_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Existing finalized settlements lack finalization transaction provenance';
  END IF;
  IF EXISTS (SELECT 1 FROM "settlement_steps" WHERE "transaction_id" IS NULL) THEN
    RAISE EXCEPTION 'Existing settlement steps lack transaction provenance';
  END IF;
  IF EXISTS (SELECT 1 FROM "invoices" WHERE "transaction_id" IS NULL) THEN
    RAISE EXCEPTION 'Existing invoices lack finalization transaction provenance';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "reconciliation_cases"
    WHERE "opened_by_transaction_id" IS NULL OR "last_transition_transaction_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Existing reconciliation cases lack transition provenance';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "reconciliation_cases"
    WHERE "status" IN ('resolved', 'accepted_variance') AND "closed_by_transaction_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Existing closed reconciliation cases lack closure transaction provenance';
  END IF;
  IF EXISTS (SELECT 1 FROM "reconciliation_actions" WHERE "transaction_id" IS NULL) THEN
    RAISE EXCEPTION 'Existing reconciliation actions lack transaction provenance';
  END IF;
END;
$$;--> statement-breakpoint

ALTER TABLE "hedge_positions" ALTER COLUMN "transaction_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "transaction_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reconciliation_actions" ALTER COLUMN "transaction_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reconciliation_cases" ALTER COLUMN "opened_by_transaction_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reconciliation_cases" ALTER COLUMN "last_transition_transaction_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "settlement_steps" ALTER COLUMN "transaction_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "settlements" ALTER COLUMN "created_by_transaction_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "hedge_positions" ADD CONSTRAINT "hedge_positions_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_actions" ADD CONSTRAINT "reconciliation_actions_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_cases" ADD CONSTRAINT "reconciliation_cases_opened_by_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("opened_by_transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_cases" ADD CONSTRAINT "reconciliation_cases_last_transition_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("last_transition_transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_cases" ADD CONSTRAINT "reconciliation_cases_closed_by_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("closed_by_transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_steps" ADD CONSTRAINT "settlement_steps_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("created_by_transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_finalized_by_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("finalized_by_transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "dcs_validate_control_lineage"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_transaction_id uuid;
  source_event_type text;
  expected_event_type text;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'hedge_positions' THEN
      source_transaction_id := NEW."transaction_id";
      expected_event_type := 'hedge.open_position';
    WHEN 'settlements' THEN
      source_transaction_id := NEW."created_by_transaction_id";
      expected_event_type := 'settlement.append_step';
    WHEN 'settlement_steps' THEN
      source_transaction_id := NEW."transaction_id";
      IF NEW."step_name" IN ('final_value_calculated', 'invoice_finalized') THEN
        expected_event_type := 'settlement.finalize_from_assay';
      ELSE
        expected_event_type := 'settlement.append_step';
      END IF;
    WHEN 'invoices' THEN
      source_transaction_id := NEW."transaction_id";
      expected_event_type := 'settlement.finalize_from_assay';
    WHEN 'reconciliation_cases' THEN
      source_transaction_id := NEW."opened_by_transaction_id";
      expected_event_type := 'reconciliation.open_case';
      IF NEW."last_transition_transaction_id" IS DISTINCT FROM NEW."opened_by_transaction_id"
        OR NEW."closed_by_transaction_id" IS NOT NULL THEN
        RAISE EXCEPTION 'new reconciliation cases must begin at their opening transaction';
      END IF;
    WHEN 'reconciliation_actions' THEN
      source_transaction_id := NEW."transaction_id";
      SELECT te."event_type" INTO source_event_type
      FROM "transaction_envelopes" te
      WHERE te."transaction_id" = source_transaction_id;
      IF source_event_type NOT IN ('reconciliation.record_action', 'finance.post_additive_correction') THEN
        RAISE EXCEPTION 'reconciliation action transaction must be a controlled action or correction command';
      END IF;
      RETURN NEW;
    ELSE
      RAISE EXCEPTION 'unsupported lineage validation table %', TG_TABLE_NAME;
  END CASE;

  SELECT te."event_type" INTO source_event_type
  FROM "transaction_envelopes" te
  WHERE te."transaction_id" = source_transaction_id;
  IF source_event_type IS DISTINCT FROM expected_event_type THEN
    RAISE EXCEPTION '% transaction must reference %, received %', TG_TABLE_NAME, expected_event_type, source_event_type;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "hedge_positions_lineage"
BEFORE INSERT ON "hedge_positions"
FOR EACH ROW EXECUTE FUNCTION "dcs_validate_control_lineage"();--> statement-breakpoint
CREATE TRIGGER "settlements_lineage"
BEFORE INSERT ON "settlements"
FOR EACH ROW EXECUTE FUNCTION "dcs_validate_control_lineage"();--> statement-breakpoint
CREATE TRIGGER "settlement_steps_lineage"
BEFORE INSERT ON "settlement_steps"
FOR EACH ROW EXECUTE FUNCTION "dcs_validate_control_lineage"();--> statement-breakpoint
CREATE TRIGGER "invoices_lineage"
BEFORE INSERT ON "invoices"
FOR EACH ROW EXECUTE FUNCTION "dcs_validate_control_lineage"();--> statement-breakpoint
CREATE TRIGGER "reconciliation_cases_lineage"
BEFORE INSERT ON "reconciliation_cases"
FOR EACH ROW EXECUTE FUNCTION "dcs_validate_control_lineage"();--> statement-breakpoint
CREATE TRIGGER "reconciliation_actions_lineage"
BEFORE INSERT ON "reconciliation_actions"
FOR EACH ROW EXECUTE FUNCTION "dcs_validate_control_lineage"();--> statement-breakpoint

CREATE TRIGGER "hedge_positions_append_only"
BEFORE UPDATE OR DELETE ON "hedge_positions"
FOR EACH ROW EXECUTE FUNCTION "dcs_prevent_append_only_mutation"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "dcs_protect_finalized_settlement"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  completed_steps text[];
  finalization_event_type text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'settlements must be retained';
  END IF;
  IF OLD."status" = 'finalized' THEN
    RAISE EXCEPTION 'finalized settlements are immutable';
  END IF;
  IF NEW."settlement_id" IS DISTINCT FROM OLD."settlement_id"
    OR NEW."scope_type" IS DISTINCT FROM OLD."scope_type"
    OR NEW."scope_id" IS DISTINCT FROM OLD."scope_id"
    OR NEW."estimated_value_usd" IS DISTINCT FROM OLD."estimated_value_usd"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR NEW."created_by_transaction_id" IS DISTINCT FROM OLD."created_by_transaction_id" THEN
    RAISE EXCEPTION 'settlement identity and creation basis are immutable';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status"
    AND NOT (OLD."status" IN ('draft', 'validated') AND NEW."status" = 'finalized') THEN
    RAISE EXCEPTION 'invalid settlement status transition: % -> %', OLD."status", NEW."status";
  END IF;
  IF NEW."status" = 'finalized' THEN
    IF NEW."final_value_usd" IS NULL
      OR NEW."variance_usd" IS NULL
      OR NEW."finalized_at" IS NULL
      OR NEW."finalized_by_transaction_id" IS NULL THEN
      RAISE EXCEPTION 'finalized settlement requires value, variance, time, and source transaction';
    END IF;
    SELECT te."event_type" INTO finalization_event_type
    FROM "transaction_envelopes" te
    WHERE te."transaction_id" = NEW."finalized_by_transaction_id";
    IF finalization_event_type IS DISTINCT FROM 'settlement.finalize_from_assay' THEN
      RAISE EXCEPTION 'settlement finalization must reference settlement.finalize_from_assay';
    END IF;
    SELECT array_agg(ss."step_name"::text ORDER BY ss."step_order") INTO completed_steps
    FROM "settlement_steps" ss
    WHERE ss."settlement_id" = NEW."settlement_id";
    IF completed_steps IS DISTINCT FROM ARRAY[
      'lot_selected',
      'contents_reviewed',
      'sample_data_recorded',
      'adjustments_recorded',
      'weight_basis_locked',
      'hedges_applied',
      'financial_context_applied',
      'final_value_calculated',
      'invoice_finalized'
    ]::text[] THEN
      RAISE EXCEPTION 'settlement finalization requires the complete ordered control sequence';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "invoices" i
      WHERE i."settlement_id" = NEW."settlement_id"
        AND i."transaction_id" = NEW."finalized_by_transaction_id"
    ) THEN
      RAISE EXCEPTION 'settlement finalization requires a transaction-linked final invoice';
    END IF;
  ELSIF NEW."final_value_usd" IS NOT NULL
    OR NEW."variance_usd" IS NOT NULL
    OR NEW."finalized_at" IS NOT NULL
    OR NEW."finalized_by_transaction_id" IS NOT NULL THEN
    RAISE EXCEPTION 'non-final settlement cannot carry finalization state';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "dcs_protect_reconciliation_case"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  transition_event_type text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reconciliation cases must be retained';
  END IF;
  IF NEW."reconciliation_case_id" IS DISTINCT FROM OLD."reconciliation_case_id"
    OR NEW."trigger_type" IS DISTINCT FROM OLD."trigger_type"
    OR NEW."severity" IS DISTINCT FROM OLD."severity"
    OR NEW."scope_type" IS DISTINCT FROM OLD."scope_type"
    OR NEW."scope_id" IS DISTINCT FROM OLD."scope_id"
    OR NEW."opened_at" IS DISTINCT FROM OLD."opened_at"
    OR NEW."opened_by_transaction_id" IS DISTINCT FROM OLD."opened_by_transaction_id" THEN
    RAISE EXCEPTION 'reconciliation case identity and opening basis are immutable';
  END IF;
  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    IF NEW."last_transition_transaction_id" IS DISTINCT FROM OLD."last_transition_transaction_id"
      OR NEW."closed_by_transaction_id" IS DISTINCT FROM OLD."closed_by_transaction_id"
      OR NEW."closed_at" IS DISTINCT FROM OLD."closed_at"
      OR NEW."closure_rationale" IS DISTINCT FROM OLD."closure_rationale" THEN
      RAISE EXCEPTION 'reconciliation transition metadata cannot change without a status transition';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD."status" = 'open' AND NEW."status" IN ('investigating', 'accepted_variance'))
    OR (OLD."status" = 'investigating' AND NEW."status" IN ('resolved', 'accepted_variance'))
  ) THEN
    RAISE EXCEPTION 'invalid reconciliation status transition: % -> %', OLD."status", NEW."status";
  END IF;
  IF NEW."last_transition_transaction_id" IS NOT DISTINCT FROM OLD."last_transition_transaction_id" THEN
    RAISE EXCEPTION 'reconciliation status transition requires a new source transaction';
  END IF;
  SELECT te."event_type" INTO transition_event_type
  FROM "transaction_envelopes" te
  WHERE te."transaction_id" = NEW."last_transition_transaction_id";
  IF NEW."status" = 'investigating' THEN
    IF transition_event_type NOT IN ('reconciliation.record_action', 'finance.post_additive_correction') THEN
      RAISE EXCEPTION 'investigation transition requires a controlled action transaction';
    END IF;
    IF NEW."closed_at" IS NOT NULL OR NEW."closed_by_transaction_id" IS NOT NULL OR NEW."closure_rationale" IS NOT NULL THEN
      RAISE EXCEPTION 'investigating reconciliation case cannot carry closure metadata';
    END IF;
  ELSE
    IF transition_event_type IS DISTINCT FROM 'reconciliation.close_case' THEN
      RAISE EXCEPTION 'reconciliation closure requires reconciliation.close_case';
    END IF;
    IF NEW."closed_at" IS NULL
      OR NEW."closed_by_transaction_id" IS DISTINCT FROM NEW."last_transition_transaction_id"
      OR COALESCE(LENGTH(TRIM(NEW."closure_rationale")), 0) < 3 THEN
      RAISE EXCEPTION 'closed reconciliation case requires time, rationale, and closure transaction';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "reconciliation_cases_protected"
BEFORE UPDATE OR DELETE ON "reconciliation_cases"
FOR EACH ROW EXECUTE FUNCTION "dcs_protect_reconciliation_case"();
