-- Phase 5: immutable chain-verified resolution of a destination receive attempt.
-- This migration records evidence, NOT authorization for another relay.
CREATE TABLE IF NOT EXISTS "bridge_destination_attempt_resolutions" (
  "plan_id" text NOT NULL
    REFERENCES "bridge_destination_submission_claims"("plan_id"),
  "attempt_number" integer NOT NULL,
  "owner_user_id" text NOT NULL REFERENCES "veyra_users"("veyr_user_id"),
  "receive_tx_hash" text NOT NULL,
  "destination_chain_id" bigint NOT NULL,
  "destination_block_number" bigint NOT NULL,
  "destination_block_hash" text NOT NULL,
  "confirmations" integer NOT NULL,
  "outcome" text NOT NULL DEFAULT 'REVERTED',
  "verified_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("plan_id", "attempt_number"),
  CONSTRAINT "chk_destination_resolution_attempt"
    CHECK ("attempt_number" = 1),
  CONSTRAINT "chk_destination_resolution_outcome"
    CHECK ("outcome" = 'REVERTED'),
  CONSTRAINT "chk_destination_resolution_hash"
    CHECK ("receive_tx_hash" ~ '^0x[0-9a-fA-F]{64}$'),
  CONSTRAINT "chk_destination_resolution_block_hash"
    CHECK ("destination_block_hash" ~ '^0x[0-9a-fA-F]{64}$'),
  CONSTRAINT "chk_destination_resolution_block_number"
    CHECK ("destination_block_number" >= 0),
  CONSTRAINT "chk_destination_resolution_confirmations"
    CHECK ("confirmations" >= 12)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ix_destination_resolution_owner"
  ON "bridge_destination_attempt_resolutions" ("owner_user_id", "verified_at");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION forbid_destination_attempt_resolution_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'verified destination attempt resolutions are append-only';
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_destination_attempt_resolution_append_only
  ON bridge_destination_attempt_resolutions;
--> statement-breakpoint

CREATE TRIGGER trg_destination_attempt_resolution_append_only
  BEFORE UPDATE OR DELETE ON bridge_destination_attempt_resolutions
  FOR EACH ROW EXECUTE FUNCTION forbid_destination_attempt_resolution_mutation();
