-- Additive schema only. Mainnet endpoints are still guarded behind an authorized
-- Mainnet BFF, active Arc-5042 wallet identity and chain proof.
-- Deploy to a separate, backed-up Mainnet PostgreSQL database; schema alone
-- does not activate any money movement or identity login.
CREATE TABLE IF NOT EXISTS mainnet_direct_pay_receipts (
 tx_hash text PRIMARY KEY CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
 chain_id bigint NOT NULL CHECK (chain_id=5042),
 sender_address text NOT NULL,
 recipient_address text NOT NULL,
 sender_user_id text REFERENCES veyra_users(veyr_user_id),
 recipient_user_id text REFERENCES veyra_users(veyr_user_id),
 recipient_snapshot_id text REFERENCES identity_snapshots(snapshot_id),
 recipient_label text,
 amount_raw text NOT NULL CHECK (amount_raw ~ '^[0-9]+$'),
 fee_wei text NOT NULL CHECK (fee_wei ~ '^[0-9]+$'),
 block_number bigint NOT NULL CHECK (block_number > 0),
 sender_private_note text CHECK (char_length(sender_private_note)<=120),
 created_at timestamptz NOT NULL DEFAULT now(),
 verified_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT mainnet_pay_owner_required CHECK (sender_user_id IS NOT NULL OR recipient_user_id IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_mainnet_pay_sender ON mainnet_direct_pay_receipts(sender_user_id,created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_mainnet_pay_recipient ON mainnet_direct_pay_receipts(recipient_user_id,created_at DESC);
