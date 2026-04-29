CREATE TABLE "projection_settlement_drilldown_cache" (
	"settlement_id" uuid PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projection_workbench_view_cache" (
	"projection_key" varchar(64) PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projection_settlement_drilldown_cache" ADD CONSTRAINT "projection_settlement_drilldown_cache_settlement_id_settlements_settlement_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("settlement_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projection_settlement_drilldown_generated_idx" ON "projection_settlement_drilldown_cache" USING btree ("generated_at");