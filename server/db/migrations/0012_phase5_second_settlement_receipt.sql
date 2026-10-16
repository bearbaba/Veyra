-- Phase 5: preserve first destination tx hash while explicitly referencing a
-- different VERIFIED settlement transaction for the second CCTP attempt.
ALTER TABLE activity_receipts
  ADD COLUMN IF NOT EXISTS settlement_receive_tx_hash text,
  ADD COLUMN IF NOT EXISTS settlement_receive_block_number bigint,
  ADD COLUMN IF NOT EXISTS settlement_attempt_number integer;
--> statement-breakpoint

ALTER TABLE activity_receipts
  ADD CONSTRAINT chk_activity_second_settlement_evidence
    CHECK (
      (settlement_receive_tx_hash IS NULL AND
       settlement_receive_block_number IS NULL AND
       settlement_attempt_number IS NULL)
      OR
      (settlement_receive_tx_hash ~ '^0x[0-9a-fA-F]{64}$' AND
       settlement_receive_block_number >= 0 AND
       settlement_attempt_number = 2)
    );
--> statement-breakpoint

CREATE OR REPLACE FUNCTION guard_activity_second_settlement_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.settlement_receive_tx_hash IS NOT NULL AND (
    NEW.settlement_receive_tx_hash IS DISTINCT FROM OLD.settlement_receive_tx_hash OR
    NEW.settlement_receive_block_number IS DISTINCT FROM OLD.settlement_receive_block_number OR
    NEW.settlement_attempt_number IS DISTINCT FROM OLD.settlement_attempt_number
  ) THEN
    RAISE EXCEPTION 'verified settlement hash and block are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_activity_second_settlement_immutable
  BEFORE UPDATE ON activity_receipts
  FOR EACH ROW EXECUTE FUNCTION guard_activity_second_settlement_immutability();
