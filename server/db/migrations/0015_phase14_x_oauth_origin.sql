-- Phase 14: bind one-use X OAuth state to the exact, trusted browser Origin.
-- Existing in-flight states (null app_origin) fail closed and require restarting.
ALTER TABLE "oauth_link_states" ADD COLUMN IF NOT EXISTS "app_origin" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_oauth_link_states_app_origin" ON "oauth_link_states" ("app_origin");
