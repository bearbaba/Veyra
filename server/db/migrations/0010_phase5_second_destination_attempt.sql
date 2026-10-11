-- Phase 5: durably reserve a second destination attempt after a chain-proven revert.
-- Attempt #1's hash, checkpoint and audit are never overwritten. This migration
-- intentionally does not expose a wallet/signing/rebroadcast permission.
CREATE TABLE IF NOT EXISTS "bridge_destination_retry_attempts" (
  "plan_id" text NOT NULL
    REFERENCES "bridge_destination_submission_claims"("plan_id"),
  "attempt_number" integer NOT NULL DEFAULT 2,
  "owner_user_id" text NOT NULL REFERENCES "veyra_users"("veyr_user_id"),
  "receive_tx_hash" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("plan_id", "attempt_number"),
  CONSTRAINT "chk_destination_retry_attempt_number" CHECK ("attempt_number" = 2),
  CONSTRAINT "chk_destination_retry_tx_hash"
    CHECK ("receive_tx_hash" IS NULL OR "receive_tx_hash" ~ '^0x[0-9a-fA-F]{64}$')
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ix_destination_retry_owner"
  ON "bridge_destination_retry_attempts" ("owner_user_id", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bridge_destination_retry_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "plan_id" text NOT NULL,
  "attempt_number" integer NOT NULL,
  "event_type" text NOT NULL,
  "receive_tx_hash" text,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("plan_id", "attempt_number")
    REFERENCES "bridge_destination_retry_attempts"("plan_id", "attempt_number"),
  CONSTRAINT "chk_destination_retry_event_type"
    CHECK ("event_type" IN ('SUBMISSION_STARTED', 'BROADCAST_RECORDED')),
  CONSTRAINT "chk_destination_retry_event_hash"
    CHECK (
      ("event_type" = 'SUBMISSION_STARTED' AND "receive_tx_hash" IS NULL)
      OR
      ("event_type" = 'BROADCAST_RECORDED' AND "receive_tx_hash" ~ '^0x[0-9a-fA-F]{64}$')
    ),
  UNIQUE ("plan_id", "attempt_number", "event_type")
);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_destination_retry_attempt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'destination retry claim cannot be deleted';
  END IF;

  IF NEW.plan_id IS DISTINCT FROM OLD.plan_id OR
     NEW.attempt_number IS DISTINCT FROM OLD.attempt_number OR
     NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR
     NEW.created_at IS DISTINCT FROM OLD.created_at OR
     (OLD.receive_tx_hash IS NOT NULL AND
      NEW.receive_tx_hash IS DISTINCT FROM OLD.receive_tx_hash)
  THEN
    RAISE EXCEPTION 'destination retry claim identity and recorded hash are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_destination_retry_claim_immutable
  BEFORE UPDATE OR DELETE ON bridge_destination_retry_attempts
  FOR EACH ROW EXECUTE FUNCTION guard_destination_retry_attempt_mutation();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION forbid_destination_retry_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'destination retry events are append-only';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_destination_retry_event_append_only
  BEFORE UPDATE OR DELETE ON bridge_destination_retry_events
  FOR EACH ROW EXECUTE FUNCTION forbid_destination_retry_event_mutation();
