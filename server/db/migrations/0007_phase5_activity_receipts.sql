-- Phase 5: durable production receipt metadata and direct-address recipient support.
-- PostgreSQL remains the system of record; browser receipts are a local cache.

ALTER TABLE activity_receipts
  ALTER COLUMN recipient_snapshot_id DROP NOT NULL;

ALTER TABLE activity_receipts
  ADD COLUMN IF NOT EXISTS action_type text,
  ADD COLUMN IF NOT EXISTS surface text,
  ADD COLUMN IF NOT EXISTS plan_id text,
  ADD COLUMN IF NOT EXISTS execution_tx_hash text,
  ADD COLUMN IF NOT EXISTS execution_block bigint,
  ADD COLUMN IF NOT EXISTS actual_amount_raw numeric(38, 0),
  ADD COLUMN IF NOT EXISTS balance_before_raw numeric(38, 0),
  ADD COLUMN IF NOT EXISTS verified_balance_after numeric(38, 0),
  ADD COLUMN IF NOT EXISTS risk_score integer,
  ADD COLUMN IF NOT EXISTS policy_decision text,
  ADD COLUMN IF NOT EXISTS display_summary text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_activity_receipts_risk_score'
  ) THEN
    ALTER TABLE activity_receipts
      ADD CONSTRAINT chk_activity_receipts_risk_score
      CHECK (risk_score IS NULL OR (risk_score >= 0 AND risk_score <= 100));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS ix_activity_receipts_sender_created
  ON activity_receipts (sender_user_id, created_at DESC);

ALTER TYPE execution_event_type ADD VALUE IF NOT EXISTS 'RECEIPT_SYNCED';
