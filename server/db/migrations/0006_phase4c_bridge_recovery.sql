-- Phase 4C — durable authenticated bridge recovery checkpoints
CREATE TABLE IF NOT EXISTS "bridge_recovery_checkpoints" (
  "plan_id" text PRIMARY KEY NOT NULL,
  "owner_user_id" text NOT NULL REFERENCES "veyra_users"("veyr_user_id"),
  "stage" text NOT NULL,
  "burn_tx_hash" text NOT NULL,
  "source_chain_id" bigint NOT NULL,
  "destination_chain_id" bigint NOT NULL,
  "wallet_address" text NOT NULL,
  "recipient_address" text NOT NULL,
  "amount_raw" numeric(38,0) NOT NULL,
  "token_address" text NOT NULL,
  "balance_before_raw" numeric(38,0) NOT NULL,
  "attestation_message" text,
  "attestation_signature" text,
  "receive_tx_hash" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chk_bridge_recovery_stage" CHECK (
    "stage" IN (
      'SOURCE_BROADCAST',
      'SOURCE_CONFIRMED',
      'ATTESTATION_READY',
      'DESTINATION_BROADCAST',
      'VERIFIED'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "uix_bridge_recovery_burn_tx_hash"
  ON "bridge_recovery_checkpoints" ("burn_tx_hash");

CREATE INDEX IF NOT EXISTS "ix_bridge_recovery_owner_stage"
  ON "bridge_recovery_checkpoints" ("owner_user_id", "stage", "updated_at");
