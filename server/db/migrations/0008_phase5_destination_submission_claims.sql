-- Phase 5: exactly-once destination relay submission claim + immutable audit trail.
-- A claim is written BEFORE calling the relay wallet. A null destination hash
-- signals submission uncertainty and MUST NOT be automatically reclaimed.
CREATE TABLE IF NOT EXISTS "bridge_destination_submission_claims" (
  "plan_id" text PRIMARY KEY NOT NULL
    REFERENCES "bridge_recovery_checkpoints"("plan_id"),
  "owner_user_id" text NOT NULL
    REFERENCES "veyra_users"("veyr_user_id"),
  "attempt_number" integer NOT NULL DEFAULT 1,
  "receive_tx_hash" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chk_destination_submission_first_attempt"
    CHECK ("attempt_number" = 1),
  CONSTRAINT "chk_destination_submission_tx_hash"
    CHECK ("receive_tx_hash" IS NULL OR "receive_tx_hash" ~ '^0x[0-9a-fA-F]{64}$')
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ix_destination_submission_owner"
  ON "bridge_destination_submission_claims" ("owner_user_id", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bridge_destination_attempt_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "plan_id" text NOT NULL
    REFERENCES "bridge_destination_submission_claims"("plan_id"),
  "event_type" text NOT NULL,
  "receive_tx_hash" text,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chk_destination_attempt_event_type"
    CHECK ("event_type" IN ('SUBMISSION_STARTED','BROADCAST_RECORDED')),
  CONSTRAINT "chk_destination_attempt_event_hash"
    CHECK (
      ("event_type" = 'SUBMISSION_STARTED' AND "receive_tx_hash" IS NULL)
      OR
      ("event_type" = 'BROADCAST_RECORDED' AND "receive_tx_hash" ~ '^0x[0-9a-fA-F]{64}$')
    )
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uix_destination_attempt_one_event_per_type"
  ON "bridge_destination_attempt_events" ("plan_id", "event_type");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION forbid_bridge_destination_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'bridge_destination_attempt_events are append-only';
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_bridge_destination_attempt_events_append_only
  ON bridge_destination_attempt_events;
--> statement-breakpoint

CREATE TRIGGER trg_bridge_destination_attempt_events_append_only
  BEFORE UPDATE OR DELETE ON bridge_destination_attempt_events
  FOR EACH ROW EXECUTE FUNCTION forbid_bridge_destination_event_mutation();
