CREATE TABLE IF NOT EXISTS "audit_anchor" (
	"date" date PRIMARY KEY NOT NULL,
	"root_hash" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"event_type" text NOT NULL,
	"actor_id" uuid,
	"actor_role" text,
	"target_type" text,
	"target_id" text,
	"payload" jsonb NOT NULL,
	"ip" "inet",
	"ua" text,
	"prev_hash" "bytea" NOT NULL,
	"hash" "bytea" NOT NULL,
	"chain_root" "bytea" NOT NULL
);
