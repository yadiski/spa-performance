CREATE TYPE "public"."cycle_state" AS ENUM('kra_drafting', 'kra_pending_approval', 'kra_approved', 'mid_year_open', 'mid_year_submitted', 'mid_year_done', 'pms_self_review', 'pms_awaiting_appraiser', 'pms_awaiting_next_lvl', 'pms_awaiting_hra', 'pms_finalized');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_transition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"from_state" "cycle_state" NOT NULL,
	"to_state" "cycle_state" NOT NULL,
	"actor_id" uuid NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "performance_cycle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"fy" integer NOT NULL,
	"state" "cycle_state" DEFAULT 'kra_drafting' NOT NULL,
	"kra_set_at" timestamp with time zone,
	"mid_year_at" timestamp with time zone,
	"pms_finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_transition" ADD CONSTRAINT "approval_transition_cycle_id_performance_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."performance_cycle"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "performance_cycle" ADD CONSTRAINT "performance_cycle_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
