ALTER TABLE "boxes" ADD COLUMN "last_transition_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "converters" ADD COLUMN "last_transition_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "queues" ADD COLUMN "created_by_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "queues" ADD COLUMN "last_transition_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "shipment_boxes" ADD COLUMN "assigned_by_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "created_by_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "last_transition_transaction_id" uuid;--> statement-breakpoint

ALTER TABLE "shipment_boxes" DISABLE TRIGGER "shipment_boxes_append_only";--> statement-breakpoint

WITH matched AS (
  SELECT DISTINCT ON (s."shipment_id")
    s."shipment_id",
    te."transaction_id"
  FROM "shipments" s
  JOIN "transaction_envelopes" te
    ON te."event_type" = 'custody.create_shipment'
   AND te."payload" ->> 'shipmentCode' = s."shipment_code"
  ORDER BY
    s."shipment_id",
    ABS(EXTRACT(EPOCH FROM (te."created_at" - s."departed_at"))),
    te."transaction_id"
)
UPDATE "shipments" s
SET
  "created_by_transaction_id" = matched."transaction_id",
  "last_transition_transaction_id" = matched."transaction_id"
FROM matched
WHERE s."shipment_id" = matched."shipment_id";--> statement-breakpoint

WITH matched AS (
  SELECT DISTINCT ON (s."shipment_id")
    s."shipment_id",
    te."transaction_id"
  FROM "shipments" s
  JOIN "transaction_envelopes" te
    ON te."event_type" = 'custody.receive_shipment'
   AND te."payload" ->> 'shipmentRef' IN (s."shipment_id"::text, s."shipment_code")
  WHERE s."state" = 'received'
  ORDER BY
    s."shipment_id",
    ABS(EXTRACT(EPOCH FROM (te."created_at" - s."received_at"))),
    te."transaction_id"
)
UPDATE "shipments" s
SET "last_transition_transaction_id" = matched."transaction_id"
FROM matched
WHERE s."shipment_id" = matched."shipment_id";--> statement-breakpoint

UPDATE "shipment_boxes" sb
SET "assigned_by_transaction_id" = s."created_by_transaction_id"
FROM "shipments" s
WHERE sb."shipment_id" = s."shipment_id";--> statement-breakpoint

WITH first_assignment AS (
  SELECT DISTINCT ON (qb."queue_id")
    qb."queue_id",
    qb."assigned_by_transaction_id"
  FROM "queue_boxes" qb
  ORDER BY qb."queue_id", qb."assigned_at", qb."box_id"
)
UPDATE "queues" q
SET
  "created_by_transaction_id" = first_assignment."assigned_by_transaction_id",
  "last_transition_transaction_id" = first_assignment."assigned_by_transaction_id"
FROM first_assignment
WHERE q."queue_id" = first_assignment."queue_id";--> statement-breakpoint

WITH candidates AS (
  SELECT qb."queue_id", qb."assigned_by_transaction_id" AS "transaction_id", te."created_at" AS "happened_at"
  FROM "queue_boxes" qb
  JOIN "transaction_envelopes" te ON te."transaction_id" = qb."assigned_by_transaction_id"
  UNION ALL
  SELECT q."queue_id", te."transaction_id", te."created_at"
  FROM "queues" q
  JOIN "transaction_envelopes" te
    ON te."event_type" = 'custody.lock_queue_for_processing'
   AND te."payload" ->> 'queueId' IN (q."queue_id"::text, q."queue_code")
  UNION ALL
  SELECT s."queue_id", s."transaction_id", te."created_at"
  FROM "samples" s
  JOIN "transaction_envelopes" te ON te."transaction_id" = s."transaction_id"
  UNION ALL
  SELECT pd."queue_id", pd."transaction_id", te."created_at"
  FROM "pricing_decisions" pd
  JOIN "transaction_envelopes" te ON te."transaction_id" = pd."transaction_id"
  UNION ALL
  SELECT q."queue_id", s."finalized_by_transaction_id", te."created_at"
  FROM "settlements" s
  JOIN "queues" q ON s."scope_id" IN (q."queue_id"::text, q."queue_code")
  JOIN "transaction_envelopes" te ON te."transaction_id" = s."finalized_by_transaction_id"
  WHERE s."status" = 'finalized'
), latest AS (
  SELECT DISTINCT ON (c."queue_id")
    c."queue_id",
    c."transaction_id"
  FROM candidates c
  ORDER BY c."queue_id", c."happened_at" DESC, c."transaction_id"
)
UPDATE "queues" q
SET "last_transition_transaction_id" = latest."transaction_id"
FROM latest
WHERE q."queue_id" = latest."queue_id";--> statement-breakpoint

WITH candidates AS (
  SELECT b."box_id", b."created_by_transaction_id" AS "transaction_id", te."created_at" AS "happened_at"
  FROM "boxes" b
  JOIN "transaction_envelopes" te ON te."transaction_id" = b."created_by_transaction_id"
  UNION ALL
  SELECT b."box_id", te."transaction_id", te."created_at"
  FROM "boxes" b
  JOIN "transaction_envelopes" te
    ON te."event_type" = 'custody.close_box'
   AND te."payload" ->> 'boxId' IN (b."box_id"::text, b."external_code")
  UNION ALL
  SELECT sb."box_id", s."created_by_transaction_id", created."created_at"
  FROM "shipment_boxes" sb
  JOIN "shipments" s ON s."shipment_id" = sb."shipment_id"
  JOIN "transaction_envelopes" created ON created."transaction_id" = s."created_by_transaction_id"
  UNION ALL
  SELECT sb."box_id", s."last_transition_transaction_id", transitioned."created_at"
  FROM "shipment_boxes" sb
  JOIN "shipments" s ON s."shipment_id" = sb."shipment_id"
  JOIN "transaction_envelopes" transitioned ON transitioned."transaction_id" = s."last_transition_transaction_id"
), latest AS (
  SELECT DISTINCT ON (c."box_id")
    c."box_id",
    c."transaction_id"
  FROM candidates c
  ORDER BY c."box_id", c."happened_at" DESC, c."transaction_id"
)
UPDATE "boxes" b
SET "last_transition_transaction_id" = latest."transaction_id"
FROM latest
WHERE b."box_id" = latest."box_id";--> statement-breakpoint

WITH candidates AS (
  SELECT c."converter_id", c."origin_transaction_id" AS "transaction_id", te."created_at" AS "happened_at"
  FROM "converters" c
  JOIN "transaction_envelopes" te ON te."transaction_id" = c."origin_transaction_id"
  WHERE c."state" IN ('captured', 'boxed')
  UNION ALL
  SELECT bc."converter_id", bc."assigned_by_transaction_id", te."created_at"
  FROM "box_converters" bc
  JOIN "converters" c ON c."converter_id" = bc."converter_id"
  JOIN "transaction_envelopes" te ON te."transaction_id" = bc."assigned_by_transaction_id"
  WHERE c."state" IN ('captured', 'boxed')
  UNION ALL
  SELECT bc."converter_id", qb."assigned_by_transaction_id", te."created_at"
  FROM "box_converters" bc
  JOIN "converters" c ON c."converter_id" = bc."converter_id"
  JOIN "queue_boxes" qb ON qb."box_id" = bc."box_id"
  JOIN "transaction_envelopes" te ON te."transaction_id" = qb."assigned_by_transaction_id"
  WHERE c."state" = 'queued'
  UNION ALL
  SELECT bc."converter_id", te."transaction_id", te."created_at"
  FROM "box_converters" bc
  JOIN "converters" c ON c."converter_id" = bc."converter_id"
  JOIN "queue_boxes" qb ON qb."box_id" = bc."box_id"
  JOIN "queues" q ON q."queue_id" = qb."queue_id"
  JOIN "transaction_envelopes" te
    ON te."event_type" = 'custody.lock_queue_for_processing'
   AND te."payload" ->> 'queueId' IN (q."queue_id"::text, q."queue_code")
  WHERE c."state" = 'processing'
  UNION ALL
  SELECT bc."converter_id", sample."transaction_id", te."created_at"
  FROM "box_converters" bc
  JOIN "converters" c ON c."converter_id" = bc."converter_id"
  JOIN "queue_boxes" qb ON qb."box_id" = bc."box_id"
  JOIN "samples" sample ON sample."queue_id" = qb."queue_id"
  JOIN "transaction_envelopes" te ON te."transaction_id" = sample."transaction_id"
  WHERE c."state" = 'sampled'
  UNION ALL
  SELECT bc."converter_id", s."created_by_transaction_id", te."created_at"
  FROM "box_converters" bc
  JOIN "converters" c ON c."converter_id" = bc."converter_id"
  JOIN "shipment_boxes" sb ON sb."box_id" = bc."box_id"
  JOIN "shipments" s ON s."shipment_id" = sb."shipment_id"
  JOIN "transaction_envelopes" te ON te."transaction_id" = s."created_by_transaction_id"
  WHERE c."state" = 'in_transit'
  UNION ALL
  SELECT bc."converter_id", s."last_transition_transaction_id", te."created_at"
  FROM "box_converters" bc
  JOIN "converters" c ON c."converter_id" = bc."converter_id"
  JOIN "shipment_boxes" sb ON sb."box_id" = bc."box_id"
  JOIN "shipments" s ON s."shipment_id" = sb."shipment_id"
  JOIN "transaction_envelopes" te ON te."transaction_id" = s."last_transition_transaction_id"
  WHERE c."state" = 'received'
  UNION ALL
  SELECT bc."converter_id", s."finalized_by_transaction_id", te."created_at"
  FROM "box_converters" bc
  JOIN "converters" c ON c."converter_id" = bc."converter_id"
  JOIN "queue_boxes" qb ON qb."box_id" = bc."box_id"
  JOIN "queues" q ON q."queue_id" = qb."queue_id"
  JOIN "settlements" s ON s."scope_id" IN (q."queue_id"::text, q."queue_code")
  JOIN "transaction_envelopes" te ON te."transaction_id" = s."finalized_by_transaction_id"
  WHERE c."state" = 'settled' AND s."status" = 'finalized'
), latest AS (
  SELECT DISTINCT ON (c."converter_id")
    c."converter_id",
    c."transaction_id"
  FROM candidates c
  ORDER BY c."converter_id", c."happened_at" DESC, c."transaction_id"
)
UPDATE "converters" c
SET "last_transition_transaction_id" = latest."transaction_id"
FROM latest
WHERE c."converter_id" = latest."converter_id";--> statement-breakpoint

ALTER TABLE "shipment_boxes" ENABLE TRIGGER "shipment_boxes_append_only";--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "boxes" b
    LEFT JOIN "transaction_envelopes" te ON te."transaction_id" = b."last_transition_transaction_id"
    WHERE b."last_transition_transaction_id" IS NULL
      OR te."transaction_id" IS NULL
      OR (b."state" = 'active' AND te."event_type" NOT IN ('field.capture_converter', 'custody.assign_converter_to_box'))
      OR (b."state" = 'closed' AND te."event_type" <> 'custody.close_box')
      OR (b."state" = 'shipped' AND te."event_type" <> 'custody.create_shipment')
      OR (b."state" = 'received' AND te."event_type" <> 'custody.receive_shipment')
      OR b."state" IN ('empty', 'retired')
  ) THEN
    RAISE EXCEPTION 'Existing boxes lack valid current-state transaction provenance';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "converters" c
    LEFT JOIN "transaction_envelopes" te ON te."transaction_id" = c."last_transition_transaction_id"
    WHERE c."last_transition_transaction_id" IS NULL
      OR te."transaction_id" IS NULL
      OR (c."state" IN ('captured', 'boxed') AND te."event_type" NOT IN ('field.capture_converter', 'custody.assign_converter_to_box'))
      OR (c."state" = 'queued' AND te."event_type" <> 'custody.assign_box_to_queue')
      OR (c."state" = 'in_transit' AND te."event_type" <> 'custody.create_shipment')
      OR (c."state" = 'received' AND te."event_type" <> 'custody.receive_shipment')
      OR (c."state" = 'processing' AND te."event_type" <> 'custody.lock_queue_for_processing')
      OR (c."state" = 'sampled' AND te."event_type" <> 'analytics.record_sample')
      OR (c."state" = 'settled' AND te."event_type" <> 'settlement.finalize_from_assay')
  ) THEN
    RAISE EXCEPTION 'Existing converters lack valid current-state transaction provenance';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "queues" q
    LEFT JOIN "transaction_envelopes" created ON created."transaction_id" = q."created_by_transaction_id"
    LEFT JOIN "transaction_envelopes" transitioned ON transitioned."transaction_id" = q."last_transition_transaction_id"
    WHERE q."created_by_transaction_id" IS NULL
      OR q."last_transition_transaction_id" IS NULL
      OR created."transaction_id" IS NULL
      OR transitioned."transaction_id" IS NULL
      OR created."event_type" <> 'custody.assign_box_to_queue'
      OR (q."state" = 'open' AND transitioned."event_type" <> 'custody.assign_box_to_queue')
      OR (q."state" = 'processing' AND transitioned."event_type" NOT IN ('custody.lock_queue_for_processing', 'pricing.resolve_estimate'))
      OR (q."state" IN ('sampled', 'assay_pending') AND transitioned."event_type" NOT IN ('analytics.record_sample', 'pricing.resolve_estimate'))
      OR (q."state" = 'valued' AND transitioned."event_type" <> 'pricing.resolve_estimate')
      OR (q."state" = 'settled' AND transitioned."event_type" <> 'settlement.finalize_from_assay')
  ) THEN
    RAISE EXCEPTION 'Existing queues lack valid creation or current-state transaction provenance';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "shipments" s
    LEFT JOIN "transaction_envelopes" created ON created."transaction_id" = s."created_by_transaction_id"
    LEFT JOIN "transaction_envelopes" transitioned ON transitioned."transaction_id" = s."last_transition_transaction_id"
    WHERE s."created_by_transaction_id" IS NULL
      OR s."last_transition_transaction_id" IS NULL
      OR created."transaction_id" IS NULL
      OR transitioned."transaction_id" IS NULL
      OR created."event_type" <> 'custody.create_shipment'
      OR (s."state" = 'in_transit' AND transitioned."event_type" <> 'custody.create_shipment')
      OR (s."state" = 'received' AND transitioned."event_type" <> 'custody.receive_shipment')
      OR s."state" IN ('prepared', 'discrepant', 'closed')
  ) THEN
    RAISE EXCEPTION 'Existing shipments lack valid creation or current-state transaction provenance';
  END IF;
  IF EXISTS (SELECT 1 FROM "shipment_boxes" WHERE "assigned_by_transaction_id" IS NULL) THEN
    RAISE EXCEPTION 'Existing shipment membership lacks assignment transaction provenance';
  END IF;
END;
$$;--> statement-breakpoint

ALTER TABLE "boxes" ALTER COLUMN "last_transition_transaction_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "converters" ALTER COLUMN "last_transition_transaction_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "queues" ALTER COLUMN "created_by_transaction_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "queues" ALTER COLUMN "last_transition_transaction_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment_boxes" ALTER COLUMN "assigned_by_transaction_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "created_by_transaction_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ALTER COLUMN "last_transition_transaction_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "boxes" ADD CONSTRAINT "boxes_last_transition_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("last_transition_transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "converters" ADD CONSTRAINT "converters_last_transition_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("last_transition_transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queues" ADD CONSTRAINT "queues_created_by_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("created_by_transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queues" ADD CONSTRAINT "queues_last_transition_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("last_transition_transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_boxes" ADD CONSTRAINT "shipment_boxes_assigned_by_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("assigned_by_transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("created_by_transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_last_transition_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("last_transition_transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "dcs_validate_custody_state_lineage"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_event_type text;
  created_event_type text;
  allowed_event_types text[];
BEGIN
  SELECT te."event_type" INTO source_event_type
  FROM "transaction_envelopes" te
  WHERE te."transaction_id" = NEW."last_transition_transaction_id";

  CASE TG_TABLE_NAME
    WHEN 'converters' THEN
      IF TG_OP = 'INSERT' THEN
        SELECT te."event_type" INTO created_event_type
        FROM "transaction_envelopes" te
        WHERE te."transaction_id" = NEW."origin_transaction_id";
        IF created_event_type IS DISTINCT FROM 'field.capture_converter' THEN
          RAISE EXCEPTION 'converter creation must reference field.capture_converter';
        END IF;
      ELSE
        IF NEW."converter_id" IS DISTINCT FROM OLD."converter_id"
          OR NEW."origin_transaction_id" IS DISTINCT FROM OLD."origin_transaction_id"
          OR NEW."evidence_bundle_id" IS DISTINCT FROM OLD."evidence_bundle_id"
          OR NEW."captured_at" IS DISTINCT FROM OLD."captured_at"
          OR NEW."captured_site_id" IS DISTINCT FROM OLD."captured_site_id" THEN
          RAISE EXCEPTION 'converter identity and origin are immutable';
        END IF;
        IF (NEW."state" IS DISTINCT FROM OLD."state" OR NEW."current_box_id" IS DISTINCT FROM OLD."current_box_id")
          AND NEW."last_transition_transaction_id" IS NOT DISTINCT FROM OLD."last_transition_transaction_id" THEN
          RAISE EXCEPTION 'converter state change requires a new source transaction';
        END IF;
      END IF;
      CASE NEW."state"
        WHEN 'captured' THEN allowed_event_types := ARRAY['field.capture_converter'];
        WHEN 'boxed' THEN allowed_event_types := ARRAY['field.capture_converter', 'custody.assign_converter_to_box'];
        WHEN 'queued' THEN allowed_event_types := ARRAY['custody.assign_box_to_queue'];
        WHEN 'in_transit' THEN allowed_event_types := ARRAY['custody.create_shipment'];
        WHEN 'received' THEN allowed_event_types := ARRAY['custody.receive_shipment'];
        WHEN 'processing' THEN allowed_event_types := ARRAY['custody.lock_queue_for_processing'];
        WHEN 'sampled' THEN allowed_event_types := ARRAY['analytics.record_sample'];
        WHEN 'settled' THEN allowed_event_types := ARRAY['settlement.finalize_from_assay'];
      END CASE;
    WHEN 'boxes' THEN
      IF TG_OP = 'INSERT' THEN
        SELECT te."event_type" INTO created_event_type
        FROM "transaction_envelopes" te
        WHERE te."transaction_id" = NEW."created_by_transaction_id";
        IF created_event_type NOT IN ('field.capture_converter', 'custody.assign_converter_to_box') THEN
          RAISE EXCEPTION 'box creation must reference a controlled capture or assignment command';
        END IF;
      ELSE
        IF NEW."box_id" IS DISTINCT FROM OLD."box_id"
          OR NEW."external_code" IS DISTINCT FROM OLD."external_code"
          OR NEW."material_type" IS DISTINCT FROM OLD."material_type"
          OR NEW."created_by_transaction_id" IS DISTINCT FROM OLD."created_by_transaction_id"
          OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
          RAISE EXCEPTION 'box identity and creation basis are immutable';
        END IF;
        IF NEW."state" IS DISTINCT FROM OLD."state"
          AND NEW."last_transition_transaction_id" IS NOT DISTINCT FROM OLD."last_transition_transaction_id" THEN
          RAISE EXCEPTION 'box state change requires a new source transaction';
        END IF;
      END IF;
      CASE NEW."state"
        WHEN 'active' THEN allowed_event_types := ARRAY['field.capture_converter', 'custody.assign_converter_to_box'];
        WHEN 'closed' THEN allowed_event_types := ARRAY['custody.close_box'];
        WHEN 'shipped' THEN allowed_event_types := ARRAY['custody.create_shipment'];
        WHEN 'received' THEN allowed_event_types := ARRAY['custody.receive_shipment'];
        ELSE allowed_event_types := ARRAY[]::text[];
      END CASE;
    WHEN 'queues' THEN
      IF TG_OP = 'INSERT' THEN
        SELECT te."event_type" INTO created_event_type
        FROM "transaction_envelopes" te
        WHERE te."transaction_id" = NEW."created_by_transaction_id";
        IF created_event_type IS DISTINCT FROM 'custody.assign_box_to_queue' THEN
          RAISE EXCEPTION 'queue creation must reference custody.assign_box_to_queue';
        END IF;
      ELSE
        IF NEW."queue_id" IS DISTINCT FROM OLD."queue_id"
          OR NEW."queue_code" IS DISTINCT FROM OLD."queue_code"
          OR NEW."created_by_transaction_id" IS DISTINCT FROM OLD."created_by_transaction_id"
          OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
          RAISE EXCEPTION 'queue identity and creation basis are immutable';
        END IF;
        IF (
          NEW."state" IS DISTINCT FROM OLD."state"
          OR NEW."locked_for_processing" IS DISTINCT FROM OLD."locked_for_processing"
          OR NEW."estimated_value_usd" IS DISTINCT FROM OLD."estimated_value_usd"
        ) AND NEW."last_transition_transaction_id" IS NOT DISTINCT FROM OLD."last_transition_transaction_id" THEN
          RAISE EXCEPTION 'queue state or value change requires a new source transaction';
        END IF;
      END IF;
      CASE NEW."state"
        WHEN 'open' THEN allowed_event_types := ARRAY['custody.assign_box_to_queue'];
        WHEN 'processing' THEN allowed_event_types := ARRAY['custody.lock_queue_for_processing', 'pricing.resolve_estimate'];
        WHEN 'sampled' THEN allowed_event_types := ARRAY['analytics.record_sample', 'pricing.resolve_estimate'];
        WHEN 'assay_pending' THEN allowed_event_types := ARRAY['analytics.record_sample', 'pricing.resolve_estimate'];
        WHEN 'valued' THEN allowed_event_types := ARRAY['pricing.resolve_estimate'];
        WHEN 'settled' THEN allowed_event_types := ARRAY['settlement.finalize_from_assay'];
      END CASE;
    WHEN 'shipments' THEN
      IF TG_OP = 'INSERT' THEN
        SELECT te."event_type" INTO created_event_type
        FROM "transaction_envelopes" te
        WHERE te."transaction_id" = NEW."created_by_transaction_id";
        IF created_event_type IS DISTINCT FROM 'custody.create_shipment' THEN
          RAISE EXCEPTION 'shipment creation must reference custody.create_shipment';
        END IF;
      ELSE
        IF NEW."shipment_id" IS DISTINCT FROM OLD."shipment_id"
          OR NEW."shipment_code" IS DISTINCT FROM OLD."shipment_code"
          OR NEW."origin_site_id" IS DISTINCT FROM OLD."origin_site_id"
          OR NEW."destination_site_id" IS DISTINCT FROM OLD."destination_site_id"
          OR NEW."departed_at" IS DISTINCT FROM OLD."departed_at"
          OR NEW."created_by_transaction_id" IS DISTINCT FROM OLD."created_by_transaction_id" THEN
          RAISE EXCEPTION 'shipment identity and departure basis are immutable';
        END IF;
        IF (NEW."state" IS DISTINCT FROM OLD."state" OR NEW."received_at" IS DISTINCT FROM OLD."received_at")
          AND NEW."last_transition_transaction_id" IS NOT DISTINCT FROM OLD."last_transition_transaction_id" THEN
          RAISE EXCEPTION 'shipment state change requires a new source transaction';
        END IF;
      END IF;
      CASE NEW."state"
        WHEN 'in_transit' THEN allowed_event_types := ARRAY['custody.create_shipment'];
        WHEN 'received' THEN allowed_event_types := ARRAY['custody.receive_shipment'];
        ELSE allowed_event_types := ARRAY[]::text[];
      END CASE;
    ELSE
      RAISE EXCEPTION 'unsupported custody lineage table %', TG_TABLE_NAME;
  END CASE;

  IF source_event_type IS NULL OR NOT (source_event_type = ANY(allowed_event_types)) THEN
    RAISE EXCEPTION '% state % has invalid source event %', TG_TABLE_NAME, NEW."state", source_event_type;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "converters_state_lineage"
BEFORE INSERT OR UPDATE ON "converters"
FOR EACH ROW EXECUTE FUNCTION "dcs_validate_custody_state_lineage"();--> statement-breakpoint
CREATE TRIGGER "boxes_state_lineage"
BEFORE INSERT OR UPDATE ON "boxes"
FOR EACH ROW EXECUTE FUNCTION "dcs_validate_custody_state_lineage"();--> statement-breakpoint
CREATE TRIGGER "queues_state_lineage"
BEFORE INSERT OR UPDATE ON "queues"
FOR EACH ROW EXECUTE FUNCTION "dcs_validate_custody_state_lineage"();--> statement-breakpoint
CREATE TRIGGER "shipments_state_lineage"
BEFORE INSERT OR UPDATE ON "shipments"
FOR EACH ROW EXECUTE FUNCTION "dcs_validate_custody_state_lineage"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "dcs_validate_shipment_membership_lineage"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_event_type text;
BEGIN
  SELECT te."event_type" INTO source_event_type
  FROM "transaction_envelopes" te
  WHERE te."transaction_id" = NEW."assigned_by_transaction_id";
  IF source_event_type IS DISTINCT FROM 'custody.create_shipment' THEN
    RAISE EXCEPTION 'shipment membership must reference custody.create_shipment';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "shipment_boxes_lineage"
BEFORE INSERT ON "shipment_boxes"
FOR EACH ROW EXECUTE FUNCTION "dcs_validate_shipment_membership_lineage"();
