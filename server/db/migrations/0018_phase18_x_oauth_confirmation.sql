-- Phase 18: an X callback alone cannot link a different person's X account.
-- Store staged profile only until same signed Veyra ID session confirms it.
ALTER TABLE "oauth_link_states" ADD COLUMN IF NOT EXISTS "pending_profile" jsonb;
--> statement-breakpoint
ALTER TABLE "oauth_link_states" ADD COLUMN IF NOT EXISTS "linked_at" timestamptz;
