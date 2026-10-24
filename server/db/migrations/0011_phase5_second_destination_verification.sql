-- Phase 5: independently verified successful CCTP mint from retry attempt #2.
-- This evidence is NOT an ActivityReceipt completion or approval to broadcast.
-- Original first destination tx and checkpoint hash stay immutable.
CREATE TABLE IF NOT EXISTS "bridge_destination_retry_verifications" (
  "plan_id" text NOT NULL,
  "attempt_number" integer NOT NULL DEFAULT 2,
  "owner_user_id" text NOT NULL REFERENCES "veyra_users"("veyr_user_id"),
  "receive_tx_hash" text NOT NULL,
  "destination_chain_id" bigint NOT NULL,
  "destination_block_number" bigint NOT NULL,
  "destination_block_hash" text NOT NULL,
  "mint_token" text NOT NULL,
  "mint_recipient" text NOT NULL,
  "mint_amount_raw" numeric(38, 0) NOT NULL,
  "confirmations" integer NOT NULL,
  "verified_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("plan_id", "attempt_number"),
  FOREIGN KEY ("plan_id", "attempt_number")
    REFERENCES "bridge_destination_retry_attempts"("plan_id", "attempt_number"),
  CONSTRAINT "chk_retry_verification_second_only" CHECK ("attempt_number" = 2),
  CONSTRAINT "chk_retry_verification_hash"
    CHECK ("receive_tx_hash" ~ '^0x[0-9a-fA-F]{64}$'),
  CONSTRAINT "chk_retry_verification_block_hash"
    CHECK ("destination_block_hash" ~ '^0x[0-9a-fA-F]{64}$'),
  CONSTRAINT "chk_retry_verification_block_number"
    CHECK ("destination_block_number" >= 0),
  CONSTRAINT "chk_retry_verification_amount"
    CHECK ("mint_amount_raw" > 0),
  CONSTRAINT "chk_retry_verification_confirmations"
    CHECK ("confirmations" >= 12),
  CONSTRAINT "chk_retry_verification_token"
    CHECK ("mint_token" ~ '^0x[0-9a-fA-F]{40}$'),
  CONSTRAINT "chk_retry_verification_recipient"
    CHECK ("mint_recipient" ~ '^0x[0-9a-fA-F]{40}$')
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ix_retry_verifications_owner"
  ON "bridge_destination_retry_verifications" ("owner_user_id", "verified_at");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION forbid_retry_verification_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'verified second destination mint evidence is append-only';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_retry_verification_append_only
  BEFORE UPDATE OR DELETE ON bridge_destination_retry_verifications
  FOR EACH ROW EXECUTE FUNCTION forbid_retry_verification_mutation();
