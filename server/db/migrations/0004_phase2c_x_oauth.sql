-- Phase 2C — durable X OAuth PKCE state
CREATE TABLE IF NOT EXISTS "oauth_link_states" (
  "oauth_state_id" text PRIMARY KEY NOT NULL,
  "state_hash" text NOT NULL,
  "veyr_user_id" text NOT NULL REFERENCES "veyra_users"("veyr_user_id"),
  "provider" text NOT NULL,
  "code_verifier" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "return_path" text NOT NULL DEFAULT '/settings',
  "issued_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "uix_oauth_link_states_state_hash" ON "oauth_link_states" ("state_hash");
CREATE INDEX IF NOT EXISTS "ix_oauth_link_states_user_provider"
  ON "oauth_link_states" ("veyr_user_id", "provider", "issued_at");
CREATE INDEX IF NOT EXISTS "ix_oauth_link_states_expiry"
  ON "oauth_link_states" ("expires_at");
CREATE INDEX IF NOT EXISTS "ix_oauth_link_states_live"
  ON "oauth_link_states" ("state_hash", "expires_at") WHERE "consumed_at" IS NULL;
