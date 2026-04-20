CREATE TABLE IF NOT EXISTS "ai_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature" text NOT NULL,
	"scope_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"model" text NOT NULL,
	"output" jsonb NOT NULL,
	"prompt_tokens" int NOT NULL DEFAULT 0,
	"completion_tokens" int NOT NULL DEFAULT 0,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_cache" ADD CONSTRAINT "ai_cache_feature_scope_key_content_hash_model_unique" UNIQUE ("feature", "scope_key", "content_hash", "model");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_cache_feature_scope_key_idx" ON "ai_cache" ("feature", "scope_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_usage_daily" (
	"org_id" uuid NOT NULL,
	"date" date NOT NULL,
	"prompt_tokens" bigint NOT NULL DEFAULT 0,
	"completion_tokens" bigint NOT NULL DEFAULT 0,
	"requests" int NOT NULL DEFAULT 0,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	PRIMARY KEY ("org_id", "date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_rate_limit" (
	"user_id" uuid NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"requests" int NOT NULL DEFAULT 0,
	PRIMARY KEY ("user_id", "bucket_start")
);
