ALTER TABLE "mass_measurements" ADD COLUMN "transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "mass_measurements" ADD COLUMN "evidence_bundle_id" uuid;--> statement-breakpoint
WITH provenance AS (
  SELECT DISTINCT ON (mm."mass_measurement_id")
    mm."mass_measurement_id",
    qb."assigned_by_transaction_id" AS "transaction_id",
    c."evidence_bundle_id"
  FROM "mass_measurements" mm
  JOIN "queue_boxes" qb ON qb."queue_id" = mm."queue_id"
  JOIN "box_converters" bc ON bc."box_id" = qb."box_id"
  JOIN "converters" c ON c."converter_id" = bc."converter_id"
  ORDER BY mm."mass_measurement_id", qb."assigned_at", bc."assigned_at"
)
UPDATE "mass_measurements" mm
SET
  "transaction_id" = provenance."transaction_id",
  "evidence_bundle_id" = provenance."evidence_bundle_id"
FROM provenance
WHERE mm."mass_measurement_id" = provenance."mass_measurement_id";--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "mass_measurements"
    WHERE "transaction_id" IS NULL OR "evidence_bundle_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Existing mass measurements lack transaction or evidence provenance';
  END IF;
END;
$$;--> statement-breakpoint
ALTER TABLE "mass_measurements" ALTER COLUMN "transaction_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mass_measurements" ALTER COLUMN "evidence_bundle_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mass_measurements" ADD CONSTRAINT "mass_measurements_transaction_id_transaction_envelopes_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction_envelopes"("transaction_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mass_measurements" ADD CONSTRAINT "mass_measurements_evidence_bundle_id_evidence_bundles_evidence_bundle_id_fk" FOREIGN KEY ("evidence_bundle_id") REFERENCES "public"."evidence_bundles"("evidence_bundle_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER "mass_measurements_append_only"
BEFORE UPDATE OR DELETE ON "mass_measurements"
FOR EACH ROW EXECUTE FUNCTION "dcs_prevent_append_only_mutation"();
