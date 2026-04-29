CREATE TABLE "projection_rebuild_checkpoint" (
	"checkpoint_key" varchar(32) PRIMARY KEY NOT NULL,
	"last_applied_at" timestamp with time zone,
	"last_transaction_id" uuid,
	"projection_generated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projection_rebuild_checkpoint_key_chk" CHECK ("projection_rebuild_checkpoint"."checkpoint_key" = 'global')
);
