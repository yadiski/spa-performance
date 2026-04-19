CREATE TYPE "public"."kra_perspective" AS ENUM('financial', 'customer', 'internal_process', 'learning_growth');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kra" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"perspective" "kra_perspective" NOT NULL,
	"description" text NOT NULL,
	"weight_pct" integer NOT NULL,
	"measurement" text NOT NULL,
	"target" text NOT NULL,
	"order" integer NOT NULL,
	"rubric_1_to_5" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kra_progress_update" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kra_id" uuid NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_role" text NOT NULL,
	"result_achieved" text NOT NULL,
	"rating_1_to_5" integer NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kra" ADD CONSTRAINT "kra_cycle_id_performance_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."performance_cycle"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kra_progress_update" ADD CONSTRAINT "kra_progress_update_kra_id_kra_id_fk" FOREIGN KEY ("kra_id") REFERENCES "public"."kra"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
