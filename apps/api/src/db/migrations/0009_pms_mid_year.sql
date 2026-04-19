CREATE TYPE "public"."pms_comment_role" AS ENUM('appraiser', 'appraisee', 'next_level');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mid_year_checkpoint" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"acked_at" timestamp with time zone,
	"acked_by" uuid,
	"summary" text,
	"nudges_accepted" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mid_year_checkpoint_cycle_id_unique" UNIQUE("cycle_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "behavioural_rating" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pms_id" uuid NOT NULL,
	"dimension_code" text NOT NULL,
	"rating_1_to_5" integer NOT NULL,
	"rubric_anchor_text" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "career_development" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pms_id" uuid NOT NULL,
	"potential_window" text NOT NULL,
	"ready_in" text,
	"comments" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "career_development_pms_id_unique" UNIQUE("pms_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cycle_amendment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_cycle_id" uuid NOT NULL,
	"original_snapshot_id" uuid,
	"reason" text NOT NULL,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "personal_growth" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pms_id" uuid NOT NULL,
	"training_needs" text,
	"comments" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_growth_pms_id_unique" UNIQUE("pms_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pms_assessment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pms_assessment_cycle_id_unique" UNIQUE("cycle_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pms_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pms_id" uuid NOT NULL,
	"role" "pms_comment_role" NOT NULL,
	"body" text NOT NULL,
	"signed_by" uuid,
	"signed_at" timestamp with time zone,
	"ip" text,
	"ua" text,
	"signature_hash" "bytea",
	"prev_signature_hash" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pms_final_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pms_id" uuid NOT NULL,
	"finalized_at" timestamp with time zone NOT NULL,
	"finalized_by" uuid NOT NULL,
	"score_total" text NOT NULL,
	"score_breakdown" jsonb NOT NULL,
	"pdf_r2_key" text,
	"pdf_sha256" text,
	"amendment_of_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pms_kra_rating" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pms_id" uuid NOT NULL,
	"kra_id" uuid NOT NULL,
	"result_achieved" text,
	"final_rating" integer,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_contribution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pms_id" uuid NOT NULL,
	"when_date" text NOT NULL,
	"achievement" text NOT NULL,
	"weight_pct" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mid_year_checkpoint" ADD CONSTRAINT "mid_year_checkpoint_cycle_id_performance_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."performance_cycle"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "behavioural_rating" ADD CONSTRAINT "behavioural_rating_pms_id_pms_assessment_id_fk" FOREIGN KEY ("pms_id") REFERENCES "public"."pms_assessment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "career_development" ADD CONSTRAINT "career_development_pms_id_pms_assessment_id_fk" FOREIGN KEY ("pms_id") REFERENCES "public"."pms_assessment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cycle_amendment" ADD CONSTRAINT "cycle_amendment_original_cycle_id_performance_cycle_id_fk" FOREIGN KEY ("original_cycle_id") REFERENCES "public"."performance_cycle"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cycle_amendment" ADD CONSTRAINT "cycle_amendment_original_snapshot_id_pms_final_snapshot_id_fk" FOREIGN KEY ("original_snapshot_id") REFERENCES "public"."pms_final_snapshot"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "personal_growth" ADD CONSTRAINT "personal_growth_pms_id_pms_assessment_id_fk" FOREIGN KEY ("pms_id") REFERENCES "public"."pms_assessment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pms_assessment" ADD CONSTRAINT "pms_assessment_cycle_id_performance_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."performance_cycle"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pms_comment" ADD CONSTRAINT "pms_comment_pms_id_pms_assessment_id_fk" FOREIGN KEY ("pms_id") REFERENCES "public"."pms_assessment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pms_comment" ADD CONSTRAINT "pms_comment_signed_by_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pms_final_snapshot" ADD CONSTRAINT "pms_final_snapshot_pms_id_pms_assessment_id_fk" FOREIGN KEY ("pms_id") REFERENCES "public"."pms_assessment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pms_final_snapshot" ADD CONSTRAINT "pms_final_snapshot_amendment_of_snapshot_id_pms_final_snapshot_id_fk" FOREIGN KEY ("amendment_of_snapshot_id") REFERENCES "public"."pms_final_snapshot"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pms_kra_rating" ADD CONSTRAINT "pms_kra_rating_pms_id_pms_assessment_id_fk" FOREIGN KEY ("pms_id") REFERENCES "public"."pms_assessment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pms_kra_rating" ADD CONSTRAINT "pms_kra_rating_kra_id_kra_id_fk" FOREIGN KEY ("kra_id") REFERENCES "public"."kra"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "staff_contribution" ADD CONSTRAINT "staff_contribution_pms_id_pms_assessment_id_fk" FOREIGN KEY ("pms_id") REFERENCES "public"."pms_assessment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
