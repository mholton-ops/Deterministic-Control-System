CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
ALTER TABLE "grading_decisions" ADD COLUMN "transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "pricing_decisions" ADD COLUMN "transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "samples" ADD COLUMN "evidence_bundle_id" uuid;--> statement-breakpoint

WITH matched AS (
  SELECT DISTINCT ON (gd."grading_decision_id")
    gd."grading_decision_id",
    te."transaction_id"
  FROM "grading_decisions" gd
  JOIN "transaction_envelopes" te
    ON te."event_type" = 'grading.issue_decision'
   AND te."payload" ->> 'converterId' = gd."converter_id"::text
  ORDER BY
    gd."grading_decision_id",
    ABS(EXTRACT(EPOCH FROM (te."created_at" - gd."decided_at"))),
    te."transaction_id"
)
UPDATE "grading_decisions" gd
SET "transaction_id" = matched."transaction_id"
FROM matched
WHERE gd."grading_decision_id" = matched."grading_decision_id";--> statement-breakpoint
UPDATE "grading_decisions" gd
SET "transaction_id" = c."origin_transaction_id"
FROM "converters" c
WHERE gd."converter_id" = c."converter_id"
  AND gd."transaction_id" IS NULL;--> statement-breakpoint

WITH matched AS (
  SELECT DISTINCT ON (pd."pricing_decision_id")
    pd."pricing_decision_id",
    te."transaction_id"
  FROM "pricing_decisions" pd
  JOIN "queues" q ON q."queue_id" = pd."queue_id"
  JOIN "transaction_envelopes" te
    ON te."event_type" = 'pricing.resolve_estimate'
   AND te."payload" ->> 'queueId' IN (q."queue_id"::text, q."queue_code")
  ORDER BY
    pd."pricing_decision_id",
    ABS(EXTRACT(EPOCH FROM (te."created_at" - pd."decided_at"))),
    te."transaction_id"
)
UPDATE "pricing_decisions" pd
SET "transaction_id" = matched."transaction_id"
FROM matched
WHERE pd."pricing_decision_id" = matched."pricing_decision_id";--> statement-breakpoint
WITH fallback AS (
  SELECT DISTINCT ON (pd."pricing_decision_id")
    pd."pricing_decision_id",
    qb."assigned_by_transaction_id" AS "transaction_id"
  FROM "pricing_decisions" pd
  JOIN "queue_boxes" qb ON qb."queue_id" = pd."queue_id"
  WHERE pd."transaction_id" IS NULL
  ORDER BY pd."pricing_decision_id", qb."assigned_at", qb."box_id"
)
UPDATE "pricing_decisions" pd
SET "transaction_id" = fallback."transaction_id"
FROM fallback
WHERE pd."pricing_decision_id" = fallback."pricing_decision_id";--> statement-breakpoint

WITH matched AS (
  SELECT DISTINCT ON (s."sample_id")
    s."sample_id",
    te."transaction_id"
  FROM "samples" s
  JOIN "queues" q ON q."queue_id" = s."queue_id"
  JOIN "transaction_envelopes" te
    ON te."event_type" = 'analytics.record_sample'
   AND te."payload" ->> 'queueId' IN (q."queue_id"::text, q."queue_code")
   AND te."payload" ->> 'source' = s."source"::text
  ORDER BY
    s."sample_id",
    ABS(EXTRACT(EPOCH FROM (te."created_at" - s."captured_at"))),
    te."transaction_id"
)
UPDATE "samples" s
SET "transaction_id" = matched."transaction_id"
FROM matched
WHERE s."sample_id" = matched."sample_id";--> statement-breakpoint
WITH fallback AS (
  SELECT DISTINCT ON (s."sample_id")
    s."sample_id",
    qb."assigned_by_transaction_id" AS "transaction_id"
  FROM "samples" s
  JOIN "queue_boxes" qb ON qb."queue_id" = s."queue_id"
  WHERE s."transaction_id" IS NULL
  ORDER BY s."sample_id", qb."assigned_at", qb."box_id"
)
UPDATE "samples" s
SET "transaction_id" = fallback."transaction_id"
FROM fallback
WHERE s."sample_id" = fallback."sample_id";--> statement-breakpoint

INSERT INTO "evidence_bundles" (
  "evidence_bundle_id",
  "created_by_user_id",
  "created_by_device_id",
  "captured_at"
)
SELECT
  s."sample_id",
  te."origin_user_id",
  te."origin_device_id",
  s."captured_at"
FROM "samples" s
JOIN "transaction_envelopes" te ON te."transaction_id" = s."transaction_id"
LEFT JOIN "evidence_bundles" eb ON eb."evidence_bundle_id" = s."sample_id"
WHERE eb."evidence_bundle_id" IS NULL;--> statement-breakpoint
INSERT INTO "evidence_artifacts" (
  "artifact_id",
  "evidence_bundle_id",
  "evidence_type",
  "uri",
  "sha256",
  "synthetic",
  "captured_at"
)
SELECT
  (
    SUBSTR(MD5(s."sample_id"::text || ':legacy-note'), 1, 8) || '-' ||
    SUBSTR(MD5(s."sample_id"::text || ':legacy-note'), 9, 4) || '-' ||
    '4' || SUBSTR(MD5(s."sample_id"::text || ':legacy-note'), 14, 3) || '-' ||
    'a' || SUBSTR(MD5(s."sample_id"::text || ':legacy-note'), 18, 3) || '-' ||
    SUBSTR(MD5(s."sample_id"::text || ':legacy-note'), 21, 12)
  )::uuid,
  s."sample_id",
  'note',
  'dcs-proof://note/' || s."sample_id"::text || '/legacy-provenance',
  ENCODE(DIGEST('dcs-proof://note/' || s."sample_id"::text || '/legacy-provenance', 'sha256'), 'hex'),
  true,
  s."captured_at"
FROM "samples" s
LEFT JOIN "evidence_artifacts" ea
  ON ea."evidence_bundle_id" = s."sample_id" AND ea."evidence_type" = 'note'
WHERE ea."artifact_id" IS NULL;--> statement-breakpoint
UPDATE "samples"
SET "evidence_bundle_id" = "sample_id"
WHERE "evidence_bundle_id" IS NULL;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "grading_decisions" WHERE "transaction_id" IS NULL) THEN
    RAISE EXCEPTION 'Existing grading decisions lack transaction provenance';
  END IF;
  IF EXISTS (SELECT 1 FROM "pricing_decisions" WHERE "transaction_id" IS NULL) THEN
    RAISE EXCEPTION 'Existing pricing decisions lack transaction provenance';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "samples"
    WHERE "transaction_id" IS NULL OR "evidence_bundle_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Existing samples lack transaction or evidence provenance';
  END IF;
END;
$$;--> statement-breakpoint

ALTER TABLE "grading_decisions" ALTER COLUMN "transaction_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_decisions" ALTER COLUMN "transaction_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "samples" ALTER COLUMN "transaction_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "samples" ALTER COLUMN "evidence_bundle_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "grading_decisions" ADD CONSTRAINT "grading_decisions_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_decisions" ADD CONSTRAINT "pricing_decisions_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_evidence_bundle_id_evidence_bundles_evidence_bundle_id_fk" FOREIGN KEY ("evidence_bundle_id") REFERENCES "public"."evidence_bundles"("evidence_bundle_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER "grading_decisions_append_only"
BEFORE UPDATE OR DELETE ON "grading_decisions"
FOR EACH ROW EXECUTE FUNCTION "dcs_prevent_append_only_mutation"();--> statement-breakpoint
CREATE TRIGGER "samples_append_only"
BEFORE UPDATE OR DELETE ON "samples"
FOR EACH ROW EXECUTE FUNCTION "dcs_prevent_append_only_mutation"();--> statement-breakpoint
CREATE TRIGGER "pricing_decisions_append_only"
BEFORE UPDATE OR DELETE ON "pricing_decisions"
FOR EACH ROW EXECUTE FUNCTION "dcs_prevent_append_only_mutation"();
